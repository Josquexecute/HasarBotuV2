import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  AUTH_SESSION_ROUTE,
  USERS_ROUTE,
  sessionResponseSchema,
  usersResponseSchema,
} from '@hasarbotu/contracts'
import { startDesktopBridge, type DesktopBridge } from '@hasarbotu/desktop-bridge'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

/**
 * D1 — masaüstü kabuğu için loopback AYNI-ORIGIN köprüsünün gerçek kanıtı.
 *
 * Kanıtlanan şey: Electron renderer'ı TEK bir origin
 * (`http://127.0.0.1:{bridgePort}`) yüklediğinde, mevcut adapter'ların
 * kullandığı GÖRELİ `/api/...` çağrıları çalışır ve `SameSite=Strict`
 * oturum çerezi zinciri bozulmadan taşınır. Böylece API'ye CORS, CSRF token
 * veya static dosya sunumu EKLEMEYE gerek kalmaz.
 *
 * Test bir TARAYICI çalıştırmaz; tarayıcının SameSite kararını taklit etmez.
 * Bunun yerine o kararın dayandığı iki olguyu doğrudan kanıtlar:
 *   (1) çerezi TAŞIYAN istek ile çerezi VEREN istek AYNI origin'dedir, ve
 *   (2) `Set-Cookie` nitelikleri (`SameSite=Strict; HttpOnly; Path=/`)
 *       köprüden geçerken bit-birebir korunur.
 * Tarayıcının kararının GERÇEKTEN gözlendiği yer `scripts/d1-bridge-browser-
 * smoke.mjs`tir (gerçek Chrome/CDP + gerçek üretim build; HB-2026-104). Chrome
 * bir test bağımlılığı olmadığı için o kanıt `npm test` kapsamında değildir.
 *
 * Ayrıca köprünün kimlik UYDURMADIĞI (çerezsiz istek 401 kalır), API
 * erişilemezken sahte başarı ÜRETMEDİĞİ (502) ve yerel sunucunun DNS
 * rebinding'e kapalı olduğu doğrulanır.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'd1-kopru-sentetik-guclu-parola-28'
const SECRET_CONTENT = 'D1-KOK-DISI-SENTETIK-ICERIK'

/**
 * Ham HTTP isteği: `fetch`/WHATWG URL yolu normalize ettiği (ve `..`/`%2e%2e`
 * segmentlerini istemcide sildiği) için traversal ve Host denemeleri yol
 * dizgesi AYNEN gönderilerek yapılır.
 */
function rawRequest(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => { body += chunk })
        response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, body }))
      },
    )
    request.on('error', rejectPromise)
    request.end()
  })
}

