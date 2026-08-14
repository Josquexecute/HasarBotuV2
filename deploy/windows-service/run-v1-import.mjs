import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { applyV1Remediation, planV1Remediation } from '@hasarbotu/api'
import { closeDatabasePool, createDatabasePool, parseDatabaseUrl } from '@hasarbotu/database'

// HB-2026-198 sonrasi bulunan kritik kusurun kalici duzeltmesi: V1 gercek
// plaka klasorlerindeki `_HASARBOTU/takip.json` (notlar, gorevler, sorumlu/
// eksper, ihbar no, takip tarihi) V2'ye HIC tasinmiyordu -- HB-2026-197'nin
// "aktarim"i yalniz dosya TURUNU (trafik/kasko) okuyup atmis, script sonra
// SILINMISTI (kalici kod DEGILDI). Bu arac o bosluğu KALICI, TEST EDILMIS,
// idempotent kod olarak kapatir.
//
// V1 kaynagi HER ZAMAN salt-okunur acilir (`planV1Import`/`applyV1Import`
// icinde hicbir V1 dosyasina yazma/silme YOKTUR). Onizleme (varsayilan)
// HICBIR DB yazmasi yapmaz. Gercek yazma yalniz `--apply` ile VE gercek bir
// TTY oturumunda elle yazilan aynen-eslesen bir onay metniyle mumkundur --
// bootstrap-first-admin.mjs ile ayni "otomatize edilemez -Apply" ilkesi.

export class SafeError extends Error {
  constructor(safeCode) {
    super(safeCode)
    this.name = 'SafeError'
    this.safeCode = safeCode
  }
}
function fail(safeCode) {
  throw new SafeError(safeCode)
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = exitCode
}

function readDatabaseConfig() {
  const raw = process.env.DATABASE_URL
  if (typeof raw !== 'string' || raw.length === 0) fail('DATABASE_URL_REQUIRED')
  try {
    return parseDatabaseUrl(raw)
  } catch {
    fail('DATABASE_URL_INVALID')
  }
}

export function parseArguments(argv) {
  const result = { apply: false, summaryOnly: false, root: null, actorEmail: null, expectedPlanHash: null, resolutionFile: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') { result.apply = true; continue }
    if (arg === '--summary-only') { result.summaryOnly = true; continue }
    if (arg === '--root') { result.root = argv[i + 1] ?? null; i += 1; continue }
    if (arg === '--actor-email') { result.actorEmail = argv[i + 1] ?? null; i += 1; continue }
    if (arg === '--expected-plan-hash') { result.expectedPlanHash = argv[i + 1] ?? null; i += 1; continue }
    if (arg === '--resolution-file') { result.resolutionFile = argv[i + 1] ?? null; i += 1; continue }
    fail('ARGUMENT_UNKNOWN')
  }
  if (result.root === null || result.root.length === 0) fail('ROOT_REQUIRED')
  if (result.apply && (result.actorEmail === null || result.actorEmail.length === 0)) fail('ACTOR_EMAIL_REQUIRED_FOR_APPLY')
  if (result.apply && !/^[0-9a-f]{64}$/u.test(result.expectedPlanHash ?? '')) fail('EXPECTED_PLAN_HASH_REQUIRED_FOR_APPLY')
  return result
}

export async function readResolutionManifest(filePath) {
  if (filePath === null) return undefined
  let parsed
  try { parsed = JSON.parse(await readFile(filePath, 'utf8')) } catch { fail('RESOLUTION_MANIFEST_INVALID') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== 'hasarbotu-v1-resolution/1.0.0') fail('RESOLUTION_MANIFEST_INVALID')
  const allowed = new Set(['schemaVersion', 'cases', 'claimTypes', 'users', 'experts', 'services'])
  if (Object.keys(parsed).some((key) => !allowed.has(key))) fail('RESOLUTION_MANIFEST_INVALID')
  const isRecord = (value) => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value))
  if (!isRecord(parsed.cases) || !isRecord(parsed.claimTypes) || !isRecord(parsed.users)
    || !isRecord(parsed.experts) || !isRecord(parsed.services)) fail('RESOLUTION_MANIFEST_INVALID')
  const validEntries = (value, keyPattern, valuePredicate) => value === undefined
    || Object.entries(value).every(([key, item]) => keyPattern.test(key) && valuePredicate(item))
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  if (!validEntries(parsed.cases, /^[0-9a-f]{64}$/u, (value) => typeof value === 'string' && uuid.test(value))
    || !validEntries(parsed.claimTypes, /^[0-9a-f]{64}$/u, (value) => value === 'traffic' || value === 'casco')
    || !validEntries(parsed.users, /^[0-9a-f]{16}$/u, (value) => typeof value === 'string' && uuid.test(value))
    || !validEntries(parsed.experts, /^[0-9a-f]{16}$/u, (value) => typeof value === 'string' && uuid.test(value))
    || !validEntries(parsed.services, /^[0-9a-f]{16}$/u, (value) => typeof value === 'string' && uuid.test(value))) {
    fail('RESOLUTION_MANIFEST_INVALID')
  }
  return parsed
}

