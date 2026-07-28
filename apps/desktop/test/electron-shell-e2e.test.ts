import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { AUTH_LOGIN_ROUTE, AUTH_SESSION_ROUTE, USERS_ROUTE } from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '@hasarbotu/api'

/**
 * D2 — ince Electron kabuğunun GERÇEK Electron/Chromium ile kanıtı.
 *
 * D1 (HB-2026-103) köprünün iki olgusunu tarayıcısız kanıtlamıştı. Burada
 * kabuğun kendisi çalıştırılır: gerçek Electron süreci, gerçek Chromium
 * renderer, gerçek API, gerçek PostgreSQL ve gerçek login.
 *
 * Kanıtlanan şeyler:
 *   1. Renderer'da Node YOKTUR ve preload yüzeyi ayrıcalıksızdır.
 *   2. Login → `SameSite=Strict` çerez → oturumlu API zinciri TARAYICININ
 *      KENDİ çerez kavanozuyla çalışır (JS çerezi hiç görmez).
 *   3. CSP gerçekten uygulanır: inline script çalışmaz, dış ağ çıkışı kapalı.
 *   4. Gezinme ve yeni pencere kapıları gerçek Chromium'da tutar.
 *   5. Gerçek ÜRETİM UI build'i bu CSP altında açılır ve gerçek login formu
 *      gerçek oturumu açar.
 *
 * Kapsam dışı (kullanıcı talimatı): code signing, installer, otomatik
 * güncelleme.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'd2-kabuk-sentetik-guclu-parola-28'
const ADMIN_EMAIL = 'd2-kabuk-admin@test.local'

/** D3: allowlist'teki gerçek Gmail compose biçimi. */
const ALLOWLISTED_COMPOSE_URL = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=eksper%40firma.example'

const require_ = createRequire(import.meta.url)
/** `electron` paketi Node'dan import edildiğinde ikili dosyanın YOLUNU verir. */
const ELECTRON_BINARY = require_('electron') as unknown as string

const HARNESS = fileURLToPath(new URL('./harness/e2e-main.mjs', import.meta.url))
/** Gerçek üretim UI build çıktısı (`npm run build:ui`). */
const UI_DIST = fileURLToPath(new URL('../../../dist/', import.meta.url))
/**
 * Üretim build'i olmadan bu kontrol ANLAMLI çalışamaz. Sessizce geçmek yerine
 * AÇIKÇA atlanır (repo kuralı: atlanan kontrol başarılı sayılmaz).
 */
const UI_BUILT = existsSync(join(UI_DIST, 'index.html'))
const itWithUiBuild = UI_BUILT ? it : it.skip

interface ProbeResult {
  readonly done: boolean
  readonly violations: readonly string[]
  readonly inlineScriptExecuted: boolean
  readonly node: Record<string, string>
  readonly preloadKeys: readonly string[] | null
  readonly preloadFunctionKeys: readonly string[] | null
  readonly preloadIsDesktopShell: unknown
  readonly preloadIsDesktopShellAfterMutation: unknown
  readonly cookieBeforeLogin: string
  readonly cookieAfterLogin: string
  readonly loginStatus: number
  readonly sessionStatus: number
  readonly sessionEmail?: string
  readonly sessionRoles?: readonly string[]
  readonly usersStatus: number
  readonly origin: string
  readonly externalFetchBlocked: boolean
  readonly windowOpenResult: string
  readonly windowOpenAllowlistedResult: string
  readonly notificationPermission?: string
  readonly error?: string
}

