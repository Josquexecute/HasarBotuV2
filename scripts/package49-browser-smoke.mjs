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
 * Paket 49 tarayıcı smoke'u: Bildirimler ekranındaki uyarıların gerçek API
 * sonucundan geldiğini, sayacın gerçek sonuçla eşleştiğini, mock içeriğin
 * DOM'a hiç girmediğini ve API kapandığında mock'a düşülmediğini doğrular.
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

async function selectAria(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const select=document.querySelector('select[aria-label='+JSON.stringify(${encodedLabel})+']');
    if(!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${encodedValue});
    select.dispatchEvent(new Event('change',{bubbles:true}));
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
  const password = 'p49-browser-sentetik-parola-49'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p49-browser','P49 Browser Sentetik')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p49-browser@test.local','P49 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])

  // Geciken görev + geçmiş takip; evrak tam.
  const overdueCaseId = uuidv7()
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
     VALUES ($1,$2,2026,4951,'2026/4951','traffic','open','reporting','34 P 4951','34P4951',$3,'2026-07-10','2026-07-01',1)`,
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
     VALUES ($1,$2,2026,4952,'2026/4952','traffic','open','reporting','34 P 4952','34P4952',$3,'2026-07-01',1)`,
    [missingCaseId, organizationId, userId],
  )
  for (const type of READY_TRAFFIC_DOCUMENTS) {
    if (type !== 'victim_traffic_policy') await seedDocument(organizationId, missingCaseId, userId, type)
  }

  return { organizationId, userId, overdueCaseId, missingCaseId, email: 'p49-browser@test.local', password }
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
    server: { host: '127.0.0.1', port: 4189, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9349',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p49-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9349/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9349/json/new?${encodeURIComponent('http://127.0.0.1:4189/')}`,
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

  // Bildirimler: gerçek türetilmiş uyarılar.
  await evaluate("location.href='http://127.0.0.1:4189/bildirimler'; true")
  await waitFor("document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")
  await waitFor("document.body.textContent.includes('Eksik zorunlu evrak: Mağdur trafik poliçesi')")
  await waitFor("document.body.textContent.includes('Takip tarihi geçti')")
  await waitFor("document.body.textContent.includes('34 P 4951')")
  await waitFor("document.body.textContent.includes('2026/4952')")
  await assertNoMockLiterals('NOTIFICATIONS', literals)

  // Sayaç DOM'daki gerçek uyarı sayısıyla ve API sonucuyla eşleşmelidir.
  const apiCount = await evaluate(`(async () => {
    const response = await fetch('/api/v1/operational-alerts', { credentials: 'include' });
    const body = await response.json();
    return { total: body.totalCount, length: body.alerts.length };
  })()`)
  const domCount = await evaluate(`(() => {
    const heading=[...document.querySelectorAll('.heading-count')][0]?.textContent ?? '';
    const match=heading.match(/(\\d+) açık uyarı/);
    return { heading: match ? Number(match[1]) : null, items: document.querySelectorAll('[role="listitem"]').length };
  })()`)
  if (apiCount.total !== apiCount.length) throw new Error('API_COUNTER_MISMATCH')
  if (domCount.heading !== apiCount.total) throw new Error('DOM_COUNTER_NOT_FROM_API')
  if (domCount.items !== apiCount.total) throw new Error('DOM_ITEM_COUNT_MISMATCH')

  // Mükerrerlik: her uyarı anahtarı tektir.
  const duplicates = await evaluate(`(async () => {
    const response = await fetch('/api/v1/operational-alerts', { credentials: 'include' });
    const body = await response.json();
    const keys = body.alerts.map((alert) => alert.dedupeKey);
    return keys.length - new Set(keys).size;
  })()`)
  if (duplicates !== 0) throw new Error('DUPLICATE_ALERTS_IN_RESPONSE')

  // Salt okunur: okundu/ertelendi kontrolü sunulmaz.
  const notificationsHtml = await documentText()
  if (/Tümünü Okundu İşaretle|Okunmamış|Bildirim okuma durumu/.test(notificationsHtml)) {
    throw new Error('NOTIFICATIONS_READ_STATE_CONTROL_IN_DOM')
  }
  await assertNoHorizontalOverflow('NOTIFICATIONS_1366_LIGHT')

  // Tür filtresi gerçek uyarılar üzerinde çalışır.
  await selectAria('Uyarı türü', 'missing_required_document')
  await waitFor("!document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")
  await waitFor("document.body.textContent.includes('Eksik zorunlu evrak: Mağdur trafik poliçesi')")
  await selectAria('Uyarı türü', 'Tümü')
  await waitFor("document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")

  // Dosya detay bağlantısı gerçek dosyaya gider.
  await clickExact('34 P 4951 dosyasına git')
  await waitFor(`location.pathname==='/dosyalar/${seeded.overdueCaseId}'`)

  // Mevzuat karantinada kalır.
  await evaluate("location.href='http://127.0.0.1:4189/mevzuat-ve-ai'; true")
  await waitFor("document.body.textContent.includes('Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.')")
  await assertNoMockLiterals('LEGISLATION', literals)
  await assertNoHorizontalOverflow('LEGISLATION_1366_LIGHT')

  await evaluate("location.href='http://127.0.0.1:4189/bildirimler'; true")
  await waitFor("document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('NOTIFICATIONS_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('NOTIFICATIONS_1920_DARK')

  // Serbest not ve belge içeriği uyarı gövdesine sızmaz.
  await pool.query(
    `INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id)
     VALUES ($1,$2,$3,'internal','GIZLI-SERBEST-NOT-49',$4)`,
    [uuidv7(), seeded.organizationId, seeded.overdueCaseId, seeded.userId],
  )
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Süresi geçmiş görev: Servisten onay al')")
  if ((await documentText()).includes('GIZLI-SERBEST-NOT-49')) throw new Error('FREE_TEXT_NOTE_LEAKED_TO_DOM')
  const auditLeak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%GIZLI-SERBEST-NOT-49%'",
  )
  if (auditLeak.rows[0].n !== 0) throw new Error('FREE_TEXT_NOTE_LEAKED_TO_AUDIT')

  // Salt okunur uç audit yazmaz (auth.* dışı kayıt artmaz).
  const auditBefore = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
  await evaluate("fetch('/api/v1/operational-alerts', { credentials: 'include' }).then(() => true)")
  const auditAfter = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
  if (auditAfter.rows[0].n !== auditBefore.rows[0].n) throw new Error('READ_ONLY_ENDPOINT_WROTE_AUDIT')

  // API kapatıldığında mock'a düşülmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 15_000)
  await assertNoMockLiterals('AFTER_SHUTDOWN', literals)
  const afterShutdownHtml = await documentText()
  if (/Süresi geçmiş görev|Eksik zorunlu evrak|açık uyarı/.test(afterShutdownHtml)) {
    throw new Error('STALE_ALERTS_AFTER_SHUTDOWN')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/operational-alerts')
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
    alertCount: apiCount.total,
    scenarios: {
      login: true,
      realOverdueTaskAlert: true,
      realOverdueFollowUpAlert: true,
      realMissingDocumentAlert: true,
      counterFromApiOnly: true,
      noDuplicateAlerts: true,
      noReadStateControls: true,
      typeFilterOnRealData: true,
      caseDetailNavigation: true,
      legislationStillQuarantined: true,
      noFreeTextLeakToDomOrAudit: true,
      readOnlyEndpointWritesNoAudit: true,
      noFallbackAfterShutdown: true,
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