describeDb('D1 loopback aynı-origin köprüsü: gerçek login → SameSite=Strict → oturumlu API (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let apiOrigin: string
  let bridge: DesktopBridge
  let assetRoot: string
  let bundleRoot: string
  let adminEmail: string

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    const organizationId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'d1-kopru','D1 Köprü Testi')",
      [organizationId],
    )
    adminEmail = 'd1-kopru-admin@test.local'
    const userId = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [userId, organizationId, adminEmail, 'D1 Yönetici', await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [userId],
    )

    // `cookieSecure: false` — köprü düz HTTP loopback'tir. Bu ayarın üretim
    // masaüstü kurulumundaki karşılığı açık bir dağıtım kararıdır (bkz.
    // DECISION_LOG HB-2026-103).
    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.addresses()[0]
    if (address === undefined) throw new Error('api did not bind')
    apiOrigin = `http://127.0.0.1:${address.port}`

    // Renderer'ın dokümanını sunacak sahte build çıktısı: origin birliğini
    // gerçek bir UI build'ine bağlı olmadan kanıtlar. Varlık kökü, bundle
    // kökünün ALTINDA bir alt dizindir; traversal testi kök dışındaki dosyayı
    // hedefleyebilsin diye gizli dosya bir üst dizine konur.
    bundleRoot = await mkdtemp(join(tmpdir(), 'hb-d1-bridge-'))
    await writeFile(join(bundleRoot, 'gizli-anahtar.txt'), SECRET_CONTENT, 'utf8')
    assetRoot = join(bundleRoot, 'public')
    await mkdir(join(assetRoot, 'assets'), { recursive: true })
    await writeFile(join(assetRoot, 'index.html'), '<!doctype html><title>HasarBotu</title>', 'utf8')
    await writeFile(join(assetRoot, 'assets', 'index-d1.js'), 'export const ok = true\n', 'utf8')

    bridge = await startDesktopBridge({ apiOrigin, assetRoot })
  }, 60_000)

  afterAll(async () => {
    if (bridge !== undefined) await bridge.close()
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (bundleRoot !== undefined) await rm(bundleRoot, { recursive: true, force: true })
  })

  it('gerçek login → SameSite=Strict çerez → aynı origin üzerinden oturumlu API zincirini kanıtlar', async () => {
    // 1) TEK ORIGIN — renderer dokümanı ve API çağrıları aynı authority'de.
    const documentResponse = await fetch(`${bridge.origin}/`)
    expect(documentResponse.status).toBe(200)
    expect(await documentResponse.text()).toContain('HasarBotu')

    // 2) GERÇEK LOGIN, köprü üzerinden. Adapter'ların kullandığı GÖRELİ yolun
    //    aynısı; hiçbir sözleşme değişmedi.
    const loginUrl = `${bridge.origin}${AUTH_LOGIN_ROUTE}`
    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: PASSWORD }),
      redirect: 'manual',
    })
    expect(loginResponse.status).toBe(200)

    const setCookie = loginResponse.headers.getSetCookie()
    expect(setCookie).toHaveLength(1)
    const cookieHeader = setCookie[0] as string
    // 3) SameSite=Strict NİTELİKLERİ köprüden geçerken korunur.
    expect(cookieHeader).toContain('SameSite=Strict')
    expect(cookieHeader).toContain('HttpOnly')
    expect(cookieHeader).toContain('Path=/')
    expect(cookieHeader.startsWith('hb_session=')).toBe(true)

    // 4) Köprünün ürettiği Set-Cookie, API'nin DOĞRUDAN ürettiğiyle nitelik
    //    nitelik AYNI olmalı — köprü çerezi yeniden yazmıyor.
    const directLogin = await fetch(`${apiOrigin}${AUTH_LOGIN_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: PASSWORD }),
      redirect: 'manual',
    })
    expect(directLogin.status).toBe(200)
    const directCookie = directLogin.headers.getSetCookie()[0] as string
    const attributes = (value: string) => value.split(';').slice(1).map((part) => part.trim()).sort()
    expect(attributes(cookieHeader)).toEqual(attributes(directCookie))

    // 5) AYNI ORIGIN olgusu: çerezi veren istek ile onu taşıyacak istek aynı
    //    scheme+host+port'tadır. Tarayıcının `SameSite=Strict` çerezi
    //    göndermesinin dayanağı budur.
    const sessionUrl = `${bridge.origin}${AUTH_SESSION_ROUTE}`
    expect(new URL(sessionUrl).origin).toBe(new URL(loginUrl).origin)
    expect(new URL(sessionUrl).origin).toBe(bridge.origin)

    // 6) OTURUMLU İSTEK — çerez köprü üzerinden API'ye ulaşır ve gerçek
    //    kullanıcıyı çözer.
    const sessionCookie = cookieHeader.split(';')[0] as string
    const sessionResponse = await fetch(sessionUrl, { headers: { cookie: sessionCookie } })
    expect(sessionResponse.status).toBe(200)
    const session = sessionResponseSchema.parse(await sessionResponse.json())
    expect(session.user.email).toBe(adminEmail)
    expect(session.user.roles).toEqual(['admin'])

    // 7) Yetki kapısı da köprüden geçer (HB-011 admin-only ucu).
    const usersResponse = await fetch(`${bridge.origin}${USERS_ROUTE}`, {
      headers: { cookie: sessionCookie },
    })
    expect(usersResponse.status).toBe(200)
    const users = usersResponseSchema.parse(await usersResponse.json())
    expect(users.items.map((item) => item.email)).toEqual([adminEmail])

    // 8) CORS AÇILMADI: ne köprü ne API `access-control-*` üretir. Cross-origin
    //    seçeneğinin neden ek güvenlik yüzeyi gerektireceğinin kanıtı.
    for (const response of [loginResponse, sessionResponse, usersResponse, directLogin]) {
      const corsHeaders = [...response.headers.keys()].filter((name) => name.startsWith('access-control-'))
      expect(corsHeaders).toEqual([])
    }

    // 9) Köprü KİMLİK UYDURMAZ: çerezsiz istek 401 kalır.
    expect((await fetch(sessionUrl)).status).toBe(401)
    expect((await fetch(`${bridge.origin}${USERS_ROUTE}`)).status).toBe(401)
  }, 60_000)

  it('BrowserRouter derin yolunu index.html ile karşılar; eksik varlık 404 kalır', async () => {
    // `src/app/App.tsx` BrowserRouter kullanır: derin route diskte dosya değildir.
    const deepRoute = await fetch(`${bridge.origin}/dosyalar/019fa300-0000-7000-8000-000000003899`)
    expect(deepRoute.status).toBe(200)
    expect(await deepRoute.text()).toContain('HasarBotu')

    const asset = await fetch(`${bridge.origin}/assets/index-d1.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')

    // Eksik bir JS varlığı SESSİZCE index.html dönmemeli; bozuk build gizlenmez.
    expect((await fetch(`${bridge.origin}/assets/yok-boyle-bir-dosya.js`)).status).toBe(404)
  })

  it('traversal varlık kökünün DIŞINDAKİ dosyayı asla sunmaz', async () => {
    // `fetch`/WHATWG URL, `%2e%2e` ve `..` segmentlerini istek gönderilmeden
    // normalize eder; bu yüzden traversal ham HTTP yoluyla denenir.
    for (const rawPath of [
      '/../gizli-anahtar.txt',
      '/%2e%2e/gizli-anahtar.txt',
      '/public/../../gizli-anahtar.txt',
      '/..%2fgizli-anahtar.txt',
    ]) {
      const response = await rawRequest(bridge.port, rawPath)
      // İsteğin sunucuya GERÇEKTEN ulaştığını doğrula; aksi halde aşağıdaki
      // olumsuz assertion boş yere geçerdi.
      expect([200, 400, 403, 404]).toContain(response.status)
      // Kanıtlanan asıl güvenlik özelliği budur: gövde, kök dışındaki dosyanın
      // içeriğini HİÇBİR durumda taşımaz (durum kodu 200/404 olabilir; unknown
      // route SPA kabuğuna düşebilir).
      expect(response.body).not.toContain(SECRET_CONTENT)
    }

    // Olumlu kontrol: aynı ham istek yolu, kök İÇİNDEKİ bir dosya için
    // gerçekten içerik döndürür — yani "içerik dönmedi" sonucu anlamlıdır.
    const inside = await rawRequest(bridge.port, '/assets/index-d1.js')
    expect(inside.status).toBe(200)
    expect(inside.body).toContain('export const ok = true')
  })

  it('loopback dışı Host reddedilir (DNS rebinding)', async () => {
    const rebinding = await rawRequest(bridge.port, AUTH_SESSION_ROUTE, { host: 'kotu.example' })
    expect(rebinding.status).toBe(403)
    // Doğru Host ile aynı yol normal biçimde API'ye ulaşır (401 = oturumsuz).
    const allowed = await rawRequest(bridge.port, AUTH_SESSION_ROUTE)
    expect(allowed.status).toBe(401)
  })

  it('API erişilemezken sahte başarı üretmez (502)', async () => {
    // Boş bir loopback portuna bakan ikinci köprü: upstream kapalı.
    const orphan = await startDesktopBridge({ apiOrigin: 'http://127.0.0.1:1', assetRoot })
    try {
      const response = await fetch(`${orphan.origin}${AUTH_SESSION_ROUTE}`)
      expect(response.status).toBe(502)
      // Ham hata metni veya dosya yolu istemciye taşınmaz.
      expect(await response.text()).toBe('502')
    } finally {
      await orphan.close()
    }
  })
})