async function resolveSingleOrganization(pool) {
  const result = await pool.query('SELECT id::text,code FROM organizations')
  if (result.rows.length !== 1) fail(`ORGANIZATION_NOT_UNIQUE:${result.rows.length}`)
  return result.rows[0]
}

async function resolveActor(pool, organizationId, email) {
  const result = await pool.query(
    "SELECT id::text FROM users WHERE organization_id=$1 AND lower(email)=lower($2) AND status='active'",
    [organizationId, email],
  )
  if (result.rows.length !== 1) fail('ACTOR_NOT_FOUND_OR_NOT_UNIQUE')
  return result.rows[0].id
}

function summarizePlan(plan) {
  const referenceMappings = new Map()
  for (const entry of plan.entries) {
    for (const [kind, resolution] of [['responsible', entry.responsible], ['expert', entry.expert], ['service', entry.service]]) {
      if (resolution.state !== 'legacy_only' && resolution.state !== 'ambiguous_legacy') continue
      referenceMappings.set(`${kind}:${resolution.sourceNameToken}`, {
        Kind: kind,
        SourceNameToken: resolution.sourceNameToken,
        State: resolution.state,
        MatchCount: resolution.matchCount,
        RequiredValue: kind === 'service' ? 'serviceId' : 'userId',
      })
    }
  }
  return {
    SchemaVersion: 'hasarbotu-v1-remediation-preview/2.2.0',
    MappingVersion: plan.mappingVersion,
    IdentityVersion: plan.identityVersion,
    SchemaReady: plan.schemaReady,
    GeneratedAt: plan.generatedAt,
    SourceManifestHash: plan.sourceManifestHash,
    PlanHash: plan.planHash,
    Summary: plan.summary,
    HumanResolutionTemplate: {
      SchemaVersion: 'hasarbotu-v1-resolution-template/1.0.0',
      CaseTargets: plan.entries
        .filter((entry) => entry.targetState === 'human_ambiguous')
        .map((entry) => ({
          PathToken: entry.pathToken,
          SourceIdentity: entry.sourceIdentity,
          Candidates: entry.candidateCaseEvidence,
          RequiredValue: 'targetCaseId',
        })),
      ClaimTypes: plan.entries
        .filter((entry) => entry.targetState === 'human_claim_type')
        .map((entry) => ({
          PathToken: entry.pathToken,
          SourceIdentity: entry.sourceIdentity,
          ClaimTypeResolution: entry.claimTypeResolution,
          RequiredValue: 'traffic_or_casco',
        })),
      ReferenceMappings: [],
    },
    NonBlockingLegacy: {
      ReferenceMappings: [...referenceMappings.values()],
      MissingSidecars: {
        Total: plan.entries.filter((entry) => entry.targetState === 'missing_sidecar').length,
        ExistingV2Case: plan.entries.filter((entry) => (entry.missingSidecarClassification?.existingV2CaseCount ?? 0) > 0).length,
        NoExistingV2Case: plan.entries.filter((entry) => entry.targetState === 'missing_sidecar'
          && entry.missingSidecarClassification?.existingV2CaseCount === 0).length,
        CreatedAfterInitialImport: plan.entries.filter((entry) => entry.missingSidecarClassification?.filesystemFreshness === 'created_after_initial_import').length,
        PreexistingOrUnknown: plan.entries.filter((entry) => entry.missingSidecarClassification?.filesystemFreshness === 'preexisting_or_unknown').length,
      },
    },
    Entries: plan.entries.map((entry) => ({
      PathToken: entry.pathToken,
      SourceIdentity: entry.sourceIdentity,
      SourceHash: entry.sourceHash,
      TargetState: entry.targetState,
      TargetCaseId: entry.targetCaseId,
      CandidateCases: entry.candidateCaseEvidence,
      CaseType: entry.caseType,
      ClaimTypeResolution: entry.claimTypeResolution,
      Evidence: entry.evidence,
      Fields: entry.fields.map((field) => ({ Field: field.field, State: field.state })),
      NotesMissing: entry.notes.filter((item) => !item.alreadyImported && !item.duplicateContentCandidate && item.text.trim().length > 0).length,
      OpenTasksMissing: entry.tasks.filter((item) => !item.alreadyImported && !item.duplicateContentCandidate
        && item.title.trim().length > 0 && item.dueDate !== null && !item.completed).length,
      CompletedTasksMissing: entry.tasks.filter((item) => !item.alreadyImported && !item.duplicateContentCandidate
        && item.title.trim().length > 0 && item.dueDate !== null && item.completed && item.sourceCompletedAt !== null).length,
      HistoricalClosure: entry.shouldCloseHistorically,
      FollowUpHistory: entry.needsFollowUpHistory,
      RawRevision: entry.needsRawRevision,
      Alias: entry.needsAlias,
      MoveRenameReconciliations: entry.legacyRecordsToReconcile.filter((item) => item.evidenceCode === 'native_item_unique').length,
      Resolution: {
        Responsible: entry.responsible,
        Expert: entry.expert,
        Service: entry.service,
      },
      Blockers: entry.blockers,
    })),
  }
}

