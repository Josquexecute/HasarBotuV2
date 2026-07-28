/**
 * D1 — loopback aynı-origin köprüsünün GERÇEK TARAYICI kanıtı.
 *
 * `services/api/test/desktop-bridge-same-origin-e2e.test.ts` köprünün HTTP
 * davranışını kanıtlar ama tarayıcı ÇALIŞTIRMAZ. Bu smoke o boşluğu kapatır:
 * gerçek Chrome, gerçek ÜRETİM UI build çıktısı (`dist`), gerçek köprü, gerçek
 * API ve gerçek PostgreSQL ile çalışır; Vite dev proxy'si YOKTUR — köprü
 * dağıtım biçiminin ta kendisi test edilir.
 *
 * Tarayıcıdan GÖZLENEREK kanıtlanan olgular:
 *   1. Renderer TEK origin yükler: `http://127.0.0.1:{bridgePort}`.
 *   2. Gerçek login formu → gerçek oturum.
 *   3. Çerezin tarayıcının KENDİ kaydındaki nitelikleri: `sameSite=Strict`,
 *      `httpOnly=true`, `path=/`, host-only `127.0.0.1`, oturum çerezi.
 *   4. `document.cookie` çerezi GÖRMEZ (HttpOnly tarayıcı tarafından uygulanır).
 *   5. Aynı-origin `/api/*` isteği çerezi TAŞIR (CDP `associatedCookies`) ve
 *      gerçek kullanıcıyı çözer; API'ye bağlı ekran gerçek veriyi render eder.
 *   6. Tarayıcı API origin'ine HİÇ istek atmaz (tüm istek URL'leri denetlenir).
 *   7. Tarayıcı hiçbir yanıtta `access-control-*` görmez (CORS açılmadı).
 *   8. ÇAPRAZ SİTE bir başlatıcıdan yapılan üst düzey gezinmede tarayıcı aynı
 *      çerezi GÖNDERMEZ → 401. Aynı hedef URL aynı-site başlatıcıdan 200. Fark
 *      yalnız başlatıcının site'ıdır: CSRF korumasının `SameSite=Strict`
 *      üzerine kurulmasının gerçek tarayıcı kanıtı.
 *
 * Çalıştırma (Windows PowerShell):
 *   $env:TEST_DATABASE_URL = 'postgres://...hasarbotu_test'
 *   npm run build:ui
 *   node scripts/d1-bridge-browser-smoke.mjs
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
} from '../packages/database/dist/index.js'
import { AUTH_SESSION_ROUTE } from '../packages/contracts/dist/index.js'
import { buildApp, hashPassword } from '../services/api/dist/index.js'
import { startDesktopBridge } from '../packages/desktop-bridge/dist/index.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL_REQUIRED')
const databaseConfig = assertTestDatabaseUrl(DATABASE_URL)
const repoRoot = resolve(import.meta.dirname, '..')

// Köprü GERÇEK üretim build çıktısını sunar; dev sunucusu kullanılmaz.
const assetRoot = join(repoRoot, 'dist')
if (!existsSync(join(assetRoot, 'index.html'))) throw new Error('UI_BUILD_MISSING_RUN_BUILD_UI')

const CDP_PORT = 9371
const PLATE = '34 KPR 001'
const EMAIL = 'd1-tarayici@test.local'
const PASSWORD = 'd1-tarayici-sentetik-guclu-parola-28'

const chromeExecutable = [
  process.env.ProgramFiles === undefined
    ? null
    : join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] === undefined
    ? null
    : join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] === undefined
    ? null
    : join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((path) => path !== null && existsSync(path))
if (chromeExecutable === undefined) throw new Error('CHROME_OR_EDGE_NOT_FOUND')

const pool = createDatabasePool({ config: databaseConfig })
const chromeProfile = mkdtempSync(join(tmpdir(), 'hasarbotu-d1-chrome-'))
let app
let bridge
let chrome
let cdp
let apiOpen = false

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.sequence = 0
    this.pending = new Map()
    this.events = []
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id === undefined) {
        this.events.push(message)
        return
      }
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() { this.socket.close() }
}

async function retry(fn, timeoutMs = 25_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await new Promise((resolveWait) => setTimeout(resolveWait, 120))
    }
  }
  throw lastError ?? new Error('retry_timeout')
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails !== undefined) throw new Error('BROWSER_EVALUATION_FAILED')
  return result.result.value
}

async function waitFor(expression, timeoutMs = 25_000) {
  return retry(async () => {
    const value = await evaluate(expression)
    if (!value) throw new Error('browser_condition_pending')
    return value
  }, timeoutMs)
}

const SET_VALUE = `(input,value)=>{
  const prototype=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype
    : input.tagName==='SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}`

async function fillLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.querySelector(':scope > span')?.textContent?.trim()===${encodedLabel});
    const input=label?.querySelector('input,textarea,select');
    if(!input) return false;
    (${SET_VALUE})(input,${encodedValue});
    return true;
  })()`)
}

async function clickExact(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('button,a')].find((item)=>
      item.textContent?.trim()===${encoded} || item.getAttribute('aria-label')===${encoded});
    if(!node || node.disabled) return false;
    node.click();
    return true;
  })()`)
}

/** Adres çubuğu gezinmesi: başlatıcı, o an yüklü olan sayfanın site'ıdır. */
async function navigateTo(url, expectedText) {
  await evaluate(`location.href=${JSON.stringify(url)}; true`)
  await waitFor(`document.body.textContent.includes(${JSON.stringify(expectedText)})`)
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const caseId = uuidv7()
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'d1-tarayici','D1 Tarayıcı Kanıtı')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,$3,'D1 Yönetici',$4,'active')`,
    [userId, organizationId, EMAIL, await hashPassword(PASSWORD)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,1,'2026/1','traffic','open','reporting',$4,'34KPR001',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId, PLATE],
  )
  return { organizationId, userId, caseId }
}

const checks = []
function record(name, detail) {
  checks.push({ check: name, ...detail })
}

try {
  const seeded = await seed()

  // Gerçek API — köprünün ARKASINDA, rastgele loopback portunda. `cookieSecure`
  // düz loopback HTTP olduğu için kapalı (bkz. DECISION_LOG HB-2026-103).
  app = buildApp({
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  apiOpen = true
  const apiAddress = app.addresses()[0]
  if (apiAddress === undefined) throw new Error('API_DID_NOT_BIND')
  const apiOrigin = `http://127.0.0.1:${apiAddress.port}`

  bridge = await startDesktopBridge({ apiOrigin, assetRoot })
  const bridgeOrigin = bridge.origin
  // Köprü `Host: localhost` de kabul eder (policy.ts). `localhost` ile
  // `127.0.0.1` AYRI site'lardır; çapraz-site başlatıcı bu sayede ek bir
  // sunucu olmadan, GERÇEK köprü üzerinden elde edilir.
  const crossSiteOrigin = `http://localhost:${bridge.port}`
  if (new URL(bridgeOrigin).port !== new URL(crossSiteOrigin).port) {
    throw new Error('CROSS_SITE_ORIGIN_PORT_MISMATCH')
  }

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`${bridgeOrigin}/`)}`,
    { method: 'PUT' },
  ).then((response) => response.json())
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.open()
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
    cdp.send('Network.enable'),
  ])
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  })

  // 1) TEK ORIGIN: renderer dokümanı köprüden gelir ve ÜRETİM build'idir
  //    (`import.meta.env.PROD` → veri kaynağı zorunlu olarak 'api').
  await waitFor("document.body.textContent.includes('Giriş Yap')")
  const documentOrigin = await evaluate('location.origin')
  if (documentOrigin !== bridgeOrigin) throw new Error(`DOCUMENT_ORIGIN_${documentOrigin}`)
  record('tek_origin_uretim_build', { documentOrigin, assetRoot })

  // 2) GERÇEK LOGIN — gerçek form, gerçek parola doğrulaması.
  await fillLabel('E-posta', EMAIL)
  await fillLabel('Parola', PASSWORD)
  const loginRequestBaseline = cdp.events.length
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")

  // 3) ÇEREZİN TARAYICI KAYDI. Bu, D1'de eksik kalan doğrudan gözlemdir:
  //    niteliklere Chrome'un kendi çerez deposundan bakılır.
  const cookies = (await cdp.send('Network.getAllCookies')).cookies
  const sessionCookie = cookies.find((cookie) => cookie.name === 'hb_session')
  if (sessionCookie === undefined) throw new Error('SESSION_COOKIE_NOT_STORED')
  if (sessionCookie.sameSite !== 'Strict') throw new Error(`SAMESITE_${sessionCookie.sameSite}`)
  if (sessionCookie.httpOnly !== true) throw new Error('COOKIE_NOT_HTTPONLY')
  if (sessionCookie.path !== '/') throw new Error(`COOKIE_PATH_${sessionCookie.path}`)
  if (sessionCookie.domain !== '127.0.0.1') throw new Error(`COOKIE_DOMAIN_${sessionCookie.domain}`)
  if (sessionCookie.secure !== false) throw new Error('COOKIE_SECURE_ON_PLAIN_LOOPBACK')
  // 12 saatlik TTL `Max-Age` ile taşınır (routes.ts), yani kalıcı çerezdir;
  // tarayıcının kaydettiği son kullanma zamanı da bu TTL'i doğrular.
  const ttlSeconds = Math.round(sessionCookie.expires - Date.now() / 1000)
  if (Math.abs(ttlSeconds - 12 * 60 * 60) > 120) throw new Error(`COOKIE_TTL_${ttlSeconds}`)
  record('cerez_tarayici_kaydi', {
    sameSite: sessionCookie.sameSite,
    httpOnly: sessionCookie.httpOnly,
    path: sessionCookie.path,
    domain: sessionCookie.domain,
    secure: sessionCookie.secure,
    ttlSeconds,
  })

  // 4) HttpOnly tarayıcı tarafından UYGULANIR: sayfa betiği çerezi göremez.
  const scriptVisibleCookies = await evaluate('document.cookie')
  if (String(scriptVisibleCookies).includes('hb_session')) throw new Error('HTTPONLY_NOT_ENFORCED')
  record('httponly_uygulaniyor', { documentCookie: String(scriptVisibleCookies) })

  // 5) AYNI-ORIGIN oturumlu istek: çerez taşınır, gerçek kullanıcı çözülür.
  const session = await evaluate(`(async () => {
    const response=await fetch(${JSON.stringify(AUTH_SESSION_ROUTE)},{credentials:'include'});
    return {status:response.status,body:await response.json()};
  })()`)
  if (session.status !== 200) throw new Error(`SESSION_STATUS_${session.status}`)
  if (session.body?.user?.email !== EMAIL) throw new Error('SESSION_USER_MISMATCH')
  record('ayni_origin_oturumlu_api', {
    status: session.status,
    email: session.body.user.email,
    roles: session.body.user.roles,
  })

  // Çerezin GERÇEKTEN gönderildiği CDP'nin extra-info kaydından doğrulanır;
  // yanıt gövdesine değil, tarayıcının istek kaydına bakılır.
  const sentSessionCookie = cdp.events.some((event) =>
    event.method === 'Network.requestWillBeSentExtraInfo'
    && (event.params?.associatedCookies ?? []).some((entry) =>
      entry.cookie?.name === 'hb_session'
      && (entry.blockedReasons ?? entry.blockedReason ?? []).length === 0))
  if (!sentSessionCookie) throw new Error('COOKIE_NOT_ATTACHED_SAME_ORIGIN')
  record('cerez_ayni_origin_istekte_gonderildi', { observedVia: 'Network.requestWillBeSentExtraInfo' })

  // 6) API'YE BAĞLI EKRAN: gerçek veri köprüden geçerek render edilir.
  await navigateTo(`${bridgeOrigin}/dosyalar`, PLATE)
  await waitFor("document.querySelectorAll('tbody tr').length>0")
  record('api_ekrani_gercek_veri', { route: '/dosyalar', plate: PLATE })

  // 7) TARAYICI API ORIGIN'İNİ HİÇ GÖRMEZ. Tüm istek URL'leri denetlenir.
  const requestUrls = cdp.events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => String(event.params?.request?.url ?? ''))
  const apiAuthority = new URL(apiOrigin).host
  const leaked = requestUrls.filter((url) => url.includes(apiAuthority))
  if (leaked.length > 0) throw new Error(`API_ORIGIN_LEAKED_${leaked[0]}`)
  const bridgeRequests = requestUrls.filter((url) => url.startsWith(bridgeOrigin))
  if (bridgeRequests.length === 0) throw new Error('NO_BRIDGE_REQUESTS_OBSERVED')
  if (loginRequestBaseline > cdp.events.length) throw new Error('EVENT_LOG_TRUNCATED')
  record('tarayici_api_originini_gormedi', {
    apiAuthority,
    observedRequests: requestUrls.length,
    bridgeRequests: bridgeRequests.length,
  })

  // 8) CORS AÇILMADI: tarayıcı hiçbir yanıtta `access-control-*` görmedi.
  const corsHeaders = cdp.events
    .filter((event) => event.method === 'Network.responseReceived')
    .flatMap((event) => Object.keys(event.params?.response?.headers ?? {}))
    .filter((name) => name.toLowerCase().startsWith('access-control-'))
  if (corsHeaders.length > 0) throw new Error(`CORS_HEADER_${corsHeaders[0]}`)
  record('cors_acilmadi', { inspectedResponses: cdp.events.filter((event) => event.method === 'Network.responseReceived').length })

  // 9) SameSite=Strict'in GERÇEK tarayıcı davranışı. Aynı hedef URL, aynı
  //    çerez, aynı sunucu; DEĞİŞEN tek şey başlatıcının site'ı.
  const sessionUrl = `${bridgeOrigin}${AUTH_SESSION_ROUTE}`

  //    (a) Aynı-site başlatıcı (127.0.0.1 sayfası) → çerez gönderilir → 200.
  await navigateTo(sessionUrl, EMAIL)
  const sameSiteBody = await evaluate('document.body.textContent')
  if (!String(sameSiteBody).includes(EMAIL)) throw new Error('SAME_SITE_NAVIGATION_NOT_AUTHENTICATED')

  //    (b) Çapraz-site başlatıcı (localhost sayfası) → aynı URL'ye üst düzey
  //        gezinme; Strict çerezi TUTAR → 401.
  const crossSiteBaseline = cdp.events.length
  await navigateTo(`${crossSiteOrigin}/`, 'Giriş Yap')
  const crossSiteInitiatorOrigin = await evaluate('location.origin')
  if (crossSiteInitiatorOrigin !== crossSiteOrigin) throw new Error('CROSS_SITE_PAGE_NOT_LOADED')
  await navigateTo(sessionUrl, 'unauthorized')
  const crossSiteBody = await evaluate('document.body.textContent')
  if (String(crossSiteBody).includes(EMAIL)) throw new Error('STRICT_COOKIE_SENT_CROSS_SITE')

  //    Tarayıcının çerezi HANGİ GEREKÇEYLE tuttuğu da kaydedilir (varsa).
  const blockedReasons = cdp.events
    .slice(crossSiteBaseline)
    .filter((event) => event.method === 'Network.requestWillBeSentExtraInfo')
    .flatMap((event) => event.params?.associatedCookies ?? [])
    .filter((entry) => entry.cookie?.name === 'hb_session')
    .flatMap((entry) => entry.blockedReasons ?? [])
  record('samesite_strict_capraz_site_tarayici_davranisi', {
    sameSiteInitiator: bridgeOrigin,
    sameSiteResult: 'authenticated_200',
    crossSiteInitiator: crossSiteOrigin,
    crossSiteResult: 'unauthorized_401',
    reportedBlockedReasons: [...new Set(blockedReasons)],
  })

  // 10) Gerçek tarayıcıda da EKSİK VARLIK 404 kalır: `index.html` bir favicon
  //     bildirmediği için Chrome `/favicon.ico` ister ve köprü uzantılı yolu
  //     SPA kabuğuna düşürmez (bozuk build sessizce HTML dönmez).
  const faviconStatuses = cdp.events
    .filter((event) => event.method === 'Network.responseReceived'
      && String(event.params?.response?.url ?? '').endsWith('/favicon.ico'))
    .map((event) => Number(event.params.response.status))
  if (faviconStatuses.length > 0 && faviconStatuses.some((status) => status !== 404)) {
    throw new Error(`FAVICON_STATUS_${faviconStatuses.join(',')}`)
  }
  record('eksik_varlik_404_tarayicida', { faviconStatuses })

  // Tarayıcı konsolunda BEKLENMEYEN hata yok. Beklenenler: favicon 404 (üstte
  // kanıtlandı) ve oturumsuz durumdaki 401 oturum yoklamaları (giriş öncesi
  // sayfa yüklemesi ve kasıtlı çapraz-site gezinme).
  const expectedErrorUrl = (url) => url.endsWith('/favicon.ico') || url.endsWith(AUTH_SESSION_ROUTE)
  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'
      && !expectedErrorUrl(String(event.params.entry.url ?? '')))
    .map((event) => String(event.params.entry.text))
  if (consoleErrors.length > 0) throw new Error(`CONSOLE_ERROR_${consoleErrors[0]}`)

  console.log(JSON.stringify({
    smoke: 'd1-bridge-browser-smoke',
    result: 'PASS',
    bridgeOrigin,
    apiOrigin,
    caseId: seeded.caseId,
    checks,
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    smoke: 'd1-bridge-browser-smoke',
    result: 'FAIL',
    smokeError: error instanceof Error ? error.message : String(error),
    checks,
  }, null, 2))
  const failed = (cdp?.events ?? [])
    .filter((event) => event.method === 'Network.responseReceived'
      && Number(event.params?.response?.status ?? 0) >= 400)
    .map((event) => `${event.params.response.status} ${event.params.response.url}`)
  if (failed.length > 0) console.error(JSON.stringify({ failedResponses: failed }))
  const logs = (cdp?.events ?? [])
    .filter((event) => event.method === 'Log.entryAdded')
    .map((event) => `${event.params.entry.level} ${event.params.entry.text}`)
  if (logs.length > 0) console.error(JSON.stringify({ browserLogs: logs.slice(-10) }))
  process.exitCode = 1
} finally {
  await cdp?.send('Browser.close').catch(() => undefined)
  cdp?.close()
  await bridge?.close().catch(() => undefined)
  if (apiOpen) await app?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) {
    chrome.kill()
    await Promise.race([
      new Promise((resolveExit) => chrome.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ])
  }
  await closeDatabasePool(pool)
  try {
    rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (cleanupError) {
    console.error(JSON.stringify({
      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      chromeProfile,
    }))
  }
}
