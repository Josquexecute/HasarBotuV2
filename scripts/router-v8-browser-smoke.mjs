import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer as createViteServer } from 'vite'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
} from '../packages/database/dist/index.js'
import { buildApp, fixedClock, hashPassword } from '../services/api/dist/index.js'

/**
 * React Router v8 gecis smoke'u: kabul edilmis route sozlesmesinin, NavLink
 * active durumunun, derin link/geri-ileri/yenileme davranisinin ve dosya ici
 * sekme navigasyonunun gercek Chrome + gercek API + gercek PostgreSQL uzerinde
 * degismedigini dogrular. Yeni URL veya yeni route eklemez.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL_REQUIRED')
const databaseConfig = assertTestDatabaseUrl(DATABASE_URL)
const repoRoot = resolve(import.meta.dirname, '..')
const APP_ORIGIN = 'http://127.0.0.1:4207'
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
const chromeProfile = mkdtempSync(join(tmpdir(), 'hasarbotu-router-chrome-'))
let app
let vite
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

async function fillPlaceholder(placeholder, value) {
  const encodedPlaceholder = JSON.stringify(placeholder)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const input=document.querySelector('input[placeholder='+JSON.stringify(${encodedPlaceholder})+']');
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

/** Sol menu NavLink'i yalniz href ile tiklanir; rozetli etiketler metinle eslenmez. */
async function clickNav(to) {
  const encoded = JSON.stringify(to)
  await waitFor(`(() => {
    const node=document.querySelector('.sidebar__nav a[href='+JSON.stringify(${encoded})+']');
    if(!node) return false;
    node.click();
    return true;
  })()`)
}

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function assertNoHorizontalOverflow(label) {
  const dimensions = await evaluate(`({
    viewport:window.innerWidth,
    body:document.body.scrollWidth,
    root:document.documentElement.scrollWidth
  })`)
  if (dimensions.body > dimensions.viewport + 1 || dimensions.root > dimensions.viewport + 1) {
    throw new Error(`HORIZONTAL_OVERFLOW_${label}`)
  }
}

/** Bos ekran ve bozuk link regresyonu: calisma alani gercek icerik tasimali. */
async function assertWorkspaceRendered(label) {
  const rendered = await evaluate(
    "(document.querySelector('.workspace')?.textContent ?? '').trim().length",
  )
  if (Number(rendered) < 40) throw new Error(`EMPTY_WORKSPACE_${label}`)
}

const NAVIGATION = [
  { to: '/', label: 'Durum Panosu', expect: 'Operasyon Durumu' },
  { to: '/dosyalar', label: 'Dosyalar', expect: 'Tüm Dosyalar' },
  { to: '/kapanan-dosyalar', label: 'Kapanan Dosyalar', expect: 'Kapanan Dosyalar' },
  { to: '/raporlar-ve-ucretler', label: 'Raporlar ve Ücretler', expect: 'Raporlar ve Ücretler' },
  { to: '/mevzuat-ve-ai', label: 'Mevzuat ve AI Yardımcısı', expect: 'Mevzuat ve AI Yardımcısı' },
  { to: '/bildirimler', label: 'Bildirimler', expect: 'Bildirimler' },
  { to: '/yonetim', label: 'Yönetim', expect: 'Yönetim' },
  { to: '/ayarlar', label: 'Ayarlar', expect: 'Ayarlar' },
]

const DETAIL_TABS = [
  'Özet',
  'Operasyon',
  'Evrak ve Fotoğraf',
  'İşçilik',
  'Ağır Hasar',
  'Değer Kaybı',
  'E-postalar',
  'Geçmiş',
]

/** Aktif NavLink sinifi route degisiminde tek ve dogru baglantida olmalidir. */
async function assertActiveNav(to) {
  const encoded = JSON.stringify(to)
  await waitFor(`(() => {
    const active=[...document.querySelectorAll('.sidebar__nav a.nav-item--active')];
    return active.length===1 && active[0].getAttribute('href')===${encoded};
  })()`)
}