interface HarnessResult {
  readonly mode: string
  readonly shellOrigin?: string
  readonly loadedUrl?: string
  readonly windowCountAfterLoad?: number
  readonly windowCountAfterOpenAttempt?: number
  readonly urlAfterNavigationAttempt?: string
  readonly openedExternally: readonly string[]
  readonly downloads: readonly { url: string; filename: string; state: string }[]
  readonly webPreferences?: Record<string, boolean>
  readonly consoleMessages: readonly string[]
  readonly loadFailures: readonly { code: number; description: string; url: string }[]
  readonly probe?: ProbeResult | null
  readonly beforeLogin?: { root: number | boolean; login: boolean; shell: boolean } | null
  readonly afterLogin?: { shell: boolean; login: boolean; error: string | null } | null
  readonly loginFormAction?: string
  readonly cookieVisibleToPage?: string
  readonly cookieVisibleToPageAfterLogin?: string
  readonly browserCookies?: readonly {
    name: string
    httpOnly: boolean
    sameSite: string
    secure: boolean
    path: string
    domain: string
    hasValue: boolean
  }[]
  readonly fatalError?: string
}

/** Gerçek Electron sürecini çalıştırır ve sonuç dosyasını okur. */
async function runElectron(
  mode: 'probe' | 'real-ui',
  environment: Readonly<Record<string, string>>,
  workspace: string,
): Promise<HarnessResult> {
  const resultPath = join(workspace, `result-${mode}.json`)
  const userDataDir = join(workspace, `userdata-${mode}`)
  await mkdir(userDataDir, { recursive: true })

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      ELECTRON_BINARY,
      [HARNESS, `--user-data-dir=${userDataDir}`],
      {
        env: {
          ...process.env,
          ...environment,
          HB_E2E_MODE: mode,
          HB_E2E_RESULT: resultPath,
          // Chromium'un GPU/ağ hizmeti gürültüsünü azalt; davranış değişmez.
          ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        },
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    child.on('error', reject)
    child.on('exit', (code) => resolve(code))
  })

  if (!existsSync(resultPath)) {
    throw new Error(`electron harness (${mode}) produced no result; exit code ${String(exitCode)}`)
  }
  return JSON.parse(await readFile(resultPath, 'utf8')) as HarnessResult
}

/**
 * D3: kabuk origin'i DIŞINDAN gerçek bir indirme üreten sunucu. `will-download`
 * ancak gerçek bir yanıt geldiğinde yayıldığı için, var olmayan bir host ile
 * yabancı indirme sınanamaz.
 */
