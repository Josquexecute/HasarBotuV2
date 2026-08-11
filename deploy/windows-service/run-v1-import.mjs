import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { applyV1Import, planV1Import } from '@hasarbotu/api'
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

function parseArguments(argv) {
  const result = { apply: false, root: null, actorEmail: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') { result.apply = true; continue }
    if (arg === '--root') { result.root = argv[i + 1] ?? null; i += 1; continue }
    if (arg === '--actor-email') { result.actorEmail = argv[i + 1] ?? null; i += 1; continue }
    fail(`ARGUMENT_UNKNOWN:${arg}`)
  }
  if (result.root === null || result.root.length === 0) fail('ROOT_REQUIRED')
  if (result.actorEmail === null || result.actorEmail.length === 0) fail('ACTOR_EMAIL_REQUIRED')
  return result
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
  if (result.rows.length !== 1) fail(`ACTOR_NOT_FOUND_OR_NOT_UNIQUE:${email}`)
  return result.rows[0].id
}

function summarizePlan(plan) {
  return {
    SchemaVersion: 'hasarbotu-v1-import/1.0.0',
    OrganizationId: plan.organizationId,
    Root: plan.rootPath,
    GeneratedAt: plan.generatedAt,
    Summary: plan.summary,
    Entries: plan.entries.map((entry) => ({
      RelativePath: entry.folder.relativePath,
      Action: entry.action,
      Reasons: entry.reasons,
      ClaimType: entry.claimType,
      Closed: entry.closed,
      ClosedConflicting: entry.closedConflicting,
      MatchedCaseId: entry.matchedCaseId,
      MatchedCaseCandidateCount: entry.matchedCaseCandidateCount,
      FieldBackfills: entry.fieldBackfills.map((f) => ({ Field: f.field, Decision: f.decision.kind })),
      NewNotes: entry.notes.filter((n) => !n.alreadyImported).length,
      NewTasks: entry.tasks.filter((t) => !t.alreadyImported).length,
      UnmatchedTaskAssignees: entry.tasks.filter((t) => !t.alreadyImported && t.assignedUserId === null && t.assignedSourceName.length > 0).map((t) => t.assignedSourceName),
    })),
  }
}

async function main() {
  let pool
  try {
    const args = parseArguments(process.argv.slice(2))
    const config = readDatabaseConfig()
    pool = createDatabasePool({ config })

    const organization = await resolveSingleOrganization(pool)
    const plan = await planV1Import(pool, organization.id, args.root)

    if (!args.apply) {
      emit({ Mode: 'preview', OrganizationCode: organization.code, ...summarizePlan(plan) }, 0)
      return
    }

    if (!process.stdin.isTTY) {
      emit({ Mode: 'apply', Status: 'blocked', Blockers: ['STDIN_NOT_INTERACTIVE'] }, 2)
      return
    }

    const actorUserId = await resolveActor(pool, organization.id, args.actorEmail)

    process.stdout.write('--- HasarBotu V2 — V1 aktarim APPLY ---\n')
    process.stdout.write(`Organizasyon: ${organization.code}\n`)
    process.stdout.write(`Yeni dosya: ${plan.summary.toCreate}, backfill: ${plan.summary.toBackfill}, `)
    process.stdout.write(`yeni not: ${plan.summary.notesToImport}, yeni gorev: ${plan.summary.tasksToImport}\n`)
    process.stdout.write(`Celiski/atlanan (DOKUNULMAYACAK): ${plan.summary.conflicts + plan.summary.unknownClaimType + plan.summary.unparseableFolderName + plan.summary.malformedOrUnsupportedJson}\n\n`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    let confirmation
    try {
      confirmation = await rl.question('Devam etmek icin tam olarak "UYGULA" yazin: ')
    } finally {
      rl.close()
    }
    if (confirmation.trim() !== 'UYGULA') {
      emit({ Mode: 'apply', Status: 'cancelled_by_user' }, 2)
      return
    }

    // TOCTOU: onaydan SONRA plan TAZE yeniden hesaplanir -- kullanicinin
    // onay yazma suresi icinde baska bir islem gercek durumu degistirmis
    // olabilir; apply HER ZAMAN kendi taze planiyla calisir.
    const freshPlan = await planV1Import(pool, organization.id, args.root)
    const result = await applyV1Import(
      pool,
      { organizationId: organization.id, actorUserId, requestId: `v1-import-${Date.now()}` },
      freshPlan,
    )
    emit({ Mode: 'apply', Status: 'applied', Result: result }, result.failed > 0 ? 1 : 0)
  } catch (error) {
    emit({ Status: 'error', ErrorCode: error instanceof SafeError ? error.safeCode : 'V1_IMPORT_RUNTIME_ERROR', Message: error instanceof Error ? error.message : String(error) }, 1)
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  void main()
}
