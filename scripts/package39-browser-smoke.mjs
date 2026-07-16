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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
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

async function checkLabel(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.textContent?.includes(${encoded}));
    const input=label?.querySelector('input[type="checkbox"]');
    if(!input) return false;
    input.click();
    return input.checked;
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

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const caseId = uuidv7()
  const openCaseId = uuidv7()
  const documentId = uuidv7()
  const documentVersionId = uuidv7()
  const password = 'p39-browser-sentetik-parola-42'

  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p39-browser','P39 Browser Sentetik')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p39-browser@test.local','P39 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO storage_roots (id,organization_id,root_key,label)
     VALUES ($1,$2,'synthetic-root','Sentetik Root')`,
    [uuidv7(), organizationId],
  )
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,created_at,
      closed_at,updated_at,version)
     VALUES ($1,$2,2026,3901,'2026/3901','traffic','closed','closed','34 P 3901','34P3901',
             $3,'2026-07-10','2026-07-01T09:00:00Z','2026-07-15T10:00:00Z',
             '2026-07-15T10:00:00Z',1)`,
    [caseId, organizationId, userId],
  )
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,loss_date,notification_date,
      created_at,updated_at,version)
     VALUES ($1,$2,2026,4001,'2026/4001','traffic','open','ready_to_close','34 P 4001','34P4001',
             $3,'2026-07-09','2026-07-10','2026-07-01T09:00:00Z',
             '2026-07-15T10:00:00Z',1)`,
    [openCaseId, organizationId, userId],
  )
  await pool.query(
    `INSERT INTO case_locations
     (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
     VALUES ($1,$2,$3,'synthetic-root','2026/Temmuz 2026/34P4001','verified','system')`,
    [uuidv7(), organizationId, openCaseId],
  )
  await pool.query(
    `INSERT INTO documents
     (id,organization_id,case_id,document_type,current_version_number,status)
     VALUES ($1,$2,$3,'expert_report',1,'ready')`,
    [documentId, organizationId, caseId],
  )
  await pool.query(
    `INSERT INTO document_versions
     (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
      extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
      status,hash_verified,size_verified,verified_at,registered_by_user_id)
     VALUES ($1,$2,$3,$4,1,'sentetik-nihai.pdf','Sentetik Nihai Ekspertiz Raporu','pdf',
             'application/pdf',512,$5,'synthetic-root',$6,'manual','ready',true,true,
             '2026-07-15T08:00:00Z',$7)`,
    [
      documentVersionId,
      organizationId,
      documentId,
      caseId,
      'c'.repeat(64),
      `sentetik/${caseId}/nihai.pdf`,
      userId,
    ],
  )
  await pool.query(
    'UPDATE documents SET current_version_id=$2 WHERE id=$1',
    [documentId, documentVersionId],
  )

  const readyTypes = [
    'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
    'victim_registration', 'insured_registration', 'victim_driver_license',
    'insured_driver_license', 'accident_report', 'expert_report', 'preliminary_report',
  ]
  for (const [index, documentType] of readyTypes.entries()) {
    const readyDocumentId = uuidv7()
    const readyVersionId = uuidv7()
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,'ready')`,
      [readyDocumentId, organizationId, openCaseId, documentType],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'synthetic-root',$7,
               'manual','ready',true,true,'2026-07-15T08:00:00Z',$8)`,
      [
        readyVersionId, organizationId, readyDocumentId, openCaseId,
        `${documentType}.pdf`, String(index + 1).padStart(64, 'a').slice(-64),
        `sentetik/${openCaseId}/${documentType}.pdf`, userId,
      ],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [readyDocumentId, readyVersionId])
  }
  await pool.query(
    `INSERT INTO photos
     (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,
      storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
     VALUES ($1,$2,$3,'onarim.jpg','Onarım','image/jpeg',128,$4,'synthetic-root',$5,
             'manual','ready',true,true,'2026-07-15T08:00:00Z')`,
    [uuidv7(), organizationId, openCaseId, 'e'.repeat(64), `sentetik/${openCaseId}/ONARIM/onarim.jpg`],
  )

  async function seedValueLoss(targetCaseId) {
    const assessmentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      `INSERT INTO traffic_value_loss_assessments
       (id,organization_id,case_id,created_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [assessmentId, organizationId, targetCaseId, userId],
    )
    await pool.query(
      `INSERT INTO traffic_value_loss_versions
       (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,
        effective_from,evaluated_on,input_snapshot,result_snapshot,result_code,human_approval_status,
        approved_by_user_id,approved_at,is_active,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'approved','traffic-value-loss-market-difference','2026.07.01.1',
               '2026-07-01','2026-07-15','{}'::jsonb,$5::jsonb,'calculable','approved',$6,now(),true,$6)`,
      [versionId, organizationId, targetCaseId, assessmentId, JSON.stringify({
        faultAdjustedValueLossMinor: 245_000,
        canSubmitForApproval: true,
      }), userId],
    )
    await pool.query('UPDATE traffic_value_loss_assessments SET current_version_id=$2 WHERE id=$1', [assessmentId, versionId])
    await pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,
        pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,1,'traffic-value-loss-final-report/1.0.0',
               'traffic-value-loss-final-report-tr/1.0.0','2026.07.01.1',$6::jsonb,$7,$8,128,$9)`,
      [uuidv7(), organizationId, targetCaseId, assessmentId, versionId, JSON.stringify({
        schemaVersion: 'traffic-value-loss-final-report/1.0.0',
        templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
        assessment: { assessmentId, versionId, assessmentVersion: 1 },
        rule: { ruleVersion: '2026.07.01.1' },
        caseReference: { caseId: targetCaseId, caseType: 'traffic' },
      }), 'f'.repeat(64), '9'.repeat(64), userId],
    )
  }
  await seedValueLoss(caseId)
  await seedValueLoss(openCaseId)

  return {
    organizationId,
    caseId,
    openCaseId,
    documentVersionId,
    email: 'p39-browser@test.local',
    password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-16T12:00:00.000Z'),
    loggerEnabled: false,
    auth: {
      pool,
      cookieSecure: false,
      loginRateLimit: { limit: 100, windowMs: 60_000 },
    },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4179, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9339',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p39-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9339/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9339/json/new?${encodeURIComponent('http://127.0.0.1:4179/')}`,
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

  await evaluate(`location.href=${JSON.stringify(`http://127.0.0.1:4179/dosyalar/${seeded.openCaseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 P 4001')")
  await clickExact('Dosyayı Kapat')
  await clickExact('Önizleme Oluştur')
  await waitFor("document.body.textContent.includes('Değer Kaybı Kapanış Özeti')")
  await waitFor("document.body.textContent.includes('₺2.450,00')")
  await waitFor("document.body.textContent.includes('Doğrulanmış rapor bağlı')")
  await waitFor("document.body.textContent.includes('0 kontrol gerekli')")
  await assertNoHorizontalOverflow('CLOSE_PREVIEW_1366_LIGHT')
  await clickExact('Vazgeç')

  await evaluate(`location.href=${JSON.stringify(`http://127.0.0.1:4179/dosyalar/${seeded.caseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 P 3901')")
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('.case-tabs button')]
      .find((item)=>item.textContent?.trim()==='Raporlar ve Ücretler');
    if(!node) return false;
    node.click();
    return true;
  })()`)
  await waitFor("document.body.textContent.includes('Kapanma Ücreti')")
  await waitFor("[...document.querySelectorAll('label')].some((node)=>node.textContent.includes('Aday Tutar (TL)'))")
  await fillLabel('Aday Tutar (TL)', '4850,00')
  await fillLabel('Kaynak Sayfa', '12')
  await clickExact('Adayı Kaydet')
  await waitFor("document.body.textContent.includes('Kontrol Gerekli')")

  const candidate = await pool.query(
    `SELECT current.status,current.candidate_amount_minor::text AS candidate_amount_minor
     FROM fee_records fee
     JOIN fee_record_versions current ON current.id=fee.current_version_id
     WHERE fee.organization_id=$1 AND fee.case_id=$2`,
    [seeded.organizationId, seeded.caseId],
  )
  if (
    candidate.rows[0]?.status !== 'control_required'
    || candidate.rows[0]?.candidate_amount_minor !== '485000'
  ) {
    throw new Error('CANDIDATE_DB_STATE_INVALID')
  }

  await checkLabel('Aday tutarı ve kaynak sayfayı kontrol ettim.')
  await clickExact('Ücreti Onayla')
  await waitFor("document.body.textContent.includes('Kullanıcı Onaylı')")
  await assertNoHorizontalOverflow('CASE_FEE_1366_LIGHT')

  await evaluate("location.href='http://127.0.0.1:4179/raporlar-ve-ucretler'; true")
  await waitFor("location.pathname==='/raporlar-ve-ucretler' && document.body.textContent.includes('Onaylı Eksper Ücreti')")
  await waitFor("document.body.textContent.includes('₺4.850')")
  await waitFor("document.body.textContent.includes('₺2.450')")
  const reportsText = await evaluate('document.body.textContent')
  if (reportsText.includes('28.750') || reportsText.includes('26 ESK 26')) {
    throw new Error('REPORTS_MOCK_LEAK')
  }

  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('REPORTS_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('REPORTS_1920_DARK')

  await evaluate("location.href='http://127.0.0.1:4179/kapanan-dosyalar'; true")
  await waitFor("location.pathname==='/kapanan-dosyalar' && document.body.textContent.includes('34 P 3901')")
  await waitFor("document.body.textContent.includes('₺4.850')")
  await waitFor("document.body.textContent.includes('₺2.450')")
  const closedText = await evaluate('document.body.textContent')
  if (closedText.includes('Kontrol gerekli') || closedText.includes('26 ESK 26')) {
    throw new Error('CLOSED_FEE_STATE_INVALID')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/workspace-plans')
  const browserProblems = cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Runtime.consoleAPICalled') {
      return ['error', 'warning'].includes(event.params?.type)
    }
    if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)) {
      return event.params?.entry?.source !== 'network'
        || !expectedNetworkError(event.params?.entry?.url)
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

  const persistence = await pool.query(
    `SELECT
       current.status,
       current.approved_amount_minor::text AS approved_amount_minor,
       (SELECT count(*)::int FROM fee_record_versions WHERE fee_record_id=fee.id) AS version_count,
       (SELECT count(*)::int FROM audit_events
        WHERE organization_id=fee.organization_id AND resource_id=fee.id::text) AS audit_count
     FROM fee_records fee
     JOIN fee_record_versions current ON current.id=fee.current_version_id
     WHERE fee.organization_id=$1 AND fee.case_id=$2`,
    [seeded.organizationId, seeded.caseId],
  )
  const persisted = persistence.rows[0]
  if (
    persisted?.status !== 'approved'
    || persisted?.approved_amount_minor !== '485000'
    || persisted?.version_count !== 2
    || persisted?.audit_count !== 2
  ) {
    throw new Error('FEE_PERSISTENCE_INVALID')
  }

  const leakage = JSON.stringify((await pool.query(
    `SELECT action,details FROM audit_events
     WHERE organization_id=$1 AND action LIKE 'closure_fee.%'`,
    [seeded.organizationId],
  )).rows)
  if (/[A-Z]:\\|password|secret|stack|SELECT |INSERT |sentetik\/|nihai\.pdf/i.test(leakage)) {
    throw new Error('FEE_AUDIT_LEAK')
  }

  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 15_000)
  const afterShutdown = await evaluate('document.body.textContent')
  if (afterShutdown.includes('34 P 3901') || afterShutdown.includes('₺4.850')) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      verifiedFinalReportSource: true,
      candidateControlRequired: true,
      explicitApproval: true,
      approvedMonthlyTotal: true,
      approvedClosedCaseFee: true,
      closePreviewValueLossSummary: true,
      approvedMonthlyValueLossTotal: true,
      approvedClosedCaseValueLoss: true,
      auditSafe: true,
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
