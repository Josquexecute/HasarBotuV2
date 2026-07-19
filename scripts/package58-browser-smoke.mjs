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
 * Paket 58 tarayıcı smoke'u: onaylı AI dağıtımının föye uygulanması.
 *
 * Kanıtlanan sıra:
 *   onaylı geçmiş YOK → kullanıcı uygular → yeni analizde YALNIZ
 *   `EVIDENCE_MISSING_APPROVED_HISTORY` doğru eşleşen satırlarda kalkar.
 *
 * Ayrıca: föyün yalnız açık onayla değişmesi, yeni sürümün
 * `ai_allocation_applied` olarak etiketlenmesi ve provenance'ın görünmesi.
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

const PLATE = '34 AL 5810'
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

/** Ekranda görünen eksik kanıt kodları; bitişik kodlar tek tek okunur. */
async function missingEvidenceCodes() {
  return evaluate(`(() => {
    const codes=new Set();
    for (const node of document.querySelectorAll('.allocation-code')) {
      const text=node.textContent?.trim() ?? '';
      if (text.startsWith('EVIDENCE_MISSING_')) codes.add(text);
    }
    return [...codes].sort();
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
  // İkinci dosya: uygulama sonrası onaylı geçmişin BAŞKA bir dosyada
  // gerçekten kanıt olarak kullanıldığını ölçmek için.
  const secondCaseId = uuidv7()
  const password = 'p58-browser-sentetik-parola-58'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p58-browser','P58 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p58-browser@test.local','P58 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,5810,'2026/5810','traffic','open','reporting',$4,'34AL5810',$3,'2026-07-01',1),
            ($5,$2,2026,5811,'2026/5811','traffic','open','reporting','34 AL 5811','34AL5811',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId, PLATE, secondCaseId],
  )
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor)
     VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
    [uuidv7(), organizationId],
  )
  return {
    organizationId, userId, caseId, secondCaseId,
    email: 'p58-browser@test.local', password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-19T15:00:00.000Z'),
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
    server: { host: '127.0.0.1', port: 4198, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9358',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p58-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9358/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9358/json/new?${encodeURIComponent('http://127.0.0.1:4198/')}`,
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

  const seedSheet = async (targetCaseId) => evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${targetCaseId}/labor-sheet', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedCaseVersion: 1, confirmed: true, items: [
        { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900000, laborAmountMinor: 100000 }
      ] })
    });
    return response.status;
  })()`)
  if (await seedSheet(seeded.caseId) !== 201) throw new Error('LABOR_SHEET_SEED_FAILED')
  if (await seedSheet(seeded.secondCaseId) !== 201) throw new Error('SECOND_SHEET_SEED_FAILED')

  const openLaborTab = async (targetCaseId) => {
    await evaluate(`location.href='http://127.0.0.1:4198/dosyalar/${targetCaseId}'; true`)
    await waitFor("document.body.textContent.includes('İşçilik')")
    await clickExact('İşçilik')
    await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  }

  // ── ADIM 1: onaylı geçmiş YOK.
  await openLaborTab(seeded.caseId)
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")

  const codesBefore = await missingEvidenceCodes()
  if (!codesBefore.includes('EVIDENCE_MISSING_APPROVED_HISTORY')) {
    throw new Error(`APPROVED_HISTORY_CODE_ABSENT; görünen: ${codesBefore.join(',') || '(yok)'}`)
  }

  // Hiçbir satır varsayılan seçili değildir ve uygulama düğmesi kapalıdır.
  await waitFor("document.body.textContent.includes('0 satır seçili')")
  const applyDisabledInitially = await evaluate(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
      item.textContent?.includes('Seçilenleri Föye Uygula'));
    return node ? node.disabled : null;
  })()`)
  if (applyDisabledInitially !== true) throw new Error('APPLY_SHOULD_BE_DISABLED_INITIALLY')

  // ── ADIM 2: kullanıcı satırı seçer, gerekçe girer ve AÇIKÇA onaylar.
  await waitFor(`(() => {
    const box=document.querySelector('.allocation-line input[type="checkbox"]');
    if(!box) return false; box.click(); return true;
  })()`)
  await waitFor("document.body.textContent.includes('AI önerisi: parça')")
  await fillLabel('Sürüm gerekçesi', 'AI dağıtımı incelendi ve onaylandı')

  const versionsBefore = await pool.query(
    'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE case_id=$1',
    [seeded.caseId],
  )
  await clickContains('Seçilenleri Föye Uygula')
  await waitFor(`document.querySelector('[role="dialog"]')!==null`)

  const dialogText = await evaluate(`document.querySelector('[role="dialog"]')?.textContent ?? ''`)
  if (!dialogText.includes('Sürüm 1')) throw new Error('SOURCE_VERSION_NOT_SHOWN')
  if (!dialogText.includes('Sürüm 2')) throw new Error('TARGET_VERSION_NOT_SHOWN')

  // Modal açık ama onaylanmadı: föy DEĞİŞMEZ.
  const versionsDuringModal = await pool.query(
    'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE case_id=$1',
    [seeded.caseId],
  )
  if (versionsDuringModal.rows[0].n !== versionsBefore.rows[0].n) {
    throw new Error('SHEET_MUTATED_WITHOUT_CONFIRMATION')
  }

  await clickExact('Onaylıyorum, Uygula')
  await waitFor("document.body.textContent.includes('Uygulama geçmişi')")

  // ── ADIM 3: föy gerçekten değişti ve provenance yazıldı.
  const applied = await pool.query(
    `SELECT a.status,a.source_sheet_version,a.target_sheet_version,
            a.selected_line_count,v.source_type
       FROM labor_allocation_applications a
       JOIN labor_sheet_versions v ON v.id=a.target_sheet_version_id
      WHERE a.case_id=$1`,
    [seeded.caseId],
  )
  if (applied.rows.length !== 1) throw new Error('APPLICATION_NOT_PERSISTED')
  if (applied.rows[0].status !== 'completed') throw new Error('APPLICATION_NOT_COMPLETED')
  if (applied.rows[0].source_sheet_version !== 1) throw new Error('SOURCE_VERSION_WRONG')
  if (applied.rows[0].target_sheet_version !== 2) throw new Error('TARGET_VERSION_WRONG')
  if (applied.rows[0].source_type !== 'ai_allocation_applied') {
    throw new Error('SHEET_VERSION_SOURCE_TYPE_WRONG')
  }

  const appliedLines = await pool.query(
    'SELECT count(*)::int AS n FROM labor_allocation_applied_lines',
  )
  if (appliedLines.rows[0].n !== 1) throw new Error('APPLIED_LINE_SNAPSHOT_MISSING')

  // ── ADIM 4: BAŞKA dosyada yeni analiz; onaylı geçmiş kodu DÜŞER.
  await openLaborTab(seeded.secondCaseId)
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")

  const codesAfter = await missingEvidenceCodes()
  if (codesAfter.includes('EVIDENCE_MISSING_APPROVED_HISTORY')) {
    throw new Error(`APPROVED_HISTORY_NOT_CLEARED; görünen: ${codesAfter.join(',')}`)
  }
  // Diğer kanallar bağımsız kalır.
  for (const code of ['EVIDENCE_MISSING_VEHICLE_IDENTITY', 'EVIDENCE_MISSING_EXPERT_BASELINE']) {
    if (!codesAfter.includes(code)) throw new Error(`UNRELATED_CODE_CLEARED_${code}`)
  }

  // Plaka audit kayıtlarına sızmaz.
  const leak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [PLATE],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('APPLY_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('APPLY_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('APPLY_1366_DARK')

  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 25_000)
  const staleProvenance = await evaluate("document.querySelectorAll('.allocation-applications').length")
  if (staleProvenance > 0) throw new Error('STALE_PROVENANCE_AFTER_SHUTDOWN')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico') || url.endsWith('/api/v1/auth/session')
    || url.includes('/labor-allocation') || url.includes('/labor')
    || url.includes('/vehicle-profile') || url.includes('/cases')
    || url.includes('/references/') || url.includes('/dashboard')
    || url.includes('/operational-alerts') || url.includes('/workspace-plans')
    || url.includes('/documents')
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
    missingEvidenceCodes: { before: codesBefore, after: codesAfter },
    scenarios: {
      login: true,
      noApprovedHistoryBeforeApply: true,
      nothingSelectedByDefault: true,
      sheetUnchangedUntilExplicitConfirmation: true,
      confirmationShowsSourceAndTargetVersion: true,
      applicationPersistedAsCompleted: true,
      sheetVersionLabelledAiAllocationApplied: true,
      appliedLineSnapshotStored: true,
      approvedHistoryClearedAfterApply: true,
      unrelatedChannelsUnaffected: true,
      noPiiInAudit: true,
      noStaleProvenanceAfterShutdown: true,
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
