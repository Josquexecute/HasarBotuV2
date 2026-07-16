import { existsSync } from 'node:fs'
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

const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL_REQUIRED')
const databaseConfig = assertTestDatabaseUrl(DATABASE_URL)
const repoRoot = resolve(import.meta.dirname, '..')
const chromeExecutable = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync)
if (chromeExecutable === undefined) throw new Error('CHROME_OR_EDGE_NOT_FOUND')

const pool = createDatabasePool({ config: databaseConfig })
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
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (pending === undefined) return
        this.pending.delete(message.id)
        if (message.error !== undefined) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else {
        this.events.push(message)
      }
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

async function retry(fn, timeoutMs = 15_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try { return await fn() } catch (error) {
      lastError = error
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
  }
  throw lastError ?? new Error('retry_timeout')
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) throw new Error('BROWSER_EVALUATION_FAILED')
  return result.result.value
}

async function waitFor(expression, timeoutMs = 15_000) {
  return retry(async () => {
    const value = await evaluate(expression)
    if (!value) throw new Error('browser_condition_pending')
    return value
  }, timeoutMs)
}

async function fillLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>node.querySelector(':scope > span')?.textContent?.trim()===${encodedLabel});
    const input=label?.querySelector('input,textarea,select');
    if(!input) return false;
    const prototype=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype
      : input.tagName==='SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${encodedValue});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
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

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
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

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const closedCaseId = uuidv7()
  const password = 'p38-browser-sentetik-parola-42'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p38-browser','P38 Browser Sentetik')", [organizationId])
  await pool.query(
    "INSERT INTO users (id,organization_id,email,display_name,password_hash,status) VALUES ($1,$2,'p38-browser@test.local','P38 Sorumlu',$3,'active')",
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='case_manager'", [userId])
  for (let index = 1; index <= 101; index += 1) {
    const id = uuidv7()
    const sequence = 3800 + index
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,updated_at)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','new_notification',$5,$6,$7,'2026-07-16',$8)`,
      [
        id,
        organizationId,
        sequence,
        `2026/${sequence}`,
        `34 API ${String(index).padStart(3, '0')}`,
        `34API${String(index).padStart(3, '0')}`,
        userId,
        new Date(2026, 6, 16, 12, 0, index % 60),
      ],
    )
  }
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,notification_date)
     VALUES ($1,$2,2026,3999,'2026/3999','casco','closed','closed','34 KPL 038','34KPL038',$3,'2026-07-12')`,
    [closedCaseId, organizationId, userId],
  )
  return { closedCaseId, email: 'p38-browser@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-16T12:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true
  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4178, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9338',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p38-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9338/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9338/json/new?${encodeURIComponent('http://127.0.0.1:4178/')}`,
    { method: 'PUT' },
  ).then((response) => response.json())
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.open()
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Log.enable'), cdp.send('Network.enable')])
  await setViewport(1366, 768)

  await waitFor("document.body.textContent.includes('Giriş Yap')")
  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")

  await evaluate("document.querySelector('a[href=\"/dosyalar\"]')?.click(); true")
  await waitFor("document.querySelectorAll('.case-table tbody tr').length===101")
  const listTruth = await evaluate(`({
    rows:document.querySelectorAll('.case-table tbody tr').length,
    tables:document.querySelectorAll('table').length,
    href:location.pathname,
    text:document.body.textContent
  })`)
  if (listTruth.rows !== 101) {
    console.error(JSON.stringify({ rows: listTruth.rows, tables: listTruth.tables, href: listTruth.href, text: String(listTruth.text).slice(0, 500) }))
    throw new Error('PAGINATION_DID_NOT_LOAD_ALL_OPEN_CASES')
  }
  if (listTruth.text.includes('Zorunlu evraklar tam') || listTruth.text.includes('₺0')) {
    throw new Error('LIST_FALSE_CERTAINTY_VISIBLE')
  }
  if (!listTruth.text.includes('Evrak özeti bu listede hesaplanmıyor')) throw new Error('LIST_UNKNOWN_STATE_MISSING')
  await assertNoHorizontalOverflow('CASES_1366_LIGHT')

  await evaluate(`sessionStorage.setItem('hasarbotu-active-case-tab','İşçilik'); location.href=${JSON.stringify(`http://127.0.0.1:4178/dosyalar/${seeded.closedCaseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 KPL 038')")
  await waitFor("document.body.textContent.includes('Bu modül henüz gerçek API verisine bağlı değildir')")
  const detailText = await evaluate('document.body.textContent')
  if (detailText.includes('Ön tampon kaplama') || detailText.includes('PERT adayı değil')) throw new Error('DETAIL_MOCK_LEAK')

  await evaluate("location.href='http://127.0.0.1:4178/kapanan-dosyalar'; true")
  await waitFor("location.pathname==='/kapanan-dosyalar' && document.body.textContent.includes('34 KPL 038')")
  const closedText = await evaluate('document.body.textContent')
  if (closedText.includes('26 ESK 26')) throw new Error('CLOSED_CASE_MOCK_LEAK')
  if (!closedText.includes('Kapanış ayrıntısı henüz bağlı değil')) throw new Error('CLOSED_CASE_UNKNOWN_STATE_MISSING')

  await evaluate("location.href='http://127.0.0.1:4178/raporlar-ve-ucretler'; true")
  await waitFor("location.pathname==='/raporlar-ve-ucretler' && document.body.textContent.includes('Gerçek rapor verisi henüz bağlı değil')")
  const reportsText = await evaluate('document.body.textContent')
  if (reportsText.includes('Onaylı Eksper Ücreti')) throw new Error('REPORTS_MOCK_LEAK')

  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('REPORTS_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('REPORTS_1920_DARK')

  const browserProblems = cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params?.type)
    if (event.method === 'Log.entryAdded') {
      const entry = event.params?.entry
      if (!['error', 'warning'].includes(entry?.level)) return false
      const url = String(entry?.url ?? '')
      return !(entry?.source === 'network' && (
        url.endsWith('/favicon.ico')
        || url.endsWith('/api/v1/auth/session')
      ))
    }
    return false
  })
  if (browserProblems.length > 0) {
    console.error(JSON.stringify(browserProblems.map((event) => ({
      method: event.method,
      type: event.params?.type ?? null,
      level: event.params?.entry?.level ?? null,
      source: event.params?.entry?.source ?? null,
      url: event.params?.entry?.url ?? null,
    }))))
    throw new Error('BROWSER_CONSOLE_NOT_CLEAN')
  }

  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 15_000)
  const afterShutdown = await evaluate('document.body.textContent')
  if (afterShutdown.includes('34 MPA 764') || afterShutdown.includes('34 KPL 038')) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      allOpenPages: true,
      closedDetailDirectRead: true,
      unsupportedModulesFailClosed: true,
      realClosedCases: true,
      reportsFailClosed: true,
      noFallback: true,
      consoleClean: true,
    },
    resolutions: ['1366x768-light', '1366x768-dark', '1920x1080-dark'],
  }))
} finally {
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) chrome.kill()
  await closeDatabasePool(pool)
}