async function startForeignDownloadServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="yabanci.bin"',
    })
    response.end('YABANCI-ORIGIN-ICERIGI')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('foreign server did not bind')
  return {
    url: `http://127.0.0.1:${address.port}/yabanci.bin`,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

describeDb('D2/D3 ince Electron kabuğu: gerçek Chromium + gerçek login + kapılar', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let apiOrigin: string
  let workspace: string
  let probeRoot: string
  let probeResult: HarnessResult
  let realUiResult: HarnessResult | undefined
  let foreignServer: { url: string; close: () => Promise<void> }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    const organizationId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'d2-kabuk','D2 Kabuk Testi')",
      [organizationId],
    )
    const userId = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [userId, organizationId, ADMIN_EMAIL, 'D2 Yönetici', await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [userId],
    )

    // `cookieSecure: false` — köprü düz loopback HTTP'dir (HB-2026-103 açık
    // kalanı). Chromium `http://127.0.0.1`'i güvenli bağlam sayar.
    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.addresses()[0]
    if (address === undefined) throw new Error('api did not bind')
    apiOrigin = `http://127.0.0.1:${address.port}`

    workspace = await mkdtemp(join(tmpdir(), 'hb-d2-shell-'))

    // Probe sayfası: CSP ve preload kanıtları sayfanın KENDİ içinde üretilir.
    // `executeJavaScript` CSP'yi atladığı için bu kanıtlar oradan çıkamaz.
    probeRoot = join(workspace, 'probe')
    await mkdir(probeRoot, { recursive: true })
    await writeFile(
      join(probeRoot, 'index.html'),
      [
        '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>HasarBotu D2</title>',
        '<script src="/probe-init.js"></script>',
        // CSP `script-src \'self\'` gereği bu inline script ÇALIŞMAMALIDIR.
        '<script>window.__hbInlineRan = true</script>',
        '</head><body><div id="root"></div><script src="/probe-run.js"></script></body></html>',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(probeRoot, 'probe-init.js'),
      [
        'window.__hb = { done: false, violations: [] }',
        "document.addEventListener('securitypolicyviolation', (event) => {",
        '  window.__hb.violations.push(event.violatedDirective)',
        '})',
      ].join('\n'),
      'utf8',
    )
    await writeFile(join(probeRoot, 'probe-run.js'), buildProbeScript(), 'utf8')

    const downloadDir = join(workspace, 'indirmeler')
    await mkdir(downloadDir, { recursive: true })
    foreignServer = await startForeignDownloadServer()

    probeResult = await runElectron('probe', {
      HASARBOTU_API_ORIGIN: apiOrigin,
      HASARBOTU_ASSET_ROOT: probeRoot,
      HB_E2E_DOWNLOAD_DIR: downloadDir,
      HB_E2E_FOREIGN_DOWNLOAD_URL: foreignServer.url,
    }, workspace)

    if (UI_BUILT) {
      realUiResult = await runElectron('real-ui', {
        HASARBOTU_API_ORIGIN: apiOrigin,
        HASARBOTU_ASSET_ROOT: UI_DIST,
        HB_E2E_EMAIL: ADMIN_EMAIL,
        HB_E2E_PASSWORD: PASSWORD,
      }, workspace)
    }
  }, 240_000)

  afterAll(async () => {
    if (foreignServer !== undefined) await foreignServer.close()
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  })

  it('kabuk gerçek Electron ile açılır ve güvenli webPreferences uygular', () => {
    expect(probeResult.fatalError).toBeUndefined()
    expect(probeResult.loadFailures).toEqual([])
    expect(probeResult.webPreferences).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    })
    // Renderer TEK origin yükler; yüklenen adres köprünün loopback origin'idir.
    expect(probeResult.loadedUrl?.startsWith(probeResult.shellOrigin ?? 'x')).toBe(true)
    expect(probeResult.shellOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(probeResult.windowCountAfterLoad).toBe(1)
  })

  it('renderer Node görmez ve preload yüzeyi ayrıcalıksızdır', () => {
    const probe = requireProbe(probeResult)
    expect(probe.error).toBeUndefined()
    // `nodeIntegration=false` + `sandbox=true` gerçek Chromium'da gözlendi.
    expect(probe.node).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      Buffer: 'undefined',
      global: 'undefined',
      __dirname: 'undefined',
      ipcRenderer: 'undefined',
    })
    // Preload allowlist: yalnız iki VERİ alanı; hiçbir fonksiyon yok.
    expect(probe.preloadKeys).toEqual(['isDesktopShell', 'platform'])
    expect(probe.preloadFunctionKeys).toEqual([])
    expect(probe.preloadIsDesktopShell).toBe(true)
    // Sayfa yüzeyi değiştiremez.
    expect(probe.preloadIsDesktopShellAfterMutation).toBe(true)
  })

  it('gerçek login → SameSite=Strict çerez → oturumlu API zinciri gerçek tarayıcıda çalışır', () => {
    const probe = requireProbe(probeResult)
    // Çerez hiçbir aşamada sayfaya görünmez: HttpOnly'yi Chromium uygular.
    expect(probe.cookieBeforeLogin).not.toContain('hb_session')
    expect(probe.loginStatus).toBe(200)
    expect(probe.cookieAfterLogin).not.toContain('hb_session')
    // ASIL KANIT: JS çerezi hiç görmediği hâlde SONRAKİ istek oturumu taşır —
    // yani Chromium'un kendi çerez kavanozu `SameSite=Strict` çerezi aynı
    // origin'e gönderdi.
    expect(probe.sessionStatus).toBe(200)
    expect(probe.sessionEmail).toBe(ADMIN_EMAIL)
    expect(probe.sessionRoles).toEqual(['admin'])
    // HB-011 admin-only kapısı da kabuktan geçer.
    expect(probe.usersStatus).toBe(200)
    expect(probe.origin).toBe(probeResult.shellOrigin)
  })

  it('CSP gerçek Chromium tarafından uygulanır', () => {
    const probe = requireProbe(probeResult)
    // Inline script çalışmadı; Chromium ihlali `script-src-elem` olarak
    // raporladı (`script-src`in eleman düzeyindeki türevi).
    expect(probe.inlineScriptExecuted).toBe(false)
    expect(probe.violations).toContain('script-src-elem')
    // Dış ağ çıkışı `connect-src 'self'` ile kapalı: XSS olsa bile veri
    // sızdırılamaz.
    expect(probe.externalFetchBlocked).toBe(true)
    expect(probe.violations).toContain('connect-src')
  })

  it('gezinme, yeni pencere ve izin kapıları gerçek Chromium\'da tutar', () => {
    const probe = requireProbe(probeResult)
    // `window.open` HİÇBİR hedef için Electron penceresi açmaz — allowlist'te
    // olan hedef bile. Uzak içerik kabuğun içine girmez.
    expect(probe.windowOpenResult).toBe('null')
    expect(probe.windowOpenAllowlistedResult).toBe('null')
    expect(probeResult.windowCountAfterOpenAttempt).toBe(1)
    // Hiçbir izin verilmez.
    expect(probe.notificationPermission).toBe('denied')
    // Sayfa başlatmalı uzak gezinme adresi değiştirmedi.
    expect(probeResult.urlAfterNavigationAttempt?.startsWith(probeResult.shellOrigin ?? 'x')).toBe(true)
    expect(probeResult.urlAfterNavigationAttempt).not.toContain('ornek.gecersiz.example')
  })

  it('D3: yalnız allowlist\'teki hedef işletim sistemine devredilir', () => {
    // UI'ın GERÇEK harici bağlantı yolu budur: Gmail ve mevzuat bağlantıları
    // `target="_blank"` ile açılır, yani `setWindowOpenHandler`dan geçer.
    //
    // Gerçek Chromium'da gözlenen devir listesi. Gerçek tarayıcı AÇILMAZ;
    // kabuğun işletim sistemine VERDİĞİ URL doğrudan kaydedilir.
    expect(probeResult.openedExternally).toEqual([ALLOWLISTED_COMPOSE_URL])
    // Allowlist dışındaki hedef, aynı `window.open` yolundan geçmesine rağmen
    // HİÇBİR biçimde devredilmedi.
    expect(probeResult.openedExternally.join(' ')).not.toContain('ornek.gecersiz.example')
  })

  it('D3: kabuk origin\'inden indirme geçer, yabancı origin\'den indirme iptal edilir', () => {
    const downloads = probeResult.downloads
    expect(downloads).toHaveLength(2)

    // 1) UI'ın gerçek akışıyla aynı biçim: kabuk origin'i üzerinde `blob:`.
    const own = downloads[0]
    expect(own?.url.startsWith(`blob:${probeResult.shellOrigin ?? 'x'}/`)).toBe(true)
    expect(own?.state).toBe('completed')

    // 2) Kabuk origin'i DIŞINDAN gerçek bir indirme yanıtı: iptal edilir.
    const foreign = downloads[1]
    expect(foreign?.url).toBe(foreignServer.url)
    expect(foreign?.state).toBe('cancelled')
  })

  itWithUiBuild('gerçek üretim UI build\'i kabuğun CSP\'si altında açılır ve gerçek login oturumu açar (önce `npm run build:ui`)', () => {
    if (realUiResult === undefined) throw new Error('real-ui koşumu sonuç üretmedi')
    const result = realUiResult
    expect(result.fatalError).toBeUndefined()
    expect(result.loadFailures).toEqual([])
    // Uygulama gerçekten mount oldu ve login ekranı geldi.
    expect(result.beforeLogin?.login).toBe(true)
    expect(result.loginFormAction).toBe('submitted')
    // Gerçek form → gerçek API → gerçek oturum: uygulama kabuğu render edildi.
    expect(result.afterLogin?.error).toBeNull()
    expect(result.afterLogin?.shell).toBe(true)
    expect(result.afterLogin?.login).toBe(false)
    // Oturum çerezi sayfaya hiç görünmedi.
    expect(result.cookieVisibleToPage).not.toContain('hb_session')
    expect(result.cookieVisibleToPageAfterLogin).not.toContain('hb_session')
    // Chromium'un KENDİ çerez kaydı: nitelikleri tarayıcı uyguluyor.
    expect(result.browserCookies).toHaveLength(1)
    const cookie = result.browserCookies?.[0]
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('strict')
    expect(cookie?.secure).toBe(false)
    expect(cookie?.path).toBe('/')
    expect(cookie?.hasValue).toBe(true)
    // Üretim UI'ı bu CSP altında hiçbir ihlal üretmedi.
    const violations = result.consoleMessages.filter((message) => (
      message.includes('Content Security Policy') || message.includes('Refused to')
    ))
    expect(violations).toEqual([])
  })
})

