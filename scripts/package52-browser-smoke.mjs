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
 * Paket 52 tarayıcı smoke'u: Dosyalar ekranındaki satır uyarı göstergesi.
 *
 * En kritik senaryo yanlış negatiftir: genel uyarı listesi 200 ile kırpıldığı
 * için düşük önemli uyarısı olan dosyalar o listede HİÇ görünmez. Satır
 * göstergesi filtreli çağrıdan beslendiği için yine de doğru sayıyı gösterir.
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

const mockSource = readFileSync(join(repoRoot, 'src', 'mocks', 'workspaces.ts'), 'utf8')
function forbiddenLiterals() {
  const values = new Set()
  for (const match of mockSource.matchAll(/\b(?:title|detail|summary|reference)\s*:\s*'([^'\\]{12,})'/g)) {
    values.add(match[1])
  }
  if (values.size < 4) throw new Error('MOCK_LITERAL_EXTRACTION_FAILED')
  return [...values]
}

const READY_TRAFFIC_DOCUMENTS = [
  'victim_traffic_policy',
  'insured_traffic_policy',
  'sbm_heavy_damage_result',
  'victim_registration',
  'insured_registration',
  'victim_driver_license',
  'insured_driver_license',
  'accident_report',
]

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

async function clickAriaPrefix(prefix) {
  const encoded = JSON.stringify(prefix)
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('button,a')].find((item)=>
      item.getAttribute('aria-label')?.startsWith(${encoded}));
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

async function documentText() {
  return evaluate('document.documentElement.innerHTML')
}

async function assertNoMockLiterals(label, literals) {
  const html = await documentText()
  const leaked = literals.filter((literal) => html.includes(literal))
  if (leaked.length > 0) {
    console.error(JSON.stringify({ label, leaked }))
    throw new Error(`MOCK_LITERAL_IN_DOM_${label}`)
  }
}

async function seedDocument(organizationId, caseId, userId, type) {
  const documentId = uuidv7()
  const versionId = uuidv7()
  await pool.query(
    `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
     VALUES ($1,$2,$3,$4,1,'ready')`,
    [documentId, organizationId, caseId, type],
  )
  await pool.query(
    `INSERT INTO document_versions
     (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
      extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
      status,hash_verified,size_verified,verified_at,registered_by_user_id)
     VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'synthetic-root',$7,'manual',
             'ready',true,true,'2026-07-10T08:00:00Z',$8)`,
    [versionId, organizationId, documentId, caseId, `${type}.pdf`, 'a'.repeat(64), `synthetic/${caseId}/${type}.pdf`, userId],
  )
  await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
}