async function sweepNavigation(tag) {
  for (const entry of NAVIGATION) {
    await clickNav(entry.to)
    await waitFor(`location.pathname===${JSON.stringify(entry.to)}`)
    await waitFor(`document.body.textContent.includes(${JSON.stringify(entry.expect)})`)
    await assertActiveNav(entry.to)
    await assertWorkspaceRendered(`${tag}_${entry.to}`)
    await assertNoHorizontalOverflow(`${tag}_${entry.to}`)
  }
}

async function openCaseDetailAndTabs(caseId, tag) {
  await evaluate(`location.href=${JSON.stringify(`${APP_ORIGIN}/dosyalar/${caseId}`)}; true`)
  await waitFor(`location.pathname===${JSON.stringify(`/dosyalar/${caseId}`)}`)
  await waitFor("document.body.textContent.includes('34 RT 4207')")
  await assertWorkspaceRendered(`${tag}_detail`)
  for (const tab of DETAIL_TABS) {
    await clickExact(tab)
    await waitFor(`(() => {
      const active=document.querySelector('.case-tabs .is-active, .case-tabs [aria-selected="true"]');
      return (active?.textContent?.trim() ?? '')===${JSON.stringify(tab)};
    })()`)
    await assertWorkspaceRendered(`${tag}_tab_${tab}`)
    await assertNoHorizontalOverflow(`${tag}_tab_${tab}`)
  }
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const openCaseId = uuidv7()
  const closedCaseId = uuidv7()
  const password = 'router-v8-browser-sentetik-parola-207'
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'router-v8','Router V8 Smoke')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'router-v8@test.local','Router Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,loss_date,notification_date,responsible_user_id,
        version)
     VALUES ($1,$2,2026,4207,'2026/4207','traffic','open','new_notification',
             '34 RT 4207','34RT4207','2026-07-02','2026-07-03',$3,1)`,
    [openCaseId, organizationId, userId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,loss_date,notification_date,responsible_user_id,
        closed_at,version)
     VALUES ($1,$2,2026,4208,'2026/4208','casco','closed','closed',
             '34 RT 4208','34RT4208','2026-07-04','2026-07-05',$3,
             '2026-07-20T10:00:00Z',1)`,
    [closedCaseId, organizationId, userId],
  )
  return {
    openCaseId,
    email: 'router-v8@test.local',
    password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-25T11:00:00.000Z'),
    loggerEnabled: false,
    auth: {
      pool,
      cookieSecure: false,
      loginRateLimit: { limit: 200, windowMs: 60_000 },
    },
  })
  // Vite dev proxy'si `/api` icin 127.0.0.1:3100'e sabittir; API ayni portta acilir.
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4207, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9377',
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9377/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9377/json/new?${encodeURIComponent(`${APP_ORIGIN}/`)}`,
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

  // --- Korumali route: oturum yokken derin link login ekranina duser. ---
  await setViewport(1920, 1080)
  await evaluate(`location.href=${JSON.stringify(`${APP_ORIGIN}/dosyalar/${seeded.openCaseId}`)}; true`)
  await waitFor("document.body.textContent.includes('Giriş Yap')")
  const unauthenticatedDeepLinkPath = await evaluate('location.pathname')
  if (unauthenticatedDeepLinkPath !== `/dosyalar/${seeded.openCaseId}`) {
    throw new Error('PROTECTED_DEEP_LINK_URL_CHANGED')
  }

  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('34 RT 4207')")
  const consoleBaseline = cdp.events.length

  // --- 1920x1080 acik tema: ana navigasyon, dosya detayi ve sekmeler. ---
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='light'")
  await sweepNavigation('light-1920')
  await openCaseDetailAndTabs(seeded.openCaseId, 'light-1920')

  // --- Query string korunumu: global arama Dosyalar'a q ile gider. ---
  await fillPlaceholder('Plaka, dosya no veya isim ara', '34RT4207')
  await evaluate(`(() => {
    const input=document.querySelector('input[placeholder="Plaka, dosya no veya isim ara"]');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  })()`)
  await waitFor("location.pathname==='/dosyalar'")
  await waitFor("new URLSearchParams(location.search).get('q')==='34RT4207'")
  await assertActiveNav('/dosyalar')

  // --- Geri/ileri: query string'li girdi de dahil gecmis sirasi korunur. ---
  await evaluate('history.back(); true')
  await waitFor(`location.pathname===${JSON.stringify(`/dosyalar/${seeded.openCaseId}`)}`)
  await waitFor("document.body.textContent.includes('34 RT 4207')")
  await evaluate('history.forward(); true')
  await waitFor("location.pathname==='/dosyalar' && new URLSearchParams(location.search).get('q')==='34RT4207'")
  await assertWorkspaceRendered('history_forward')

  // --- Yenileme sonrasi ayni route ve query korunur. ---
  await evaluate('location.reload(); true')
  await waitFor("location.pathname==='/dosyalar' && new URLSearchParams(location.search).get('q')==='34RT4207'")
  await waitFor("document.body.textContent.includes('Tüm Dosyalar')")
  await assertActiveNav('/dosyalar')
  await assertWorkspaceRendered('after_reload')

  // --- Bilinmeyen route: catch-all placeholder, URL degismeden. ---
  await evaluate(`location.href=${JSON.stringify(`${APP_ORIGIN}/bilinmeyen-gorunum`)}; true`)
  await waitFor("document.body.textContent.includes('Sayfa Bulunamadı')")
  await waitFor("location.pathname==='/bilinmeyen-gorunum'")
  await assertNoHorizontalOverflow('unknown_route')
  const activeOnUnknown = await evaluate(
    "document.querySelectorAll('.sidebar__nav a.nav-item--active').length",
  )
  if (Number(activeOnUnknown) !== 0) throw new Error('UNKNOWN_ROUTE_MARKS_NAV_ACTIVE')

  // --- 1366x768 koyu tema: ayni sozlesme kucuk ekranda tekrar dogrulanir. ---
  await setViewport(1366, 768)
  await clickNav('/')
  await waitFor("location.pathname==='/'")
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await sweepNavigation('dark-1366')
  await openCaseDetailAndTabs(seeded.openCaseId, 'dark-1366')

  const consoleErrors = cdp.events
    .slice(consoleBaseline)
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    .map((event) => `${event.params.entry.text} ${event.params.entry.url ?? ''}`.trim())
  if (consoleErrors.length > 0) {
    console.error(JSON.stringify({ consoleErrors }))
    throw new Error(`CONSOLE_ERRORS_${consoleErrors.length}`)
  }

  // --- Oturum kapatildiginda korumali route yeniden login'e duser. ---
  await clickExact('Oturumu kapat')
  await waitFor("document.body.textContent.includes('Giriş Yap')")
  await evaluate(`location.href=${JSON.stringify(`${APP_ORIGIN}/yonetim`)}; true`)
  await waitFor("document.body.textContent.includes('Giriş Yap')")
  if (await evaluate("document.body.textContent.includes('Yönetim')")) {
    throw new Error('PROTECTED_ROUTE_LEAKED_AFTER_LOGOUT')
  }

  console.log(JSON.stringify({
    smoke: 'react-router-v8-migration',
    checks: {
      protectedDeepLinkBeforeLogin: true,
      mainNavigationRoutes: NAVIGATION.length,
      navLinkActiveState: true,
      caseDetailRouteParam: true,
      caseDetailTabs: DETAIL_TABS.length,
      queryStringPreserved: true,
      browserBackForward: true,
      reloadKeepsRoute: true,
      unknownRoutePlaceholder: true,
      protectedRouteAfterLogout: true,
      workspaceNeverEmpty: true,
      noHorizontalOverflow: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1366x768-dark'],
  }))
} catch (error) {
  console.error(JSON.stringify({
    smokeError: error instanceof Error ? error.message : String(error),
  }))
  const failed = (cdp?.events ?? [])
    .filter((event) => event.method === 'Network.responseReceived'
      && Number(event.params?.response?.status ?? 0) >= 400)
    .map((event) => `${event.params.response.status} ${event.params.response.url}`)
  if (failed.length > 0) console.error(JSON.stringify({ failedResponses: failed }))
  const logged = (cdp?.events ?? [])
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    .map((event) => `${event.params.entry.text} ${event.params.entry.url ?? ''}`.trim())
  if (logged.length > 0) console.error(JSON.stringify({ consoleErrors: logged }))
  throw error
} finally {
  await cdp?.send('Browser.close').catch(() => undefined)
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
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
