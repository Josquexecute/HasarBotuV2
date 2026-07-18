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
 * Paket 50 tarayıcı smoke'u: Durum Panosu uyarı özetinin aynı
 * `GET /api/v1/operational-alerts` ucundan geldiğini, sayacın API `totalCount`
 * ile eşleştiğini, tek istek yapıldığını, panoda ayrıntılı listenin render
 * edilmediğini, rozet/kart tıklamasının Bildirimler'e gittiğini ve hata halinde
 * sıfır gösterilmediğini doğrular.
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

async function retry(fn, timeoutMs = 15_000) {
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

/** Önizleme satırı plaka + özet + tarih içerdiği için içeriğe göre eşleşir. */
async function clickPreviewContaining(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('.alert-summary__preview button')].find((item)=>
      item.textContent?.includes(${encoded}));
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

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const password = 'p50-browser-sentetik-parola-50'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p50-browser','P50 Browser Sentetik')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p50-browser@test.local','P50 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])

  // Geciken görev + geçmiş takip; evrak tam.
  const overdueCaseId = uuidv7()
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
     VALUES ($1,$2,2026,5001,'2026/5001','traffic','open','reporting','34 P 5001','34P5001',$3,'2026-07-10','2026-07-01',1)`,
    [overdueCaseId, organizationId, userId],
  )
  for (const type of READY_TRAFFIC_DOCUMENTS) await seedDocument(organizationId, overdueCaseId, userId, type)
  await pool.query(
    `INSERT INTO case_tasks
     (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id)
     VALUES ($1,$2,$3,'Servisten onay al','high','open',$4,'2026-07-12',$4)`,
    [uuidv7(), organizationId, overdueCaseId, userId],
  )

  // Eksik zorunlu evrak.
  const missingCaseId = uuidv7()
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,5002,'2026/5002','traffic','open','reporting','34 P 5002','34P5002',$3,'2026-07-01',1)`,
    [missingCaseId, organizationId, userId],
  )
  for (const type of READY_TRAFFIC_DOCUMENTS) {
    if (type !== 'victim_traffic_policy') await seedDocument(organizationId, missingCaseId, userId, type)
  }

  return { organizationId, userId, overdueCaseId, missingCaseId, email: 'p50-browser@test.local', password }
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
    server: { host: '127.0.0.1', port: 4190, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9350',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p50-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9350/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9350/json/new?${encodeURIComponent('http://127.0.0.1:4190/')}`,
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
  await setViewport(1366, 768)

  await waitFor("document.body.textContent.includes('Giriş Yap')")
  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")

  // Pano uyarı özeti gerçek uçtan gelir.
  await waitFor("document.querySelector('[aria-label=\"Operasyonel uyarı özeti\"]')!==null")
  await waitFor("document.body.textContent.includes('açık operasyonel uyarı')")
  await assertNoMockLiterals('DASHBOARD_ALERTS', literals)

  // Sayaç API totalCount ile eşleşmeli; tür sayıları toplamı da tutmalı.
  const api = await evaluate(`(async () => {
    const response = await fetch('/api/v1/operational-alerts', {
      credentials: 'include',
      headers: { 'x-smoke-probe': '1' },
    });
    const body = await response.json();
    const byType = { overdue_task: 0, overdue_follow_up: 0, missing_required_document: 0 };
    for (const alert of body.alerts) byType[alert.type] += 1;
    return { total: body.totalCount, length: body.alerts.length, byType };
  })()`)
  if (api.total !== api.length) throw new Error('API_COUNTER_MISMATCH')

  const dom = await evaluate(`(() => {
    const section=document.querySelector('[aria-label="Operasyonel uyarı özeti"]');
    const totalLabel=section?.querySelector('.alert-summary__total')?.getAttribute('aria-label') ?? '';
    const totalMatch=totalLabel.match(/(\\d+) açık operasyonel uyarı/);
    const types={};
    for (const node of section?.querySelectorAll('.alert-summary__type') ?? []) {
      const label=node.getAttribute('aria-label') ?? '';
      const match=label.match(/^(.+?): (\\d+)\\./);
      if (match) types[match[1]] = Number(match[2]);
    }
    return {
      total: totalMatch ? Number(totalMatch[1]) : null,
      types,
      previewItems: section?.querySelectorAll('.alert-summary__preview li').length ?? 0,
    };
  })()`)
  if (dom.total !== api.total) throw new Error('DASHBOARD_COUNTER_NOT_FROM_API')
  if (dom.types['Geciken görev'] !== api.byType.overdue_task) throw new Error('TYPE_SUMMARY_MISMATCH_TASK')
  if (dom.types['Geciken takip'] !== api.byType.overdue_follow_up) throw new Error('TYPE_SUMMARY_MISMATCH_FOLLOW_UP')
  if (dom.types['Eksik zorunlu evrak'] !== api.byType.missing_required_document) {
    throw new Error('TYPE_SUMMARY_MISMATCH_DOCUMENT')
  }
  // Pano ayrıntılı liste render etmez.
  if (dom.previewItems > 3) throw new Error('DASHBOARD_RENDERED_FULL_ALERT_LIST')

  // Aynı veri için mükerrer/paralel istek oluşmamalı. Ölçüm, bu betiğin kendi
  // doğrulama fetch'ini hariç tutar (`x-smoke-probe`). React StrictMode dev
  // modunda her effect'i iki kez çalıştırdığı için mutlak sayı yerine mevcut
  // Durum Panosu ucuyla karşılaştırılır: uyarı özeti pano verisinden fazla
  // istek üretmemelidir.
  const countRequests = (path) => cdp.events.filter((event) =>
    event.method === 'Network.requestWillBeSent'
    && String(event.params?.request?.url ?? '').includes(path)
    && event.params?.request?.headers?.['x-smoke-probe'] === undefined).length
  const alertRequests = countRequests('/api/v1/operational-alerts')
  const dashboardRequests = countRequests('/api/v1/dashboard')
  if (alertRequests === 0) throw new Error('OPERATIONAL_ALERT_ENDPOINT_NOT_CALLED')
  if (alertRequests > dashboardRequests) {
    console.error(JSON.stringify({ alertRequests, dashboardRequests }))
    throw new Error('DUPLICATE_OPERATIONAL_ALERT_REQUESTS')
  }
  await assertNoHorizontalOverflow('DASHBOARD_1366_LIGHT')

  // Tür kartı tıklanınca Bildirimler ekranına gider.
  await clickAriaPrefix('Eksik zorunlu evrak:')
  await waitFor("location.pathname==='/bildirimler'")
  await waitFor("document.body.textContent.includes('Eksik zorunlu evrak: Mağdur trafik poliçesi')")

  // Toplam rozeti de Bildirimler'e gider.
  await evaluate("location.href='http://127.0.0.1:4190/'; true")
  await waitFor("document.body.textContent.includes('açık operasyonel uyarı')")
  await clickAriaPrefix(`${api.total} açık operasyonel uyarı`)
  await waitFor("location.pathname==='/bildirimler'")

  // Öne çıkan uyarı dosya detayına gider.
  await evaluate("location.href='http://127.0.0.1:4190/'; true")
  await waitFor("document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")
  await clickPreviewContaining('Süresi geçmiş görev: Servisten onay al')
  await waitFor(`location.pathname==='/dosyalar/${seeded.overdueCaseId}'`)

  await evaluate("location.href='http://127.0.0.1:4190/'; true")
  await waitFor("document.body.textContent.includes('açık operasyonel uyarı')")
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('DASHBOARD_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('DASHBOARD_1920_DARK')
  await setViewport(1366, 768)

  // Uyarı kalmayınca nötr boş durum gösterilir (hata durumu değil).
  // `case_task_transition_guard`: görev silinemez ve kimliği değişmez; yalnız
  // open → completed geçişi (çözüm alanları + version artışı) geçerlidir.
  await pool.query(
    `UPDATE case_tasks
        SET status='completed',resolution_note='Sentetik smoke kapanışı',
            resolved_by_user_id=$2,resolved_at='2026-07-18T13:00:00Z',version=version+1
      WHERE organization_id=$1 AND status='open'`,
    [seeded.organizationId, seeded.userId],
  )
  await pool.query('UPDATE cases SET follow_up_date=NULL WHERE organization_id=$1', [seeded.organizationId])
  await seedDocument(seeded.organizationId, seeded.missingCaseId, seeded.userId, 'victim_traffic_policy')
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Açık operasyonel uyarı yok.')")
  const emptyHtml = await documentText()
  if (/Operasyonel uyarılar alınamadı/.test(emptyHtml)) throw new Error('EMPTY_STATE_SHOWN_AS_ERROR')
  await assertNoHorizontalOverflow('DASHBOARD_EMPTY_1366_LIGHT')

  // API kapatıldığında sıfır gösterilmez; açık hata durumu ve mock fallback yok.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 15_000)
  await assertNoMockLiterals('AFTER_SHUTDOWN', literals)
  const afterShutdownHtml = await documentText()
  if (/Açık operasyonel uyarı yok\.|0 açık operasyonel uyarı/.test(afterShutdownHtml)) {
    throw new Error('ZERO_SHOWN_WHILE_API_DOWN')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/operational-alerts')
    || url.includes('/dashboard')
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
    alertCount: api.total,
    typeSummary: api.byType,
    requestCounts: { alerts: alertRequests, dashboard: dashboardRequests },
    scenarios: {
      login: true,
      dashboardSummaryFromSharedEndpoint: true,
      counterFromApiTotalCount: true,
      perTypeSummaryMatchesApi: true,
      noFullListOnDashboard: true,
      noExtraAlertRequestsVersusDashboard: true,
      typeCardOpensNotifications: true,
      totalBadgeOpensNotifications: true,
      previewOpensCaseDetail: true,
      neutralEmptyState: true,
      noZeroWhileApiDown: true,
      noMockFallback: true,
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