async function seedCase(input) {
  const caseId = uuidv7()
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
     VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,$8,'2026-07-01',1)`,
    [
      caseId, input.organizationId, input.sequence, `2026/${input.sequence}`,
      input.plate, input.plate.replace(/[^A-Z0-9]/g, ''), input.userId, input.followUpDate ?? null,
    ],
  )
  const missing = input.missingDocuments ?? []
  for (const type of READY_TRAFFIC_DOCUMENTS) {
    if (!missing.includes(type)) await seedDocument(input.organizationId, caseId, input.userId, type)
  }
  if (input.taskTitle !== undefined) {
    await pool.query(
      `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'open',$6,'2026-07-12',$6)`,
      [uuidv7(), input.organizationId, caseId, input.taskTitle, input.taskPriority ?? 'high', input.userId],
    )
  }
  return caseId
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const password = 'p52-browser-sentetik-parola-52'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p52-browser','P52 Browser Sentetik')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p52-browser@test.local','P52 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])

  // 55 gürültülü dosya: yüksek önemli uyarılarla 200 genel sınırını doldurur.
  for (let index = 0; index < 55; index += 1) {
    await seedCase({
      organizationId, userId, sequence: 5200 + index, plate: `34 PN ${5200 + index}`,
      followUpDate: '2026-07-10',
      missingDocuments: ['victim_traffic_policy', 'accident_report'],
      taskTitle: `Geciken görev ${index}`,
    })
  }
  // Sessiz dosya: yalnız DÜŞÜK önemli geciken görev. Kırpılmış genel listede yok.
  const quietCaseId = await seedCase({
    organizationId, userId, sequence: 5300, plate: '34 QUIET 5300',
    taskTitle: 'Düşük öncelikli görev', taskPriority: 'low',
  })
  // Temiz dosya: hiç uyarı üretmez.
  const cleanCaseId = await seedCase({
    organizationId, userId, sequence: 5301, plate: '34 CLEAN 5301', followUpDate: '2026-08-01',
  })

  return { organizationId, userId, quietCaseId, cleanCaseId, email: 'p52-browser@test.local', password }
}

try {
  const literals = forbiddenLiterals()
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
    server: { host: '127.0.0.1', port: 4192, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9352',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p52-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9352/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9352/json/new?${encodeURIComponent('http://127.0.0.1:4192/')}`,
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

  await evaluate("location.href='http://127.0.0.1:4192/dosyalar'; true")
  await waitFor("document.querySelectorAll('.row-alert').length>0")
  await waitFor("document.querySelectorAll('.row-alert--active').length>0")
  await assertNoMockLiterals('CASES', literals)

  // Genel (filtresiz) liste 200 ile kırpılır ve sessiz dosyayı İÇERMEZ.
  const unfiltered = await evaluate(`(async () => {
    const response = await fetch('/api/v1/operational-alerts', {
      credentials: 'include', headers: { 'x-smoke-probe': '1' },
    });
    const body = await response.json();
    return {
      total: body.totalCount,
      hasQuiet: body.alerts.some((alert) => alert.caseId === ${JSON.stringify(seeded.quietCaseId)}),
      hasSummaries: body.caseSummaries !== undefined,
    };
  })()`)
  if (unfiltered.total !== 200) throw new Error('UNFILTERED_NOT_AT_CAP')
  if (unfiltered.hasQuiet) throw new Error('QUIET_CASE_UNEXPECTEDLY_IN_CAPPED_LIST')
  if (unfiltered.hasSummaries) throw new Error('UNFILTERED_RETURNED_CASE_SUMMARIES')

  // Satır göstergesi yanlış negatif üretmez: sessiz dosya satırı 1 uyarı gösterir.
  const quietBadge = await waitFor(`(() => {
    const row=[...document.querySelectorAll('tbody tr')].find((item)=>
      item.textContent?.includes('34 QUIET 5300'));
    const badge=row?.querySelector('.row-alert--active');
    return badge ? badge.getAttribute('aria-label') : false;
  })()`)
  if (!/34 QUIET 5300: 1 operasyonel uyarı/.test(quietBadge)) throw new Error('QUIET_ROW_FALSE_NEGATIVE')
  if (!/1 geciken görev/.test(quietBadge)) throw new Error('QUIET_ROW_TYPE_BREAKDOWN_MISSING')

  // Uyarısı olmayan satırda dikkat çekici rozet yoktur.
  const cleanRow = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tbody tr')].find((item)=>
      item.textContent?.includes('34 CLEAN 5301'));
    return {
      hasActive: row?.querySelector('.row-alert--active')!==null && row?.querySelector('.row-alert--active')!==undefined,
      hasClear: row?.querySelector('.row-alert--clear')!==null && row?.querySelector('.row-alert--clear')!==undefined,
    };
  })()`)
  if (cleanRow.hasActive) throw new Error('CLEAN_ROW_SHOWS_PROMINENT_BADGE')
  if (!cleanRow.hasClear) throw new Error('CLEAN_ROW_MISSING_QUIET_MARK')

  // Satır sayıları filtreli API sonucuyla birebir uyuşur.
  const consistency = await evaluate(`(async () => {
    const rows=[...document.querySelectorAll('tbody tr')];
    const badges={};
    for (const row of rows) {
      const label=row.querySelector('.row-alert--active')?.getAttribute('aria-label');
      const match=label && label.match(/^(.+?): (\\d+) operasyonel uyarı/);
      if (match) badges[match[1]] = Number(match[2]);
    }
    return badges;
  })()`)
  const filteredCheck = await evaluate(`(async () => {
    const ids=[${JSON.stringify(seeded.quietCaseId)}];
    const response = await fetch('/api/v1/operational-alerts?caseIds='+ids.join(','), {
      credentials: 'include', headers: { 'x-smoke-probe': '1' },
    });
    const body = await response.json();
    return body.caseSummaries;
  })()`)
  if (!Array.isArray(filteredCheck) || filteredCheck.length !== 1) throw new Error('FILTERED_SUMMARY_MISSING')
  if (filteredCheck[0].totalCount !== consistency['34 QUIET 5300']) throw new Error('ROW_BADGE_API_MISMATCH')

  // İstemci yalnız görünür satırları sorar ve sözleşme sınırını aşmaz.
  const alertRequests = cdp.events
    .filter((event) => event.method === 'Network.requestWillBeSent'
      && String(event.params?.request?.url ?? '').includes('/api/v1/operational-alerts')
      && event.params?.request?.headers?.['x-smoke-probe'] === undefined)
    .map((event) => String(event.params.request.url))
  const caseRowRequests = alertRequests.filter((url) => url.includes('caseIds='))
  if (caseRowRequests.length === 0) throw new Error('CASE_ROW_REQUEST_NOT_SENT')
  for (const url of caseRowRequests) {
    const ids = decodeURIComponent(url.split('caseIds=')[1] ?? '').split(',').filter(Boolean)
    if (ids.length > 100) throw new Error('CASE_FILTER_LIMIT_EXCEEDED')
  }
  await assertNoHorizontalOverflow('CASES_1920_LIGHT')

  // Filtre değişince yalnız görünen satırlar için yeniden yüklenir.
  const beforeFilter = caseRowRequests.length
  await fillSearch('34 QUIET 5300')
  await waitFor("document.querySelectorAll('tbody tr').length===1")
  await retry(async () => {
    const requests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
      && String(event.params?.request?.url ?? '').includes('caseIds=')
      && event.params?.request?.headers?.['x-smoke-probe'] === undefined)
    if (requests.length <= beforeFilter) throw new Error('filter_reload_pending')
    const last = decodeURIComponent(String(requests[requests.length - 1].params.request.url).split('caseIds=')[1])
    if (last !== seeded.quietCaseId) throw new Error('filter_reload_scope_wrong')
    return true
  })

  // Rozet tıklanınca dosya detayına gider.
  await clickAriaPrefix('34 QUIET 5300: 1 operasyonel uyarı')
  await waitFor(`location.pathname==='/dosyalar/${seeded.quietCaseId}'`)

  await evaluate("location.href='http://127.0.0.1:4192/dosyalar'; true")
  await waitFor("document.querySelectorAll('.row-alert--active').length>0")
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('CASES_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('CASES_1366_DARK')

  // API kapatıldığında satırlar "uyarısız" gösterilmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 20_000)
  await assertNoMockLiterals('AFTER_SHUTDOWN', literals)
  // Sınıf adı Vite dev stil etiketinde de geçtiği için HTML metni değil,
  // gerçek eleman sayısı kontrol edilir.
  const alertFreeMarks = await evaluate("document.querySelectorAll('.row-alert--clear').length")
  if (alertFreeMarks > 0) throw new Error('ROWS_SHOWN_AS_ALERT_FREE_WHILE_API_DOWN')

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
    checkedMockLiterals: literals.length,
    unfilteredTotalCount: unfiltered.total,
    caseRowRequests: caseRowRequests.length,
    scenarios: {
      login: true,
      rowBadgesFromFilteredEndpoint: true,
      cappedListWouldFalseNegative: true,
      quietRowNoFalseNegative: true,
      typeBreakdownOnRow: true,
      cleanRowHasNoProminentBadge: true,
      rowBadgeMatchesApiSummary: true,
      onlyVisibleRowsRequested: true,
      caseFilterLimitRespected: true,
      reloadOnFilterChange: true,
      badgeOpensCaseDetail: true,
      noAlertFreeRowsWhileApiDown: true,
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
