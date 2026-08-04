import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '@hasarbotu/api'
import { uuidv7, parseDatabaseUrl, createDatabasePool, closeDatabasePool } from '@hasarbotu/database'
import { userSummarySchema, passwordSchema } from '@hasarbotu/contracts'

// D9 B9 fix (HB-2026-147): one-time-use, fail-closed bootstrap CLI for the
// FIRST organization + admin user. Repo-wide source inspection (HB-2026-146
// readiness audit) confirmed no HTTP endpoint, CLI tool, or migration seed
// anywhere creates a user or organization -- users/store.ts only lists and
// reassigns roles on accounts that ALREADY exist. Without this tool there is
// no way to reach the state where an operator can log in and call
// POST /api/v1/agents (which requires an admin session).
//
// "One-time-use" is not a separate mechanism bolted on top -- it falls out
// for free from the SAME precondition that makes this safe to run at all:
// -Apply refuses unless organizations=0 AND users=0, re-checked FRESH inside
// the same transaction that performs the inserts. After the first successful
// run those counts are never both zero again, so a second run always fails
// closed with the identical guard.
//
// Reuses, rather than reimplements: `hashPassword`/`ARGON2_OPTIONS` (the
// REAL argon2id hashing the login route verifies against), `uuidv7` (the
// SAME id generator `registerAgent`/`createSession` use -- both tables have
// no DB-side id default), `parseDatabaseUrl`/`createDatabasePool` (the SAME
// DATABASE_URL parsing/pool construction `server.ts` uses), and
// `userSummarySchema`/`passwordSchema` (the SAME email/displayName/password
// shape `loginRequestSchema` and the users API response already enforce).
// Organization `code`/`name` have no contracts-level schema (none exists
// anywhere in the repo); validated here against the EXACT same CHECK
// constraints the `organizations` migration itself enforces, so the two can
// never silently drift apart -- a mismatch would simply fail at INSERT time.
//
// The password is NEVER a CLI argument, NEVER written to a file, NEVER
// logged: it is only ever read via `readHiddenLine`, a raw-mode stdin
// reader that echoes nothing (not even asterisks -- same convention as
// ssh/sudo prompts) and only exists in memory for the duration of hashing.
// There is deliberately NO non-interactive/env-var bypass for the password
// in the shipped CLI (`main()`); this keeps `-Apply` un-automatable outside
// a real interactive session. Tests instead call `bootstrapFirstAdmin(...)`
// directly (see .test.mjs), never through stdin emulation.

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

const ORGANIZATION_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/
const EVIDENCE_ROOT = 'C:\\ProgramData\\HasarBotu\\migration-preflight'
const ADMINISTRATOR_SID_VALUE = 'S-1-5-32-544'

const emailFieldSchema = userSummarySchema.shape.email
const displayNameFieldSchema = userSummarySchema.shape.displayName

/** Reads org/user table emptiness + admin-role seeding from ANY Queryable
 * (pool for preview, transaction client for the fresh in-transaction
 * re-check) -- same shape used both places so they can never disagree.
 * Queries run SEQUENTIALLY, not via Promise.all: `queryable` may be a
 * single `pg.PoolClient` (inside the bootstrap transaction), and firing
 * concurrent queries on one client is deprecated in `pg` (only safe on a
 * whole Pool, which internally distributes across separate connections;
 * confirmed via a real deprecation warning during testing). */
export async function getBootstrapReadiness(queryable) {
  const organizationCountResult = await queryable.query('SELECT COUNT(*)::int AS count FROM organizations')
  const userCountResult = await queryable.query('SELECT COUNT(*)::int AS count FROM users')
  const adminRoleResult = await queryable.query("SELECT id FROM roles WHERE code = 'admin'")
  const organizationCount = organizationCountResult.rows[0].count
  const userCount = userCountResult.rows[0].count
  const adminRoleId = adminRoleResult.rows[0]?.id ?? null
  const blockers = []
  if (organizationCount > 0) blockers.push(`ORGANIZATIONS_NOT_EMPTY_${organizationCount}`)
  if (userCount > 0) blockers.push(`USERS_NOT_EMPTY_${userCount}`)
  if (adminRoleId === null) blockers.push('ADMIN_ROLE_NOT_SEEDED')
  return { ready: blockers.length === 0, organizationCount, userCount, adminRoleId, blockers }
}

export function validateOrganizationCode(value) {
  if (typeof value !== 'string' || !ORGANIZATION_CODE_PATTERN.test(value)) {
    fail('ORGANIZATION_CODE_INVALID')
  }
  return value
}

export function validateOrganizationName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('ORGANIZATION_NAME_INVALID')
  }
  return value
}

export function validateEmail(value) {
  const parsed = emailFieldSchema.safeParse(value)
  if (!parsed.success) fail('ADMIN_EMAIL_INVALID')
  return parsed.data
}

