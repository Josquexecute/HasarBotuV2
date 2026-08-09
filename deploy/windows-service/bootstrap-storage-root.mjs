import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { uuidv7, parseDatabaseUrl, createDatabasePool, closeDatabasePool } from '@hasarbotu/database'
import { storageRootSchema } from '@hasarbotu/contracts'

// Final production readiness audit (2026-08-09): repo-wide source inspection
// found that `storage_roots` (migration 0006) has NO insert path anywhere --
// `services/api/src/storage/store.ts` and `workspace/store.ts` only ever
// SELECT it (fail-closed `unknown_reference`/`unknown_root` if empty), and
// grep across services/api/src confirms zero `INSERT INTO storage_roots`.
// Live production DB confirmed 0 rows for the real `baran-global` org even
// though D9 already wrote the matching `HASARBOTU_AGENT_ROOTS` env var on
// the File Agent side (rootKey `baran-global-primary`). Since `storage_roots`
// gates the FK on `case_locations`, `case_workspace_provisionings`, and both
// sides of `case_file_operations`/`case_lifecycle_operations`, the very
// first real case's workspace-provisioning/location-assign/file-operation
// would fail closed with `unknown_root`/`unknown_reference` -- this is the
// exact same class of gap as B9 (HB-2026-146/147, missing first-admin
// bootstrap), just one layer deeper. This tool closes it the same way B9
// was closed: a small, fail-closed, idempotent, tested CLI -- NOT a new API
// endpoint (storage roots are rare, high-trust, operator-only records, same
// trust tier as agent registration; `FILE_STORAGE_AND_AGENT_PLAN.md` §2
// already says root config is "yalnız yetkili operatör tarafından
// değiştirilebilir ve auditlenir").
//
// Unlike bootstrap-first-admin.mjs this tool carries no secret, so it is
// plain non-interactive `--apply`, consistent with the OTHER deploy tools
// (deploy-service-artifacts.ps1, provision-extra-data-references.ps1, ...)
// rather than bootstrap-first-admin's TTY-only password prompt.
//
// Reuses, rather than reimplements: `uuidv7` (same id generator every other
// bootstrap/registration path uses -- no DB-side default on `storage_roots.id`),
// `parseDatabaseUrl`/`createDatabasePool` (same DATABASE_URL handling
// `server.ts`/`bootstrap-first-admin.mjs` use), and `storageRootSchema`'s
// `rootKey`/`label` fields from `@hasarbotu/contracts` -- the EXACT same
// zod validation `PUT /api/v1/cases/:caseId/location` and workspace planning
// already enforce, so a value this tool accepts can never be rejected later
// by the API for a format reason.
//
// Unlike a single first-admin bootstrap, more than one storage root can
// legitimately exist over the life of an org (a second office/drive), so
// "already exists" for the exact same (organizationCode, rootKey) pair is a
// normal, idempotent, safe-to-retry outcome here -- not a fail-closed error
// the way a second admin-bootstrap attempt is. The INSERT is additionally
// guarded against a genuine concurrent duplicate (not just same-process
// TOCTOU) by catching the `storage_roots_org_key_unique` violation.

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

const EVIDENCE_ROOT = 'C:\\ProgramData\\HasarBotu\\migration-preflight'
const ADMINISTRATOR_SID_VALUE = 'S-1-5-32-544'
const UNIQUE_VIOLATION = '23505'

const rootKeyFieldSchema = storageRootSchema.shape.rootKey
const labelFieldSchema = storageRootSchema.shape.label

export function validateOrganizationCode(value) {
  if (typeof value !== 'string' || value.trim().length === 0) fail('ORGANIZATION_CODE_INVALID')
  return value.trim()
}

export function validateRootKey(value) {
  const parsed = rootKeyFieldSchema.safeParse(value)
  if (!parsed.success) fail('ROOT_KEY_INVALID')
  return parsed.data
}

export function validateLabel(value) {
  const parsed = labelFieldSchema.safeParse(value)
  if (!parsed.success) fail('LABEL_INVALID')
  return parsed.data
}

/** Same shape used both by preview (against `pool`) and the fresh in-transaction
 * re-check (against the transaction `client`) so they can never disagree. */
export async function getStorageRootReadiness(queryable, organizationCode, rootKey) {
  const orgResult = await queryable.query('SELECT id FROM organizations WHERE code = $1', [organizationCode])
  const organizationId = orgResult.rows[0]?.id ?? null
  if (organizationId === null) {
    return { ready: false, organizationId: null, alreadyExists: false, blockers: ['ORGANIZATION_NOT_FOUND'] }
  }
  const rootResult = await queryable.query(
    'SELECT 1 FROM storage_roots WHERE organization_id = $1 AND root_key = $2',
    [organizationId, rootKey],
  )
  const alreadyExists = rootResult.rowCount > 0
  return {
    ready: !alreadyExists,
    organizationId,
    alreadyExists,
    blockers: alreadyExists ? ['ROOT_KEY_ALREADY_EXISTS'] : [],
  }
}

/**
 * Creates one `storage_roots` row (+ matching audit event) in a single
 * transaction. Readiness is re-checked FRESH inside the transaction (not
 * trusted from an earlier preview call). An already-existing row for the
 * same (organization, rootKey) is reported as `already_exists`, not thrown
 * -- safe to retry the exact same command twice.
 */