function requireProbe(result: HarnessResult): ProbeResult {
  const probe = result.probe
  if (probe === undefined || probe === null) {
    throw new Error(`probe sonucu yok; fatalError=${String(result.fatalError)}`)
  }
  expect(probe.done).toBe(true)
  return probe
}

/**
 * Sayfanın kendi içinde koşan probe betiği. Gerçek `fetch` çağrıları
 * adapter'ların kullandığı GÖRELİ yolların aynısını kullanır; hiçbir sözleşme
 * değişmez.
 */
function buildProbeScript(): string {
  return `(async () => {
  const hb = window.__hb
  try {
    hb.node = {
      require: typeof require,
      process: typeof process,
      module: typeof module,
      Buffer: typeof Buffer,
      global: typeof global,
      __dirname: typeof __dirname,
      ipcRenderer: typeof window.ipcRenderer,
    }
    const surface = window.hasarbotuDesktop
    hb.preloadKeys = surface ? Object.keys(surface).sort() : null
    hb.preloadFunctionKeys = surface ? Object.keys(surface).filter((key) => typeof surface[key] === 'function') : null
    hb.preloadIsDesktopShell = surface ? surface.isDesktopShell : null
    try { surface.isDesktopShell = false } catch (ignored) { hb.preloadMutationThrew = true }
    hb.preloadIsDesktopShellAfterMutation = surface ? surface.isDesktopShell : null

    hb.cookieBeforeLogin = document.cookie
    const login = await fetch(${JSON.stringify(AUTH_LOGIN_ROUTE)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(ADMIN_EMAIL)}, password: ${JSON.stringify(PASSWORD)} }),
    })
    hb.loginStatus = login.status
    hb.cookieAfterLogin = document.cookie

    const session = await fetch(${JSON.stringify(AUTH_SESSION_ROUTE)})
    hb.sessionStatus = session.status
    if (session.ok) {
      const body = await session.json()
      hb.sessionEmail = body.user.email
      hb.sessionRoles = body.user.roles
    }
    const users = await fetch(${JSON.stringify(USERS_ROUTE)})
    hb.usersStatus = users.status
    hb.origin = window.location.origin

    try {
      await fetch('https://ornek.gecersiz.example/')
      hb.externalFetchBlocked = false
    } catch (ignored) {
      hb.externalFetchBlocked = true
    }

    try {
      hb.windowOpenResult = window.open('https://ornek.gecersiz.example/') === null ? 'null' : 'window'
    } catch (ignored) {
      hb.windowOpenResult = 'threw'
    }

    // Allowlist'teki hedef de Electron penceresi AÇMAMALI; işletim sistemine
    // devredilmelidir. Devredildiği main process tarafında gözlenir.
    try {
      hb.windowOpenAllowlistedResult = window.open(${JSON.stringify(ALLOWLISTED_COMPOSE_URL)}) === null ? 'null' : 'window'
    } catch (ignored) {
      hb.windowOpenAllowlistedResult = 'threw'
    }

    if (typeof Notification !== 'undefined') {
      hb.notificationPermission = await Notification.requestPermission()
    }
    hb.inlineScriptExecuted = window.__hbInlineRan === true
  } catch (error) {
    hb.error = error && error.message ? error.message : String(error)
  }
  hb.done = true
})()
`
}