export function validateDisplayName(value) {
  const parsed = displayNameFieldSchema.safeParse(value)
  if (!parsed.success) fail('ADMIN_DISPLAY_NAME_INVALID')
  return parsed.data
}

export function validateAdminIdentity(email, displayName) {
  return { email: validateEmail(email), displayName: validateDisplayName(displayName) }
}

export function validateAdminPassword(password, passwordConfirm) {
  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) fail('ADMIN_PASSWORD_INVALID')
  if (password !== passwordConfirm) fail('ADMIN_PASSWORD_CONFIRMATION_MISMATCH')
  return parsed.data
}

/**
 * Bootstraps the first organization + admin user in a single transaction.
 * `pool` may be the real application pool or an isolated test pool -- this
 * function has no knowledge of which. Readiness is re-checked FRESH inside
 * the transaction (not trusted from an earlier preview call, which may be
 * stale by the time an operator finishes typing) before any INSERT.
 */
export async function bootstrapFirstAdmin(pool, input) {
  const organizationCode = validateOrganizationCode(input.organizationCode)
  const organizationName = validateOrganizationName(input.organizationName)
  const { email, displayName } = validateAdminIdentity(input.adminEmail, input.adminDisplayName)
  const password = validateAdminPassword(input.adminPassword, input.adminPasswordConfirm)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const readiness = await getBootstrapReadiness(client)
    if (!readiness.ready) {
      fail(`READINESS_CHANGED_SINCE_CHECK:${readiness.blockers.join(',')}`)
    }

    const passwordHash = await hashPassword(password)
    const organizationId = uuidv7()
    const userId = uuidv7()

    await client.query(
      'INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)',
      [organizationId, organizationCode, organizationName],
    )
    await client.query(
      `INSERT INTO users (id, organization_id, email, display_name, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [userId, organizationId, email, displayName, passwordHash],
    )
    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, readiness.adminRoleId],
    )

    const organizationAuditId = uuidv7()
    const userAuditId = uuidv7()
    // Aynı 8 sütun, `services/api/src/audit/service.ts`deki `AuditService.
    // record()`in ürettiğiyle BİREBİR aynı sırada -- o fonksiyon paketin
    // dışına export edilmediği için (services/api `exports` yalnız kök
    // girişe izin verir) burada aynı şema elle yeniden üretilir, sarmalanmaz.
    await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [organizationAuditId, organizationId, null, 'organization.created', 'organization', organizationId, null,
        JSON.stringify({ bootstrap: true, code: organizationCode })],
    )
    await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [userAuditId, organizationId, null, 'user.created', 'user', userId, null,
        JSON.stringify({ bootstrap: true, email, roles: ['admin'] })],
    )

    await client.query('COMMIT')
    return {
      organizationId,
      organizationCode,
      organizationName,
      userId,
      userEmail: email,
      userDisplayName: displayName,
      auditEventIds: [organizationAuditId, userAuditId],
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// Kontrol karakterleri kaynakta asla harfi harfine (literal) yazilmaz --
// yalniz kod noktasi karsilastirmasiyla (Ctrl-C=3, Backspace=8, DEL=127);
// bu, kaynak dosyada gorunmez/duzenlenemez byte birakmaktan kacinir.
const CONTROL_CODE_ETX = 3
const CONTROL_CODE_BACKSPACE = 8
const CONTROL_CODE_DEL = 127

/** Raw-mode stdin reader that echoes NOTHING (not even asterisks -- same
 * convention as ssh/sudo password prompts). Only ever resolves with a
 * plain string held in memory for the caller to hash and discard; never
 * written to argv, a file, or a log. Iterates every character of each
 * received chunk (not just the first) because pasted input can arrive as
 * one multi-character chunk, not one keystroke per event. */
export function readHiddenLine(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new SafeError('STDIN_NOT_INTERACTIVE'))
      return
    }
    process.stdout.write(promptText)
    const stdin = process.stdin
    stdin.resume()
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    let value = ''
    function cleanup() {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\n' || char === '\r') {
          cleanup()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        const code = char.codePointAt(0)
        if (code === CONTROL_CODE_ETX) {
          cleanup()
          process.stdout.write('\n')
          reject(new SafeError('ABORTED'))
          return
        }
        if (code === CONTROL_CODE_DEL || code === CONTROL_CODE_BACKSPACE) {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

const MAX_FIELD_ATTEMPTS = 3

async function promptField(rl, label, validate) {
  for (let attempt = 1; attempt <= MAX_FIELD_ATTEMPTS; attempt += 1) {
    const raw = (await rl.question(label)).trim()
    try {
      return validate(raw)
    } catch (error) {
      const code = error instanceof SafeError ? error.safeCode : 'FIELD_INVALID'
      process.stdout.write(`  ${code} -- tekrar deneyin (${attempt}/${MAX_FIELD_ATTEMPTS}).\n`)
    }
  }
  throw new SafeError('FIELD_ATTEMPTS_EXHAUSTED')
}

async function promptPasswordWithConfirmation() {
  for (let attempt = 1; attempt <= MAX_FIELD_ATTEMPTS; attempt += 1) {
    const password = await readHiddenLine('Admin parolası (görünmez, en az 10 karakter): ')
    const confirm = await readHiddenLine('Admin parolası (tekrar): ')
    try {
      return validateAdminPassword(password, confirm)
    } catch (error) {
      const code = error instanceof SafeError ? error.safeCode : 'FIELD_INVALID'
      process.stdout.write(`  ${code} -- tekrar deneyin (${attempt}/${MAX_FIELD_ATTEMPTS}).\n`)
    }
  }
  throw new SafeError('FIELD_ATTEMPTS_EXHAUSTED')
}

async function writeEvidenceReport(result) {
  try {
    await mkdir(EVIDENCE_ROOT, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '')
    const suffix = randomBytes(4).toString('hex')
    const reportPath = path.join(EVIDENCE_ROOT, `bootstrap-first-admin-${timestamp}-${suffix}.json`)
    const report = {
      schemaVersion: 'hasarbotu-bootstrap-first-admin-evidence/1.0.0',
      generatedAtUtc: new Date().toISOString(),
      hostname: hostname(),
      organization: { id: result.organizationId, code: result.organizationCode, name: result.organizationName },
      user: { id: result.userId, email: result.userEmail, displayName: result.userDisplayName, roles: ['admin'] },
      auditEventIds: result.auditEventIds,
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

function parseArguments(argv) {
  const allowed = new Set(['--apply'])
  for (const arg of argv) {
    if (!allowed.has(arg)) fail(`ARGUMENT_UNKNOWN:${arg}`)
  }
  return { apply: argv.includes('--apply') }
}

async function main() {
  let pool
  try {
    const args = parseArguments(process.argv.slice(2))
    const config = readDatabaseConfig()
    pool = createDatabasePool({ config })

    const readiness = await getBootstrapReadiness(pool)

    if (!args.apply) {
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-first-admin/1.0.0',
        Mode: 'preview',
        Status: readiness.ready ? 'ready' : 'blocked',
        OrganizationCount: readiness.organizationCount,
        UserCount: readiness.userCount,
        AdminRoleSeeded: readiness.adminRoleId !== null,
        Blockers: readiness.blockers,
      }, readiness.ready ? 0 : 2)
      return
    }

    if (!readiness.ready) {
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-first-admin/1.0.0',
        Mode: 'apply',
        Status: 'blocked',
        OrganizationCount: readiness.organizationCount,
        UserCount: readiness.userCount,
        AdminRoleSeeded: readiness.adminRoleId !== null,
        Blockers: readiness.blockers,
      }, 2)
      return
    }

    if (!process.stdin.isTTY) {
      emit({
        SchemaVersion: 'hasarbotu-bootstrap-first-admin/1.0.0',
        Mode: 'apply',
        Status: 'blocked',
        Blockers: ['STDIN_NOT_INTERACTIVE'],
      }, 2)
      return
    }

    process.stdout.write('--- HasarBotu V2 ilk organizasyon + admin kullanıcısı bootstrap ---\n')
    process.stdout.write('Ön koşullar karşılandı (organizations=0, users=0, admin rolü seed edilmiş).\n')
    process.stdout.write('Bilgiler ekrana YAZILMAYACAK bir parola dışında görünür şekilde girilecek.\n\n')

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    let organizationCode
    let organizationName
    let adminEmail
    let adminDisplayName
    try {
      organizationCode = await promptField(rl, 'Organizasyon kodu (ör. baran-global): ', validateOrganizationCode)
      organizationName = await promptField(rl, 'Organizasyon adı (ör. Baran Global Ekspertiz): ', validateOrganizationName)
      adminEmail = await promptField(rl, 'Admin e-posta: ', validateEmail)
      adminDisplayName = await promptField(rl, 'Admin görünen ad: ', validateDisplayName)
    } finally {
      rl.close()
    }
    const adminPassword = await promptPasswordWithConfirmation()

    const result = await bootstrapFirstAdmin(pool, {
      organizationCode,
      organizationName,
      adminEmail,
      adminDisplayName,
      adminPassword,
      adminPasswordConfirm: adminPassword,
    })
    const evidence = await writeEvidenceReport(result)

    emit({
      SchemaVersion: 'hasarbotu-bootstrap-first-admin/1.0.0',
      Mode: 'apply',
      Status: 'applied',
      OrganizationId: result.organizationId,
      OrganizationCode: result.organizationCode,
      UserId: result.userId,
      UserEmail: result.userEmail,
      AuditEventIds: result.auditEventIds,
      EvidenceReportPath: evidence.reportPath,
      EvidenceWriteError: evidence.error,
      Blockers: [],
    }, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-bootstrap-first-admin/1.0.0',
      Status: 'error',
      ErrorCode: error instanceof SafeError ? error.safeCode : 'BOOTSTRAP_RUNTIME_ERROR',
    }, 1)
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
