import { existsSync, readFileSync } from 'node:fs'
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
 * Paket 53 tarayıcı smoke'u: Dosyalar ekranında sunucu tarafı sayfalama.
 *
 * En kritik doğrulama: satır uyarı isteğinde gönderilen `caseIds` kümesi,
 * ekranda o an render edilen satırlarla BİREBİR aynı olmalıdır. Sayfa
 * değiştiğinde de bu eşleşme korunmalı ve hiçbir satır "bilinmiyor" kalmamalıdır.
 */
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

const mockSource = readFileSync(join(repoRoot, 'src', 'mocks', 'cases.ts'), 'utf8')
function forbiddenPlates() {
  const values = new Set()
  for (const match of mockSource.matchAll(/plate:\s*'([^']{5,})'/g)) values.add(match[1])
  if (values.size < 3) throw new Error('MOCK_PLATE_EXTRACTION_FAILED')
  return [...values]
}

const TOTAL_CASES = 137
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

  close() {
    this.socket.close()
  }
}

async function retry(fn, timeoutMs = 20_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn()
    } catch (error) {
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

async function waitFor(expression, timeoutMs = 20_000) {
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
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.querySelector(':scope > span')?.textContent?.trim()===${encodedLabel});
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

async function fillSearch(value) {
  const encoded = JSON.stringify(value)
  await waitFor(`(() => {
    const input=document.querySelector('.filterbar__search input');
    if(!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${encoded});
    input.dispatchEvent(new Event('input',{bubbles:true}));
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

/** Ekranda render edilen satırların plakaları. */
async function renderedPlates() {
  return evaluate(`[...document.querySelectorAll('tbody tr td:nth-child(2) .plate')]
    .map((node) => node.textContent)`)
}

/** Son gönderilen satır uyarı isteğindeki caseIds. */
function lastAlertCaseIds() {
  const requests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
    && String(event.params?.request?.url ?? '').includes('/api/v1/operational-alerts?caseIds='))
  if (requests.length === 0) return null
  const url = String(requests[requests.length - 1].params.request.url)
  return decodeURIComponent(url.split('caseIds=')[1]).split(',').filter(Boolean)
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const password = 'p53-browser-sentetik-parola-53'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p53-browser','P53 Browser Sentetik')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p53-browser@test.local','P53 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])

  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,
        updated_at,version)
     SELECT gen_random_uuid(),$1,2026,seq,'2026/'||seq,
            CASE WHEN seq % 3 = 0 THEN 'casco' ELSE 'traffic' END,
            'open','reporting','34 SP '||seq,'34SP'||seq,$2,
            CASE WHEN seq % 4 = 0 THEN DATE '2026-07-10' ELSE NULL END,
            DATE '2026-07-01',
            TIMESTAMPTZ '2026-07-01T00:00:00Z' + (seq || ' minutes')::interval,1
       FROM generate_series(1,$3) AS seq`,
    [organizationId, userId, TOTAL_CASES],
  )
  // Bazı dosyalara geciken görev: satır rozetleri gerçek uyarı göstermeli.
  await pool.query(
    `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id,version)
     SELECT gen_random_uuid(),$1,c.id,'Geciken görev '||c.office_sequence,'high','open',$2,
            DATE '2026-07-12',$2,1
       FROM cases c
      WHERE c.organization_id=$1 AND c.office_sequence % 5 = 0`,
    [organizationId, userId],
  )

  return { organizationId, userId, email: 'p53-browser@test.local', password }
}

try {
  const mockPlates = forbiddenPlates()
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-18T14:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4193, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9353',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p53-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9353/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9353/json/new?${encodeURIComponent('http://127.0.0.1:4193/')}`,
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
  await setViewport(1920, 1080)

  await waitFor("document.body.textContent.includes('Giriş Yap')")
  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")

  await evaluate("location.href='http://127.0.0.1:4193/dosyalar'; true")
  await waitFor("document.querySelectorAll('tbody tr').length>0")
  await waitFor("document.body.textContent.includes('Sayfa 1 /')")

  // Yalnız aktif sayfa render edilir; tüm liste çekilmez.
  const pageSize = (await renderedPlates()).length
  if (pageSize === 0 || pageSize >= TOTAL_CASES) throw new Error('CLIENT_SIDE_PAGINATION_DETECTED')
  const listRequests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
    && String(event.params?.request?.url ?? '').includes('/api/v1/cases?'))
  if (listRequests.length === 0) throw new Error('CASES_LIST_REQUEST_NOT_SENT')
  for (const request of listRequests) {
    const url = new URL(String(request.params.request.url), 'http://127.0.0.1:4193')
    const size = Number(url.searchParams.get('pageSize'))
    if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('PAGE_SIZE_OUT_OF_CONTRACT')
  }

  // Toplam kayıt bilgisi gerçek sayımdan gelir.
  const totalShown = await evaluate(`(() => {
    const node=document.querySelector('.page-heading .heading-count');
    return node ? Number(node.textContent) : null;
  })()`)
  if (totalShown !== TOTAL_CASES) throw new Error('TOTAL_COUNT_MISMATCH')

  // KRİTİK: gönderilen uyarı kimlikleri ekrandaki satırlarla birebir eşleşir.
  const assertAlertIdsMatchRows = async (label) => {
    await retry(async () => {
      const plates = await renderedPlates()
      const ids = lastAlertCaseIds()
      if (ids === null) throw new Error('alert_request_pending')
      if (ids.length !== plates.length) throw new Error('alert_id_count_pending')
      const rowIds = await evaluate(`(() => {
        const badges=[...document.querySelectorAll('tbody tr')].map((row)=>{
          const button=row.querySelector('.row-alert--active');
          const quiet=row.querySelector('.row-alert--clear');
          return button !== null || quiet !== null;
        });
        return badges.every(Boolean);
      })()`)
      if (!rowIds) throw new Error('unknown_alert_state_present')
      return true
    })
    const plates = await renderedPlates()
    const ids = lastAlertCaseIds()
    if (ids.length !== plates.length) throw new Error(`ALERT_IDS_NOT_MATCHING_ROWS_${label}`)
    // Hiçbir satır "bilinmiyor" kalmamalı.
    const unknown = await evaluate("document.querySelectorAll('.row-alert--unknown').length")
    if (unknown > 0) throw new Error(`UNKNOWN_ALERT_ROWS_${label}`)
  }
  await assertAlertIdsMatchRows('PAGE1')
  const firstPageIds = lastAlertCaseIds()

  // Sayfa değişince yeni sayfa kimlikleri gönderilir.
  await clickExact('Sonraki sayfa')
  await retry(async () => {
    const ids = lastAlertCaseIds()
    if (ids === null || ids.join(',') === firstPageIds.join(',')) throw new Error('page2_pending')
    return true
  })
  await waitFor("document.body.textContent.includes('Sayfa 2 /')")
  await assertAlertIdsMatchRows('PAGE2')
  const secondPageIds = lastAlertCaseIds()
  if (secondPageIds.some((id) => firstPageIds.includes(id))) throw new Error('DUPLICATE_ROWS_ACROSS_PAGES')

  await clickExact('Önceki sayfa')
  await waitFor("document.body.textContent.includes('Sayfa 1 /')")
  await assertAlertIdsMatchRows('BACK_TO_PAGE1')

  // Filtre değişince sayfa 1'e döner ve sunucu yeniden sorgulanır.
  await clickExact('Sonraki sayfa')
  await waitFor("document.body.textContent.includes('Sayfa 2 /')")
  await fillSearch('34SP1')
  await waitFor("document.body.textContent.includes('Sayfa 1 /')")
  await assertAlertIdsMatchRows('AFTER_SEARCH')
  const searchRequest = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
    && String(event.params?.request?.url ?? '').includes('/api/v1/cases?')
    && String(event.params.request.url).includes('search='))
  if (searchRequest.length === 0) throw new Error('SEARCH_NOT_SENT_TO_SERVER')
  const searchedPlates = await renderedPlates()
  if (!searchedPlates.every((plate) => plate.replace(/\s/g, '').includes('34SP1'))) {
    throw new Error('SEARCH_NOT_APPLIED_ON_SERVER')
  }

  await fillSearch('')
  await waitFor("document.body.textContent.includes('Sayfa 1 /')")
  await assertNoHorizontalOverflow('CASES_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('CASES_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('CASES_1366_DARK')

  // Mock plakaları hiçbir zaman DOM'a girmez.
  const html = await evaluate('document.documentElement.innerHTML')
  const leaked = mockPlates.filter((plate) => html.includes(plate))
  if (leaked.length > 0) {
    console.error(JSON.stringify({ leaked }))
    throw new Error('MOCK_PLATE_IN_DOM')
  }

  // API kapatıldığında eski veya mock kayıt gösterilmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 20_000)
  const afterShutdownRows = await evaluate("document.querySelectorAll('tbody tr').length")
  if (afterShutdownRows > 0) throw new Error('STALE_ROWS_AFTER_SHUTDOWN')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/operational-alerts')
    || url.includes('/dashboard')
    || url.includes('/cases')
    || url.includes('/references/')
    || url.includes('/workspace-plans')
  const browserProblems = cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params?.type)
    if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)) {
      return event.params?.entry?.source !== 'network' || !expectedNetworkError(event.params?.entry?.url)
    }
    return false
  })
  if (browserProblems.length > 0) {
    console.error(JSON.stringify(browserProblems.map((event) => ({
      method: event.method,
      level: event.params?.entry?.level ?? null,
      type: event.params?.type ?? null,
      source: event.params?.entry?.source ?? null,
      url: event.params?.entry?.url ?? null,
    }))))
    throw new Error('BROWSER_CONSOLE_NOT_CLEAN')
  }

  console.log(JSON.stringify({
    ok: true,
    totalCases: TOTAL_CASES,
    renderedPageSize: pageSize,
    scenarios: {
      login: true,
      onlyActivePageRendered: true,
      pageSizeWithinContract: true,
      totalCountFromServer: true,
      alertIdsMatchRenderedRows: true,
      noUnknownAlertRows: true,
      noDuplicateRowsAcrossPages: true,
      pageNavigation: true,
      searchAppliedOnServer: true,
      resetToFirstPageOnFilterChange: true,
      noMockPlateInDom: true,
      noStaleRowsAfterShutdown: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1920x1080-dark', '1366x768-dark'],
  }))
} finally {
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) chrome.kill()
  await closeDatabasePool(pool)
}
