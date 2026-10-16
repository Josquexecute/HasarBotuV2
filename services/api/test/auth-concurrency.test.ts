import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { createAuthStore } from '../src/auth/store.js'
import { hashPassword } from '../src/auth/password.js'
import { createFixedWindowLimiter } from '../src/auth/rate-limit.js'
import { login } from '../src/auth/service.js'
import { createAuditService } from '../src/audit/service.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('password login concurrent account changes', () => {
  let pool: pg.Pool
  let organizationId: string
  let userId: string
  let passwordHash: string
  const password = 'synthetic-concurrency-password-42'
  const email = 'concurrency@example.test'

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [organizationId, 'auth-concurrency', 'Synthetic office'])
    passwordHash = await hashPassword(password)
  }, 60_000)
  beforeEach(async () => {
    userId = uuidv7()
    await pool.query('UPDATE users SET email=id::text WHERE email=$1', [email])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)',
      [userId, organizationId, email, 'Synthetic user', passwordHash])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [userId])
  })
  afterAll(async () => { if (pool) await closeDatabasePool(pool) })

  async function loginAcrossChange(change: () => Promise<unknown>) {
    const store = createAuthStore(pool)
    const find = store.findUserByEmail
    store.findUserByEmail = async value => {
      const snapshot = await find(value)
      await change()
      return snapshot
    }
    return login({ pool, store, audit: createAuditService(), limiter: createFixedWindowLimiter({ limit: 10, windowMs: 60_000 }) },
      { email, password, ip: '127.0.0.1', requestId: uuidv7() })
  }

  it.each(['disabled', 'pending'] as const)('does not issue a session when status becomes %s after the initial read', async status => {
    expect((await loginAcrossChange(() => pool.query('UPDATE users SET status=$2 WHERE id=$1', [userId, status]))).kind).toBe('invalid')
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id=$1', [userId])).rowCount).toBe(0)
  })

  it('does not clear a concurrent lockout or issue a usable session', async () => {
    const result = await loginAcrossChange(() => pool.query("UPDATE users SET failed_login_count=5,locked_until=now()+interval '15 minutes' WHERE id=$1", [userId]))
    expect(result.kind).toBe('invalid')
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id=$1', [userId])).rowCount).toBe(0)
    expect((await pool.query('SELECT failed_login_count FROM users WHERE id=$1', [userId])).rows[0].failed_login_count).toBe(5)
  })

  it('does not accept a password hash that changed during verification', async () => {
    const replacement = await hashPassword('a-different-synthetic-password-42')
    expect((await loginAcrossChange(() => pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [userId, replacement]))).kind).toBe('invalid')
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id=$1', [userId])).rowCount).toBe(0)
  })

  it('resets the current failed count after a successful login', async () => {
    expect((await loginAcrossChange(() => pool.query('UPDATE users SET failed_login_count=2 WHERE id=$1', [userId]))).kind).toBe('ok')
    expect((await pool.query('SELECT failed_login_count FROM users WHERE id=$1', [userId])).rows[0].failed_login_count).toBe(0)
  })

  it('starts a fresh failure window when an earlier lockout has expired', async () => {
    await pool.query("UPDATE users SET failed_login_count=5,locked_until=now()-interval '1 minute' WHERE id=$1", [userId])
    const count = await createAuthStore(pool).recordFailedLogin(userId, 5, 15)
    expect(count).toEqual({ failedLoginCount: 1, lockedUntil: null, lockStarted: false })
  })

  it('does not extend an active lockout for a failure already in flight', async () => {
    const row = (await pool.query("UPDATE users SET failed_login_count=5,locked_until=now()+interval '1 minute' WHERE id=$1 RETURNING locked_until", [userId])).rows[0]
    const count = await createAuthStore(pool).recordFailedLogin(userId, 5, 15)
    expect(count).toEqual({ failedLoginCount: 5, lockedUntil: row.locked_until, lockStarted: false })
  })

  it('serializes concurrent failures and starts exactly one account lockout', async () => {
    const store = createAuthStore(pool)
    const results = await Promise.all(Array.from({ length: 10 }, () => store.recordFailedLogin(userId, 5, 15)))
    expect(results.filter(result => result.lockStarted)).toHaveLength(1)
    const row = (await pool.query('SELECT failed_login_count,locked_until FROM users WHERE id=$1', [userId])).rows[0]
    expect(row.failed_login_count).toBe(5)
    expect(row.locked_until).toBeInstanceOf(Date)
  })
})
