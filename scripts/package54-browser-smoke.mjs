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
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../services/api/dist/index.js'

/**
 * Paket 54 dilim 2 tarayıcı smoke'u: AI işçilik dağıtımı uçtan uca.
 *
 * Doğrulananlar: gerçek analiz, satır kapsaması, control_required görünürlüğü,
 * satır bazlı seçim, "kontrol gerekli hariç tümünü seç", önizlemenin föyü
 * DEĞİŞTİRMEMESİ ve sağlayıcı hatasında gizli fallback olmaması.
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

const SECRET = 'GIZLI-PARCA-ACIKLAMASI-54'
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
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
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

async function fillLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.querySelector(':scope > span')?.textContent?.trim()===${encodedLabel});
    const input=label?.querySelector('input,textarea,select');
    if(!input) return false;
    const prototype=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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

async function clickContains(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
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
    viewport:window.innerWidth, body:document.body.scrollWidth, root:document.documentElement.scrollWidth
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
  const password = 'p54-browser-sentetik-parola-54'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p54-browser','P54 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p54-browser@test.local','P54 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,5410,'2026/5410','traffic','open','reporting','34 AL 5410','34AL5410',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId],
  )
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor)
     VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
    [uuidv7(), organizationId],
  )
  return { organizationId, userId, caseId, email: 'p54-browser@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-18T14:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
    laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
    laborAllocationProviderId: 'deterministic-success',
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4194, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9354',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p54-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9354/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9354/json/new?${encodeURIComponent('http://127.0.0.1:4194/')}`,
    { method: 'PUT' },
  ).then((response) => response.json())
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.open()
  await Promise.all([
    cdp.send('Page.enable'), cdp.send('Runtime.enable'),
    cdp.send('Log.enable'), cdp.send('Network.enable'),
  ])
  await setViewport(1920, 1080)

  await waitFor("document.body.textContent.includes('Giriş Yap')")
  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickExact('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")

  // Föyü gerçek uçtan oluştur (AI dağıtımının kaynağı).
  const sheet = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedCaseVersion: 1, confirmed: true, items: [
        { description: 'Ön tampon', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 1000000 },
        { description: ${JSON.stringify(SECRET)}, action: 'Değişim', partAmountMinor: 1800000, laborAmountMinor: 200000 }
      ] })
    });
    return response.status;
  })()`)
  if (sheet !== 201) throw new Error('LABOR_SHEET_SEED_FAILED')

  await evaluate(`location.href='http://127.0.0.1:4194/dosyalar/${seeded.caseId}'; true`)
  await waitFor("document.body.textContent.includes('İşçilik')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  await waitFor("document.body.textContent.includes('labor-operation-types/1.0.0')")

  // Gerçek analiz.
  await fillLabel('Hasar tarifi', 'Ön sol bölgede darbe, tampon ve çamurluk etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===2")

  // Her satır kapsanır ve kanıt eksikliği nedeniyle kontrol gerekli olur.
  const lineState = await evaluate(`(() => {
    const lines=[...document.querySelectorAll('.allocation-line')];
    return {
      count: lines.length,
      control: lines.filter((line)=>line.classList.contains('allocation-line--control')).length,
      hasMissingCode: document.body.textContent.includes('EVIDENCE_MISSING_VEHICLE_IDENTITY'),
      hasOperationLabel: document.body.textContent.includes('Sökme-takma')
        || document.body.textContent.includes('Onarım'),
    };
  })()`)
  if (lineState.count !== 2) throw new Error('LINE_COVERAGE_INCOMPLETE')
  if (lineState.control !== 2) throw new Error('CONTROL_REQUIRED_NOT_SHOWN')
  if (!lineState.hasMissingCode) throw new Error('MISSING_EVIDENCE_CODE_NOT_SHOWN')
  if (!lineState.hasOperationLabel) throw new Error('OPERATION_TYPE_NOT_SHOWN')

  // Tüm satırlar kontrol gerekli olduğundan "hariç tümünü seç" devre dışıdır:
  // buton hiçbir zaman kontrol gerekli satırı sessizce seçmez.
  const bulkDisabled = await evaluate(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
      item.textContent?.includes('hariç tümünü seç'));
    return node ? node.disabled : null;
  })()`)
  if (bulkDisabled !== true) throw new Error('BULK_SELECT_SHOULD_BE_DISABLED')
  await waitFor("document.body.textContent.includes('0 satır seçili')")

  // Satır bazlı kabul: kullanıcı bilinçli olarak kontrol gerekli satırı seçebilir.
  await waitFor(`(() => {
    const box=document.querySelector('.allocation-line input[type="checkbox"]');
    if(!box) return false; box.click(); return true;
  })()`)
  await waitFor("document.body.textContent.includes('1 satır seçili')")

  const sheetBefore = await pool.query(
    `SELECT v.sheet_version FROM labor_sheet_versions v
       JOIN labor_sheets s ON s.current_version_id=v.id WHERE s.case_id=$1`,
    [seeded.caseId],
  )
  await clickContains('önizleme hazırla')
  await waitFor("document.body.textContent.includes('Önizleme hazır')")
  await waitFor("document.body.textContent.includes('Föy bu adımda değiştirilmedi')")

  // Föy DEĞİŞMEZ: bu dilimde otomatik revize yoktur.
  const sheetAfter = await pool.query(
    `SELECT v.sheet_version FROM labor_sheet_versions v
       JOIN labor_sheets s ON s.current_version_id=v.id WHERE s.case_id=$1`,
    [seeded.caseId],
  )
  if (sheetAfter.rows[0].sheet_version !== sheetBefore.rows[0].sheet_version) {
    throw new Error('SHEET_MUTATED_BY_PREVIEW')
  }

  // Öneri föy sürümünden ayrı aggregate'te ve immutable satırlarla saklanır.
  const stored = await pool.query(
    `SELECT r.status,r.line_count,r.operation_types_version,
            (SELECT count(*)::int FROM labor_allocation_line_suggestions l WHERE l.run_id=r.id) AS lines
       FROM labor_allocation_runs r WHERE r.organization_id=$1 AND r.case_id=$2`,
    [seeded.organizationId, seeded.caseId],
  )
  if (stored.rows.length !== 1) throw new Error('RUN_NOT_PERSISTED')
  if (stored.rows[0].status !== 'review_required') throw new Error('RUN_NOT_REVIEWABLE')
  if (stored.rows[0].lines !== 2 || stored.rows[0].line_count !== 2) throw new Error('LINE_ROWS_MISMATCH')
  if (stored.rows[0].operation_types_version !== 'labor-operation-types/1.0.0') {
    throw new Error('TAXONOMY_VERSION_NOT_STORED')
  }

  // Usage ledger kaydı yazılır.
  const ledger = await pool.query(
    "SELECT count(*)::int AS n FROM ai_usage_ledger WHERE usage_module='labor_allocation' AND organization_id=$1",
    [seeded.organizationId],
  )
  if (ledger.rows[0].n !== 1) throw new Error('USAGE_LEDGER_NOT_WRITTEN')

  // Serbest metin ve parça açıklaması audit'e sızmaz.
  const auditLeak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [SECRET],
  )
  if (auditLeak.rows[0].n !== 0) throw new Error('SECRET_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('LABOR_ALLOCATION_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('LABOR_ALLOCATION_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('LABOR_ALLOCATION_1366_DARK')

  // API kapatıldığında sahte sonuç gösterilmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 25_000)
  const allocationLines = await evaluate("document.querySelectorAll('.allocation-line').length")
  if (allocationLines > 0) throw new Error('STALE_ALLOCATION_AFTER_SHUTDOWN')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico') || url.endsWith('/api/v1/auth/session')
    || url.includes('/labor-allocation-ai') || url.includes('/labor')
    || url.includes('/cases') || url.includes('/references/')
    || url.includes('/dashboard') || url.includes('/operational-alerts')
    || url.includes('/workspace-plans') || url.includes('/documents')
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
      url: event.params?.entry?.url ?? null,
    }))))
    throw new Error('BROWSER_CONSOLE_NOT_CLEAN')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      realAnalysisFromSheet: true,
      allLinesCovered: true,
      controlRequiredVisible: true,
      missingEvidenceCodeVisible: true,
      operationTypesVisible: true,
      excludeControlRequiredSelection: true,
      perLineSelection: true,
      previewDoesNotMutateSheet: true,
      suggestionStoredAsSeparateAggregate: true,
      taxonomyVersionStored: true,
      usageLedgerWritten: true,
      noSecretInAudit: true,
      noStaleResultAfterShutdown: true,
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