export async function bootstrapStorageRoot(pool, input) {
  const organizationCode = validateOrganizationCode(input.organizationCode)
  const rootKey = validateRootKey(input.rootKey)
  const label = validateLabel(input.label)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const readiness = await getStorageRootReadiness(client, organizationCode, rootKey)
    if (readiness.organizationId === null) {
      await client.query('ROLLBACK')
      return { outcome: 'blocked', blockers: readiness.blockers }
    }
    if (readiness.alreadyExists) {
      await client.query('ROLLBACK')
      return { outcome: 'already_exists', organizationId: readiness.organizationId, rootKey }
    }

    const id = uuidv7()
    try {
      await client.query(
        'INSERT INTO storage_roots (id, organization_id, root_key, label) VALUES ($1, $2, $3, $4)',
        [id, readiness.organizationId, rootKey, label],
      )
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION) {
        await client.query('ROLLBACK')
        return { outcome: 'already_exists', organizationId: readiness.organizationId, rootKey }
      }
      throw error
    }

    const auditId = uuidv7()
    // Aynı 8 sütun, `services/api/src/audit/service.ts`'in ürettiğiyle
    // BİREBİR aynı sırada (bkz. bootstrap-first-admin.mjs'deki aynı not).
    await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [auditId, readiness.organizationId, null, 'storage_root.created', 'storage_root', id, null,
        JSON.stringify({ bootstrap: true, rootKey, label })],
    )

    await client.query('COMMIT')
    return { outcome: 'applied', id, organizationId: readiness.organizationId, rootKey, label, auditEventId: auditId }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function writeEvidenceReport(result) {
  try {
    await mkdir(EVIDENCE_ROOT, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '')
    const suffix = randomBytes(4).toString('hex')
    const reportPath = path.join(EVIDENCE_ROOT, `bootstrap-storage-root-${timestamp}-${suffix}.json`)
    const report = {
      schemaVersion: 'hasarbotu-bootstrap-storage-root-evidence/1.0.0',
      generatedAtUtc: new Date().toISOString(),
      hostname: hostname(),
      storageRoot: { id: result.id, organizationId: result.organizationId, rootKey: result.rootKey, label: result.label },
      auditEventId: result.auditEventId,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    const psScript = [
      `$targetPath = ${JSON.stringify(reportPath)}`,
      `$sid = [System.Security.Principal.SecurityIdentifier]::new('${ADMINISTRATOR_SID_VALUE}')`,
      '$security = [System.Security.AccessControl.FileSecurity]::new()',
      '$security.SetAccessRuleProtection($true, $false)',
      '$security.SetOwner($sid)',
      '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)',
      '$security.AddAccessRule($rule)',
      '[System.IO.File]::SetAccessControl($targetPath, $security)',
    ].join('; ')
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript])
    return { reportPath, error: null }
  } catch (error) {
    return { reportPath: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
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

const VALUE_FLAGS = {
  '--organization-code': 'organizationCode',
  '--root-key': 'rootKey',
  '--label': 'label',
}

export function parseArguments(argv) {
  const result = { apply: false, organizationCode: undefined, rootKey: undefined, label: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      result.apply = true
      continue
    }
    const key = VALUE_FLAGS[arg]
    if (key === undefined) fail(`ARGUMENT_UNKNOWN:${arg}`)
    const value = argv[i + 1]
    if (value === undefined) fail(`ARGUMENT_MISSING_VALUE:${arg}`)
    result[key] = value
    i += 1
  }
  if (result.organizationCode === undefined) fail('ARGUMENT_MISSING:--organization-code')
  if (result.rootKey === undefined) fail('ARGUMENT_MISSING:--root-key')
  if (result.label === undefined) fail('ARGUMENT_MISSING:--label')
  return result
}

async function main() {
  let pool
  try {
    const args = parseArguments(process.argv.slice(2))
    const config = readDatabaseConfig()
    pool = createDatabasePool({ config })

    const organizationCode = validateOrganizationCode(args.organizationCode)
    const rootKey = validateRootKey(args.rootKey)
    const label = validateLabel(args.label)

    if (!args.apply) {
      const readiness = await getStorageRootReadiness(pool, organizationCode, rootKey)
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-storage-root/1.0.0',
        Mode: 'preview',
        Status: readiness.organizationId === null ? 'blocked' : readiness.alreadyExists ? 'already_exists' : 'ready',
        OrganizationCode: organizationCode,
        OrganizationFound: readiness.organizationId !== null,
        RootKey: rootKey,
        Label: label,
        AlreadyExists: readiness.alreadyExists,
        Blockers: readiness.blockers,
      }, readiness.organizationId === null ? 2 : 0)
      return
    }

    const result = await bootstrapStorageRoot(pool, { organizationCode, rootKey, label })

    if (result.outcome === 'blocked') {
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-storage-root/1.0.0',
        Mode: 'apply',
        Status: 'blocked',
        Blockers: result.blockers,
      }, 2)
      return
    }
    if (result.outcome === 'already_exists') {
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-storage-root/1.0.0',
        Mode: 'apply',
        Status: 'already_exists',
        OrganizationId: result.organizationId,
        RootKey: result.rootKey,
        Blockers: [],
      }, 0)
      return
    }

    const evidence = await writeEvidenceReport(result)
    emit({
      SchemaVersion: 'hasarbotu-bootstrap-storage-root/1.0.0',
      Mode: 'apply',
      Status: 'applied',
      StorageRootId: result.id,
      OrganizationId: result.organizationId,
      RootKey: result.rootKey,
      Label: result.label,
      AuditEventId: result.auditEventId,
      EvidenceReportPath: evidence.reportPath,
      EvidenceWriteError: evidence.error,
      Blockers: [],
    }, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-bootstrap-storage-root/1.0.0',
      Status: 'error',
      ErrorCode: error instanceof SafeError ? error.safeCode : 'BOOTSTRAP_RUNTIME_ERROR',
    }, 1)
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
