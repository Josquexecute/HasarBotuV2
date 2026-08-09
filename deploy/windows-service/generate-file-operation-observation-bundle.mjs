import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDatabasePool, parseDatabaseUrl } from '@hasarbotu/database'
import { determineSessionSafeCaseStatus } from './pcloud-session0-freshness-gate.mjs'

// D9 sonrasi ilk gercek File Agent isi icin salt-okunur PRODUCTION
// OBSERVATION paketi (HB-2026-178). Sentetik vaka OLUSTURMAZ, hicbir
// dosyaya/DB satirina yazmaz -- yalniz ZATEN VAR OLAN kanitlari (Postgres
// jobs/agents/audit_events/labor_workbook_apply_operations satirlari +
// isteğe bağlı, GUNCEL/bagimsizca yeniden hesaplanan Session-0 freshness
// gate sonucu) tek bir raporda birlestirir.
//
// Kapsam: yalniz 'labor_workbook_apply' target_type'li job'lar -- reponun
// bu oturumda arastirilmis GERCEK sema/kontrat kaniti, pre/post hash
// fence'in (source_workbook_hash/result_workbook_hash) KALICI olarak
// yalniz bu job turu icin var oldugunu gosterdi (services/api/src/labor-
// workbook-apply/store.ts, packages/database/migrations/
// 0044_labor_workbook_apply_runtime.js). Baska bir target_type verilirse
// bu arac YANLIS/EKSIK bir rapor uretmek yerine acikca reddeder.
//
// ONEMLI: freshness-gate KARARI Postgres'te KALICI DEGILDIR (yalniz
// 'case_not_fresh' hata kodu iz birakir -- services/file-agent/src/
// agent.ts, freshness-gate-client.ts kod okumasiyla dogrulandi). Bu
// yuzden bu aracin "FreshnessObservation" bolumu TARIHSEL bir tekrar
// DEGIL, rapor ANINDA BAGIMSIZCA yeniden hesaplanan GUNCEL bir durumdur
// -- bu fark ciktida acikca belirtilir.

export const OBSERVATION_BUNDLE_SCHEMA_VERSION = 'hasarbotu-file-operation-observation-bundle/1.0.0'
const SUPPORTED_TARGET_TYPE = 'labor_workbook_apply'

class ObservationError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/**
 * Job + labor_workbook_apply_operations + agent satirlarini birlestirir.
 * Salt-okunur: hicbir UPDATE/INSERT/DELETE calistirmaz.
 */
