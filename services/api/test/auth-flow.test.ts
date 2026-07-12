import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  failureEnvelopeSchema,
  sessionResponseSchema,
  AUTH_LOGIN_ROUTE,
  AUTH_LOGOUT_ROUTE,
  AUTH_SESSION_ROUTE,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword, SESSION_COOKIE_NAME } from '../src/index.js'

/**
 * Ucdan uca auth akisi (gercek PostgreSQL). TEST_DATABASE_URL yoksa acikca
 * atlanir; `_test` soneki assertTestDatabaseUrl ile zorunludur.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-42'
const EMAIL = 'eksper@baran.example'

describeDb('auth uclari (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let userId: string

  function cookieFrom(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
    expect(raw).toBeDefined()
    return (raw as string).split(';')[0] as string
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    const orgId = uuidv7()
    userId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
      orgId,
      'baran-global',
      'Baran Global',
    ])
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId, EMAIL, 'Test Eksper', await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code IN ('expert','admin')",
      [userId],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('gecerli girisle oturum acar: sema, roller ve guvenli cerez', async () => {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { user: { roles: string[] } }
    expect(sessionResponseSchema.safeParse(body).success).toBe(true)
    expect(body.user.roles).toEqual(['admin', 'expert'])

    const setCookie = String(response.headers['set-cookie'])
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(response.payload).not.toContain(PASSWORD)
    expect(response.payload).not.toContain('password')
  })

  it('yanlis parola ve bilinmeyen e-posta AYNI tekduze 401 doner (enumeration yok)', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: 'yanlis-parola-42' },
    })
    const unknownUser = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: 'yok@baran.example', password: 'yanlis-parola-42' },
    })
    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUser.statusCode).toBe(401)
    const bodyA = wrongPassword.json() as { error: { code: string; message: string } }
    const bodyB = unknownUser.json() as { error: { code: string; message: string } }
    expect(bodyA.error.code).toBe('unauthorized')
    expect(bodyA.error.message).toBe(bodyB.error.message)
    expect(failureEnvelopeSchema.safeParse(bodyA).success).toBe(true)

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.login_failed'",
    )
    expect((audit.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2)
  })

  it('gecersiz govde 400 validation_error doner; deger sizmaz', async () => {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: 'kisa', fazla: 1 },
    })
    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
    expect(response.payload).not.toContain('kisa')
  })

  it('oturum ucu cerezle kullaniciyi doner; cerezsiz 401', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    const cookie = cookieFrom(loginResponse.headers['set-cookie'])

    const withCookie = await app.inject({
      method: 'GET',
      url: AUTH_SESSION_ROUTE,
      headers: { cookie },
    })
    expect(withCookie.statusCode).toBe(200)
    expect(sessionResponseSchema.safeParse(withCookie.json()).success).toBe(true)

    const withoutCookie = await app.inject({ method: 'GET', url: AUTH_SESSION_ROUTE })
    expect(withoutCookie.statusCode).toBe(401)
  })

  it('logout oturumu iptal eder: cerez temizlenir, session 401, revoked_at dolar; tekrar logout idempotent', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    const cookie = cookieFrom(loginResponse.headers['set-cookie'])

    const logout = await app.inject({ method: 'POST', url: AUTH_LOGOUT_ROUTE, headers: { cookie } })
    expect(logout.statusCode).toBe(204)
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0')

    const after = await app.inject({ method: 'GET', url: AUTH_SESSION_ROUTE, headers: { cookie } })
    expect(after.statusCode).toBe(401)

    const revoked = await pool.query(
      'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL',
      [userId],
    )
    expect((revoked.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1)

    const again = await app.inject({ method: 'POST', url: AUTH_LOGOUT_ROUTE, headers: { cookie } })
    expect(again.statusCode).toBe(204)
  })

  it('5 basarisiz denemede hesap kilitlenir; dogru parola bile 401 olur; audit kaydi vardir', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: AUTH_LOGIN_ROUTE,
        payload: { email: EMAIL, password: 'yanlis-parola-42' },
      })
    }
    const locked = await pool.query('SELECT locked_until FROM users WHERE id = $1', [userId])
    expect((locked.rows[0] as { locked_until: Date | null }).locked_until).not.toBeNull()

    const correctWhileLocked = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    expect(correctWhileLocked.statusCode).toBe(401)

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.account_locked' AND actor_user_id = $1",
      [userId],
    )
    expect((audit.rows[0] as { n: number }).n).toBe(1)

    // sonraki testleri etkilememesi icin kilidi ac
    await pool.query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [userId],
    )
  })

  it('hiz siniri asilinca 429 rate_limited ve Retry-After doner', async () => {
    const limitedApp = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 2, windowMs: 60_000 } },
    })
    try {
      const payload = { email: 'hiz@baran.example', password: 'herhangi-parola-1' }
      await limitedApp.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload })
      await limitedApp.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload })
      const third = await limitedApp.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload })
      expect(third.statusCode).toBe(429)
      const body = third.json() as { error: { code: string } }
      expect(body.error.code).toBe('rate_limited')
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      await limitedApp.close()
    }
  })

  it('auth yapilandirilmamis uygulamada login yolu guvenli 404 doner', async () => {
    const bare = buildApp({ loggerEnabled: false })
    try {
      const response = await bare.inject({
        method: 'POST',
        url: AUTH_LOGIN_ROUTE,
        payload: { email: EMAIL, password: PASSWORD },
      })
      expect(response.statusCode).toBe(404)
      expect((response.json() as { error: { code: string } }).error.code).toBe('not_found')
    } finally {
      await bare.close()
    }
  })
})
