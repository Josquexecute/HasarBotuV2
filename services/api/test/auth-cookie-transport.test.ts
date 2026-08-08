import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { AUTH_LOGIN_ROUTE, AUTH_SESSION_ROUTE } from '@hasarbotu/contracts'
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
 * HB-2026-175 (auth-transport): gerçek TCP + gerçek HTTP çerez davranışını
 * kanıtlar -- `app.inject()` (kabuk içi çağrı, gerçek soket/çerez taşımasını
 * ATLAR) DEĞİL, gerçek `app.listen()` + gerçek `fetch()`.
 *
 * Kanıtlanan gerçek olay: gerçek üretim makinesinde `NODE_ENV=production`
 * (dolayısıyla `cookieSecure=true`, bkz. config.ts) API'ye karşı düz
 * `http://127.0.0.1` üzerinden `Invoke-RestMethod -SessionVariable` ile
 * giriş yapıldı -- login 200 döndü ve Set-Cookie GERÇEKTEN gönderildi, ama
 * .NET'in `CookieContainer`'ı (Invoke-RestMethod'un WebSession'ı) `Secure`
 * işaretli bir çerezi düz HTTP üzerinden asla otomatik OLARAK yeniden
 * göndermez (RFC 6265 §5.4) -- bu yüzden sonraki `POST /api/v1/agents`
 * çağrısı çerezsiz gitti ve `401 unauthorized` döndü. Bu, GERÇEK bir tarayıcı
 * çerez kavanozu için de AYNI şekilde geçerlidir -- hiçbir tarayıcı/.NET
 * istemcisi `Secure` işaretli bir çerezi düz HTTP'de otomatik göndermez.
 *
 * Bu dosya iki gerçek durumu ayrı ayrı, gerçek HTTP üzerinden kanıtlar:
 *   A) cookieSecure=false (yalnız doğrulanmış loopback-only opt-in ile
 *      mümkün, bkz. config.ts `parseCookieSecure`) -- Set-Cookie'de `Secure`
 *      YOK, gerçek bir istemcinin (biz de dahil, aynı token'ı elle
 *      yeniden göndererek) düz HTTP'de oturumu GERÇEKTEN sürdürebildiği
 *      kanıtlanır: login -> authenticated GET -> 200, çerezsiz -> 401.
 *   B) cookieSecure=true (varsayılan, fail-closed) -- Set-Cookie'de
 *      `Secure` niteliğinin GERÇEKTEN var olduğu doğrudan doğrulanır. Bu
 *      TEK gerçek, yeterli kanıttır: RFC 6265 §5.4 gereği HERHANGİ bir
 *      standart-uyumlu istemci (tarayıcı, .NET CookieContainer, curl'ün
 *      kendi çerez kavanozu) bu niteliği taşıyan bir çerezi düz HTTP
 *      isteğine asla otomatik eklemez -- bu davranışı yeniden simüle etmeye
 *      gerek yoktur, yalnızca sunucunun bu niteliği GERÇEKTEN gönderdiğini
 *      kanıtlamak yeterlidir.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-transport-42'
const EMAIL = 'transport-admin@baran.example'

describeDb('auth çerez taşıma sözleşmesi (gerçek TCP + gerçek HTTP, HB-2026-175)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let userId: string

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    const orgId = uuidv7()
    userId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
      orgId,
      'baran-global-transport',
      'Baran Global Transport Test',
    ])
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId, EMAIL, 'Transport Admin', await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'admin'",
      [userId],
    )
  }, 60_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  async function withRealServer(
    cookieSecure: boolean,
    run: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    const app: FastifyInstance = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    try {
      await app.listen({ host: '127.0.0.1', port: 0 })
      const address = app.addresses()[0]
      expect(address).toBeDefined()
      await run(`http://127.0.0.1:${address!.port}`)
    } finally {
      await app.close()
    }
  }

  it('A) cookieSecure=false (doğrulanmış loopback-only): Set-Cookie Secure TAŞIMAZ, gerçek HTTP üzerinden oturum GERÇEKTEN sürer', async () => {
    await withRealServer(false, async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}${AUTH_LOGIN_ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      })
      expect(loginResponse.status).toBe(200)

      const setCookie = loginResponse.headers.get('set-cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      // Bu turun tam kanıtı: Secure niteliği GERÇEKTEN yok -- gerçek bir
      // tarayıcı/.NET çerez kavanozu bu çerezi düz HTTP'de otomatik
      // gönderirdi (RFC 6265 §5.4, Secure niteliği YOKSA kısıtlama yok).
      expect(setCookie).not.toContain('Secure')

      const sessionCookie = (setCookie as string).split(';')[0] as string

      const authenticated = await fetch(`${baseUrl}${AUTH_SESSION_ROUTE}`, {
        headers: { cookie: sessionCookie },
      })
      expect(authenticated.status).toBe(200)
      const body = (await authenticated.json()) as { user: { email: string } }
      expect(body.user.email).toBe(EMAIL)

      const withoutCookie = await fetch(`${baseUrl}${AUTH_SESSION_ROUTE}`)
      expect(withoutCookie.status).toBe(401)
    })
  })

  it('B) cookieSecure=true (fail-closed varsayılan): Set-Cookie Secure GERÇEKTEN taşır -- gerçek bir istemci bunu düz HTTPte asla otomatik göndermez', async () => {
    await withRealServer(true, async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}${AUTH_LOGIN_ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      })
      expect(loginResponse.status).toBe(200)

      const setCookie = loginResponse.headers.get('set-cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      // Bu, gerçek üretim makinesinde yaşanan 401'in KÖK NEDENİNİN doğrudan
      // kanıtıdır: Secure niteliği GERÇEKTEN burada. RFC 6265 §5.4 gereği
      // hiçbir standart-uyumlu istemci (tarayıcı, .NET CookieContainer)
      // bunu düz http:// isteğine otomatik eklemez -- bu tek gerçek
      // yeterli kanıttır, istemci davranışını yeniden simüle etmeye gerek
      // yoktur.
      expect(setCookie).toContain('Secure')
    })
  })
})