async function main() {
  let pool
  try {
    const args = parseArguments(process.argv.slice(2))
    const resolutions = await readResolutionManifest(args.resolutionFile)
    const config = readDatabaseConfig()
    pool = createDatabasePool({ config, ...(args.apply ? {} : { max: 1 }) })
    if (!args.apply) await pool.query('SET default_transaction_read_only=on')

    const organization = await resolveSingleOrganization(pool)
    const plan = await planV1Remediation(pool, organization.id, args.root, { resolutions })

    if (!args.apply) {
      const preview = { Mode: 'preview', OrganizationCode: organization.code, ...summarizePlan(plan) }
      emit(args.summaryOnly ? { ...preview, Entries: undefined } : preview, 0)
      return
    }

    if (!process.stdin.isTTY) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['STDIN_NOT_INTERACTIVE'] }, 2)
      return
    }

    if (!plan.schemaReady) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['V1_REMEDIATION_SCHEMA_NOT_APPLIED'], PlanHash: plan.planHash }, 2)
      return
    }
    if (plan.summary.duplicatesThatWouldBeCreated !== 0) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['DUPLICATE_RISK_NOT_ZERO'], PlanHash: plan.planHash }, 2)
      return
    }
    if (args.expectedPlanHash !== plan.planHash) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['EXPECTED_PLAN_HASH_MISMATCH'], PlanHash: plan.planHash }, 2)
      return
    }
    const actorUserId = await resolveActor(pool, organization.id, args.actorEmail)

    process.stdout.write('--- HasarBotu V2 — V1 aktarim APPLY ---\n')
    process.stdout.write(`Organizasyon: ${organization.code}\n`)
    process.stdout.write(`Plan hash: ${plan.planHash}\n`)
    process.stdout.write(`Yeni dosya: ${plan.summary.actionable.casesToCreate}, backfill: ${plan.summary.actionable.casesToBackfill}, `)
    process.stdout.write(`yeni not: ${plan.summary.actionable.notesToCreate}, acik gorev: ${plan.summary.actionable.tasksToCreate}, `)
    process.stdout.write(`tamamlanmis gorev: ${plan.summary.actionable.completedTasksToCreate}, tarihsel kapanis: ${plan.summary.actionable.closuresToImport}\n`)
    process.stdout.write(`Insan karari gereken: ${Object.values(plan.summary.humanRequired).reduce((sum, value) => sum + value, 0)}\n\n`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    let confirmation
    try {
      confirmation = await rl.question(`Devam etmek icin tam olarak "UYGULA ${plan.planHash}" yazin: `)
    } finally {
      rl.close()
    }
    if (confirmation.trim() !== `UYGULA ${plan.planHash}`) {
      emit({ Mode: 'apply', Status: 'cancelled_by_user' }, 2)
      return
    }

    // TOCTOU: onaydan SONRA plan TAZE yeniden hesaplanir -- kullanicinin
    // onay yazma suresi icinde baska bir islem gercek durumu degistirmis
    // olabilir; apply HER ZAMAN kendi taze planiyla calisir.
    const freshPlan = await planV1Remediation(pool, organization.id, args.root, { resolutions })
    if (freshPlan.planHash !== plan.planHash) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['PLAN_DRIFT_AFTER_CONFIRMATION'], PlanHash: freshPlan.planHash }, 2)
      return
    }
    const result = await applyV1Remediation(
      pool,
      { organizationId: organization.id, actorUserId, requestId: `v1-import-${Date.now()}` },
      freshPlan,
      { resolutions },
    )
    emit({ Mode: 'apply', Status: 'applied', Result: result }, result.failed > 0 ? 1 : 0)
  } catch (error) {
    emit({ Status: 'error', ErrorCode: error instanceof SafeError ? error.safeCode : 'V1_IMPORT_RUNTIME_ERROR' }, 1)
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  void main()
}