export async function assembleJobObservation(pool, { jobId }) {
  const jobResult = await pool.query(
    `SELECT id, organization_id, type, status, target_type, target_id, target_version,
            attempt_count, max_attempts, leased_by_agent_id, lease_expires_at, heartbeat_at,
            next_attempt_at, last_error_code, created_at, updated_at
     FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobResult.rows.length === 0) throw new ObservationError('JOB_NOT_FOUND')
  const job = jobResult.rows[0]

  if (job.target_type !== SUPPORTED_TARGET_TYPE) {
    throw new ObservationError(`UNSUPPORTED_TARGET_TYPE:${job.target_type}`)
  }

  const operationResult = await pool.query(
    `SELECT id, case_id, application_id, revision_id, revision_version, profile_id,
            profile_version_id, profile_version, storage_root_key, relative_workbook_path,
            sheet_name, rule_version, approved_revision_snapshot_hash, status, version,
            source_workbook_hash, preview_plan_hash, previous_total_minor, new_total_minor,
            changed_row_count, unchanged_row_count, control_required_row_count,
            preview_job_id, apply_job_id, approved_by_user_id, approved_at,
            result_workbook_hash, backup_file_name, safe_error_code,
            created_at, updated_at, completed_at
     FROM labor_workbook_apply_operations
     WHERE apply_job_id = $1 OR preview_job_id = $1
     ORDER BY (apply_job_id = $1) DESC
     LIMIT 1`,
    [jobId],
  )
  if (operationResult.rows.length === 0) throw new ObservationError('OPERATION_NOT_FOUND')
  const operation = operationResult.rows[0]

  let agent = null
  if (job.leased_by_agent_id !== null) {
    const agentResult = await pool.query(
      'SELECT id, name, status, last_seen_at, created_at FROM agents WHERE id = $1',
      [job.leased_by_agent_id],
    )
    agent = agentResult.rows[0] ?? null
  }

  const relatedJobIds = [jobId]
  if (operation.preview_job_id !== null && operation.preview_job_id !== jobId) {
    relatedJobIds.push(operation.preview_job_id)
  }
  if (operation.apply_job_id !== null && !relatedJobIds.includes(operation.apply_job_id)) {
    relatedJobIds.push(operation.apply_job_id)
  }

  const auditResult = await pool.query(
    `SELECT id, actor_user_id, action, resource_type, resource_id, request_id, occurred_at, details
     FROM audit_events
     WHERE organization_id = $1
       AND (
         (resource_type = 'labor_workbook_apply' AND resource_id = $2)
         OR (resource_type = 'job' AND resource_id = ANY($3::uuid[]))
       )
     ORDER BY occurred_at ASC`,
    [job.organization_id, operation.id, relatedJobIds],
  )

  return { job, operation, agent, auditEvents: auditResult.rows }
}

/**
 * Bu job'un basarisizliginin BASKA bir vaka/job'u etkilemedigini
 * gosteren izolasyon kaniti -- yeni bir enforcement mekanizmasi DEGIL,
 * mevcut target_id-scoped kuyruk mimarisinin GOZLEMİDİR.
 */
export async function assembleIsolationCheck(pool, { organizationId, jobId, targetId, updatedAt }) {
  const siblingResult = await pool.query(
    `SELECT id, target_id, status, last_error_code, updated_at
     FROM jobs
     WHERE organization_id = $1
       AND id <> $2
       AND status IN ('failed', 'dead_letter')
       AND updated_at BETWEEN $3::timestamptz - interval '1 hour' AND $3::timestamptz + interval '1 hour'
     ORDER BY updated_at ASC`,
    [organizationId, jobId, updatedAt],
  )
  const activeCountResult = await pool.query(
    `SELECT count(*)::int AS c FROM jobs WHERE organization_id = $1 AND status IN ('pending', 'leased')`,
    [organizationId],
  )

  const crossCaseLeak = siblingResult.rows.filter((row) => row.target_id === targetId)
  return {
    otherActiveJobsCount: activeCountResult.rows[0].c,
    otherFailedOrDeadLetterInWindow: siblingResult.rows,
    crossCaseLeakDetected: crossCaseLeak.length > 0,
    verdict: crossCaseLeak.length > 0 ? 'needs_review' : 'isolated',
  }
}

/**
 * GUNCEL, bagimsizca yeniden hesaplanan Session-0 freshness gate sonucu.
 * TARIHSEL karari TEKRARLAMAZ (o Postgres'te yok) -- yalniz rapor aninda
 * ayni mekanizmayla ne dönecegini gosterir (attestation/current-revision
 * eslesmesi dahil, Entries[] icinde).
 */
export async function assembleFreshnessObservation(freshnessInputs) {
  if (freshnessInputs === null) return { skipped: true, reason: 'FRESHNESS_INPUTS_NOT_PROVIDED' }
  const report = await determineSessionSafeCaseStatus(freshnessInputs)
  return {
    skipped: false,
    note: 'Bu, tarihsel bir karar tekrari DEGIL -- rapor aninda bagimsizca yeniden hesaplanan GUNCEL durumdur.',
    ...report,
  }
}

export function computeHashFenceVerdict(operation) {
  if (operation.safe_error_code === 'RESULT_HASH_MISMATCH') return 'mismatch_detected_server_side_rejected'
  if (operation.status === 'completed' && operation.result_workbook_hash !== null) return 'verified_end_to_end'
  return 'incomplete'
}

export async function buildObservationBundle({ pool, jobId, freshnessInputs = null }) {
  const { job, operation, agent, auditEvents } = await assembleJobObservation(pool, { jobId })
  const isolation = await assembleIsolationCheck(pool, {
    organizationId: job.organization_id,
    jobId: job.id,
    targetId: job.target_id,
    updatedAt: job.updated_at,
  })
  const freshness = await assembleFreshnessObservation(freshnessInputs)

  return {
    SchemaVersion: OBSERVATION_BUNDLE_SCHEMA_VERSION,
    GeneratedAtUtc: new Date().toISOString(),
    JobId: job.id,
    Job: {
      Status: job.status,
      Type: job.type,
      AttemptCount: job.attempt_count,
      MaxAttempts: job.max_attempts,
      LastErrorCode: job.last_error_code,
      LeaseExpiresAt: job.lease_expires_at,
      HeartbeatAt: job.heartbeat_at,
      CreatedAt: job.created_at,
      UpdatedAt: job.updated_at,
    },
    Agent: agent === null ? null : {
      Id: agent.id,
      Name: agent.name,
      Status: agent.status,
      LastSeenAt: agent.last_seen_at,
    },
    Operation: {
      CaseId: operation.case_id,
      Status: operation.status,
      RelativeWorkbookPath: operation.relative_workbook_path,
      SheetName: operation.sheet_name,
      ApprovedRevisionSnapshotHash: operation.approved_revision_snapshot_hash,
      SourceWorkbookHash: operation.source_workbook_hash,
      ResultWorkbookHash: operation.result_workbook_hash,
      PreviewPlanHash: operation.preview_plan_hash,
      BackupFileName: operation.backup_file_name,
      SafeErrorCode: operation.safe_error_code,
      CompletedAt: operation.completed_at,
      CreatedAt: operation.created_at,
      UpdatedAt: operation.updated_at,
    },
    HashFence: {
      PreWriteHash: operation.source_workbook_hash,
      PostWriteHash: operation.result_workbook_hash,
      Verdict: computeHashFenceVerdict(operation),
    },
    AuditEventChain: auditEvents.map((row) => ({
      Action: row.action,
      ResourceType: row.resource_type,
      ResourceId: row.resource_id,
      OccurredAt: row.occurred_at,
      Details: row.details,
    })),
    IsolationCheck: {
      OtherActiveJobsCount: isolation.otherActiveJobsCount,
      OtherFailedOrDeadLetterInWindowCount: isolation.otherFailedOrDeadLetterInWindow.length,
      CrossCaseLeakDetected: isolation.crossCaseLeakDetected,
      Verdict: isolation.verdict,
    },
    FreshnessObservation: freshness,
  }
}

function readDatabaseConfigFromEnv() {
  const raw = process.env.DATABASE_URL
  if (typeof raw !== 'string' || raw.length === 0) throw new ObservationError('DATABASE_URL_REQUIRED')
  return parseDatabaseUrl(raw)
}

function parseArguments(argv) {
  const allowed = new Set([
    '--job-id', '--case-relative-path', '--target-root', '--top-level-folder-name',
    '--pcloud-db', '--attestation-store',
  ])
  const values = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!allowed.has(key)) throw new ObservationError(`ARGUMENT_UNKNOWN:${key}`)
    if (values.has(key)) throw new ObservationError(`ARGUMENT_DUPLICATE:${key}`)
    const value = argv[i + 1]
    if (typeof value !== 'string' || value.length === 0) throw new ObservationError(`ARGUMENT_MISSING_VALUE:${key}`)
    values.set(key, value)
    i += 1
  }
  if (!values.has('--job-id')) throw new ObservationError('ARGUMENT_MISSING:--job-id')

  const freshnessKeys = ['--case-relative-path', '--top-level-folder-name', '--pcloud-db', '--attestation-store']
  const providedFreshnessKeys = freshnessKeys.filter((k) => values.has(k))
  let freshnessInputs = null
  if (providedFreshnessKeys.length > 0) {
    if (!values.has('--case-relative-path')) throw new ObservationError('ARGUMENT_MISSING:--case-relative-path')
    const topLevelFolderName = values.get('--top-level-folder-name') ?? process.env.HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER
    const databasePath = values.get('--pcloud-db') ?? process.env.HASARBOTU_AGENT_PCLOUD_DB_PATH
    const attestationStoreDirectory = values.get('--attestation-store') ?? process.env.HASARBOTU_AGENT_ATTESTATION_STORE
    if (!topLevelFolderName) throw new ObservationError('ARGUMENT_MISSING:--top-level-folder-name')
    if (!databasePath) throw new ObservationError('ARGUMENT_MISSING:--pcloud-db')
    if (!attestationStoreDirectory) throw new ObservationError('ARGUMENT_MISSING:--attestation-store')
    freshnessInputs = {
      targetCaseRoot: values.get('--target-root'),
      databasePath,
      topLevelFolderName,
      caseRelativePath: values.get('--case-relative-path'),
      attestationStoreDirectory,
    }
  }

  return { jobId: values.get('--job-id'), freshnessInputs }
}

async function resolveTargetRootIfMissing(pool, args) {
  if (args.freshnessInputs === null || args.freshnessInputs.targetCaseRoot) return args
  const jobResult = await pool.query('SELECT target_id FROM jobs WHERE id = $1', [args.jobId])
  if (jobResult.rows.length === 0) return args
  const operationResult = await pool.query(
    'SELECT storage_root_key FROM labor_workbook_apply_operations WHERE apply_job_id = $1 OR preview_job_id = $1 LIMIT 1',
    [args.jobId],
  )
  const storageRootKey = operationResult.rows[0]?.storage_root_key
  const rootsRaw = process.env.HASARBOTU_AGENT_ROOTS
  if (!storageRootKey || !rootsRaw) return args
  try {
    const roots = JSON.parse(rootsRaw)
    const resolved = roots[storageRootKey]
    if (typeof resolved === 'string' && resolved.length > 0) {
      args.freshnessInputs.targetCaseRoot = resolved
    }
  } catch { /* HASARBOTU_AGENT_ROOTS gecersizse sessizce atlanir -- CLI kendi ARGUMENT_MISSING hatasini verecek */ }
  return args
}

async function main() {
  let pool
  let exitCode = 0
  try {
    let args = parseArguments(process.argv.slice(2))
    const config = readDatabaseConfigFromEnv()
    pool = createDatabasePool({ config })
    args = await resolveTargetRootIfMissing(pool, args)
    if (args.freshnessInputs !== null && !args.freshnessInputs.targetCaseRoot) {
      throw new ObservationError('ARGUMENT_MISSING:--target-root (HASARBOTU_AGENT_ROOTS ile de cozulemedi)')
    }
    const bundle = await buildObservationBundle({ pool, jobId: args.jobId, freshnessInputs: args.freshnessInputs })
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`)
  }
  catch (err) {
    const code = err instanceof ObservationError ? err.code : `UNEXPECTED:${err?.message ?? err}`
    process.stdout.write(`${JSON.stringify({ SchemaVersion: OBSERVATION_BUNDLE_SCHEMA_VERSION, Status: 'error', ReadOnly: true, ErrorCode: code })}\n`)
    exitCode = 1
  }
  finally {
    if (pool) await pool.end()
  }
  process.exitCode = exitCode
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  void main()
}
