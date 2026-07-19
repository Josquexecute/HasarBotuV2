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
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_OPERATION_TYPES_VERSION,
  computeEconomicTotals,
} from '../packages/domain/dist/index.js'
import {
  buildApp,
  createLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../services/api/dist/index.js'

/**
 * Paket 62 tarayıcı smoke'u: AI analiz ilerlemesi ve dayanıklılığı.
 *
 * Kanıtlanan sıra:
 *   analiz başlar → GERÇEK ilerleme görünür (grup/satır/süre) → sayfadan
 *   ayrılıp dönülür ve ilerleme sürer → tamamlanınca inceleme ekranına
 *   otomatik geçilir. Ayrıca iptal edilen koşu kısmi öneri SIZDIRMAZ.
 *
 * Sağlayıcı kasıtlı olarak yavaştır ki ilerleme tarayıcıda gözlemlenebilsin;
 * her grup ancak betik kapıyı açtığında tamamlanır.
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

const PLATE = '34 AL 6200'
/** 3 grup oluşturacak kadar satır (grup boyutu 20). */
const LINE_COUNT = 45
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

/** İlerleme panelinin ekranda okunan metni. */
async function progressText() {
  return evaluate(`document.querySelector('.allocation-progress')?.textContent ?? ''`)
}

async function analyzeButton() {
  return evaluate(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
      item.textContent?.trim()==='Analiz Et' || item.textContent?.trim()==='Analiz sürüyor…');
    return node ? { label: node.textContent.trim(), disabled: node.disabled } : null;
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

function chunkIndexOf(providerRequestId) {
  const parts = providerRequestId.split(':')
  return Number(parts[parts.length - 1])
}

function chunkOutput(lines) {
  return {
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    lines: lines.map((line) => {
      const total = line.partAmountMinor + line.laborAmountMinor
      const buckets = {
        repair_labor: total,
        new_part_or_ownership: 0,
        remove_install: 0,
        paint_and_consumable: 0,
        calibration: 0,
        related_operations: 0,
      }
      return {
        lineOrdinal: line.ordinal,
        allocations: [{ operationType: 'repair', amountMinor: total }],
        repairReplaceOpinion: 'repair_indicated',
        economicComparison: { buckets, ...computeEconomicTotals(buckets), note: 'Sentetik.' },
        reasoning: 'Sentetik gerekce.',
        evidenceRefs: [],
        confidence: 0.55,
        conflictCodes: [],
        missingEvidenceCodes: [],
        controlRequired: true,
      }
    }),
    requiresHumanReview: true,
  }
}

/**
 * Her grubu betik serbest bırakana kadar bekleten sağlayıcı.
 * Böylece tarayıcıda ilerleme adım adım gözlemlenebilir.
 */
function gatedAdapter() {
  const gates = []
  const arrived = []
  return {
    arrived,
    releaseOne() {
      const gate = gates.shift()
      if (gate === undefined) return false
      gate()
      return true
    },
    releaseAll() { for (const gate of gates.splice(0)) gate() },
    adapter: {
      providerId: 'gemini-generate-content',
      providerVersion: 'p62-browser-smoke/1.0.0',
      modelId: 'p62-browser-smoke',
      externalProvider: true,
      retentionMode: 'free_tier_product_improvement',
      pricingVersion: 'p62-browser-smoke/1.0.0',
      maximumInputCharacters: 400_000,
      estimateCostMinor: () => 1,
      async execute(request, signal) {
        arrived.push(chunkIndexOf(request.providerRequestId))
        await new Promise((resolveGate, reject) => {
          gates.push(resolveGate)
          signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
        const output = chunkOutput(request.context.lines)
        return {
          output,
          usage: {
            inputCharacters: 1_000,
            outputCharacters: JSON.stringify(output).length,
            inputTokens: 100,
            outputTokens: 200,
            estimatedCostMinor: 1,
            actualCostMinor: 1,
          },
          diagnostics: { finishReason: 'STOP', retryCount: 0 },
        }
      },
    },
  }
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const caseId = uuidv7()
  const password = 'p62-browser-sentetik-parola-62'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p62-browser','P62 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p62-browser@test.local','P62 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,6200,'2026/6200','traffic','open','reporting',$4,'34AL6200',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId, PLATE],
  )
  // Çağrı başına zaman aşımı politikanın izin verdiği tavana (30 sn) çekilir:
  // sağlayıcı kapıları tarayıcı etkileşimi boyunca açık tutulduğu için
  // varsayılan 5 sn ölçümü değil, ölçüm düzeneğini bozardı.
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor,request_timeout_ms)
     VALUES ($1,$2,true,ARRAY['gemini-generate-content']::text[],1000000,1000000,30000)`,
    [uuidv7(), organizationId],
  )
  return { organizationId, userId, caseId, email: 'p62-browser@test.local', password }
}

try {
  const seeded = await seed()
  const gate = gatedAdapter()
  app = buildApp({
    clock: fixedClock('2026-07-20T09:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
    laborAllocationProviders: createLaborAllocationProviderRegistry({ gemini: gate.adapter }),
    laborAllocationProviderId: 'gemini-generate-content',
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
    '--disable-background-networking', '--remote-debugging-port=9362',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p62-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9362/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9362/json/new?${encodeURIComponent('http://127.0.0.1:4198/')}`,
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

  // 45 satırlık föy: grup boyutu 20 olduğu için 3 grup oluşur.
  const sheetStatus = await evaluate(`(async () => {
    const items = Array.from({ length: ${LINE_COUNT} }, (unused, index) => ({
      description: 'Kalem ' + (index + 1),
      action: 'Onarım',
      partAmountMinor: 100000,
      laborAmountMinor: 50000,
    }));
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedCaseVersion: 1, confirmed: true, items })
    });
    return response.status;
  })()`)
  if (sheetStatus !== 201) throw new Error('LABOR_SHEET_SEED_FAILED')

  const openLaborTab = async () => {
    await evaluate(`location.href='http://127.0.0.1:4198/dosyalar/${seeded.caseId}'; true`)
    await waitFor("document.body.textContent.includes('İşçilik')")
    await clickExact('İşçilik')
    await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  }

  // ── ADIM 1: analiz başlar, ilerleme paneli GERÇEK sayılarla görünür.
  await openLaborTab()
  await fillLabel('Hasar tarifi', 'Ön bölgede yaygın darbe; çok kalemli föy.')
  await clickExact('Analiz Et')

  await waitFor(`document.querySelector('.allocation-progress')!==null`)
  const progressAtStart = await progressText()
  if (!progressAtStart.includes('0/3 grup')) {
    throw new Error(`CHUNK_PROGRESS_NOT_SHOWN; görünen: ${progressAtStart}`)
  }
  if (!progressAtStart.includes(`0/${LINE_COUNT} satır`)) {
    throw new Error(`LINE_PROGRESS_NOT_SHOWN; görünen: ${progressAtStart}`)
  }
  if (!/\d+ sn/.test(progressAtStart)) throw new Error('ELAPSED_TIME_NOT_SHOWN')

  // Analiz sürerken buton kilitlidir.
  const lockedButton = await analyzeButton()
  if (lockedButton?.disabled !== true) throw new Error('ANALYZE_BUTTON_NOT_LOCKED')
  if (lockedButton.label !== 'Analiz sürüyor…') throw new Error('ANALYZE_BUTTON_LABEL_WRONG')

  // Aynı föy sürümü için ikinci başlatma reddedilir.
  const doubleStart = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-allocation-ai/analyze', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedSheetVersion: 1, damageDescription: 'Ikinci deneme', confirmedEgress: false })
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, code: body?.error?.code ?? null };
  })()`)
  if (doubleStart.status !== 409) throw new Error(`DOUBLE_START_NOT_BLOCKED; ${JSON.stringify(doubleStart)}`)

  // ── ADIM 2: ilk grup tamamlanır; ilerleme GERÇEKTEN artar.
  await retry(async () => { if (!gate.releaseOne()) throw new Error('gate_pending') })
  await waitFor(`document.querySelector('.allocation-progress')?.textContent?.includes('1/3 grup')`)
  const progressAfterFirst = await progressText()
  if (!progressAfterFirst.includes('20/45 satır')) {
    throw new Error(`LINE_PROGRESS_NOT_ADVANCED; görünen: ${progressAfterFirst}`)
  }

  // ── ADIM 3: sayfadan ayrılıp dönülür; ilerleme kaybolmaz.
  await evaluate(`location.href='http://127.0.0.1:4198/dosyalar'; true`)
  await waitFor("document.body.textContent.includes('Dosyalar')")
  await openLaborTab()
  await waitFor(`document.querySelector('.allocation-progress')!==null`)
  const progressAfterReturn = await progressText()
  if (!progressAfterReturn.includes('1/3 grup')) {
    throw new Error(`PROGRESS_LOST_ON_NAVIGATION; görünen: ${progressAfterReturn}`)
  }

  // ── ADIM 4: kalan gruplar biter; inceleme ekranına OTOMATİK geçilir.
  await retry(async () => { if (!gate.releaseOne()) throw new Error('gate_pending') })
  await retry(async () => { if (!gate.releaseOne()) throw new Error('gate_pending') })
  // Tamamlanma yoklamayla görünür (1,5 sn aralık); pay bırakılır.
  await waitFor(`document.querySelectorAll('.allocation-line').length===${LINE_COUNT}`, 45_000)
  if (await evaluate(`document.querySelector('.allocation-progress')!==null`)) {
    throw new Error('PROGRESS_PANEL_NOT_DISMISSED')
  }
  const completedRun = await pool.query(
    `SELECT status,total_line_count,total_chunk_count FROM labor_allocation_runs WHERE case_id=$1`,
    [seeded.caseId],
  )
  if (completedRun.rows.length !== 1) throw new Error('RUN_NOT_PERSISTED')
  if (completedRun.rows[0].status !== 'review_required') throw new Error('RUN_NOT_REVIEW_REQUIRED')
  if (completedRun.rows[0].total_line_count !== LINE_COUNT) throw new Error('TOTAL_LINE_COUNT_WRONG')
  if (completedRun.rows[0].total_chunk_count !== 3) throw new Error('TOTAL_CHUNK_COUNT_WRONG')

  // Her grup kendi makbuzunu üretti; ledger toplamı korunur.
  const receipts = await pool.query(
    `SELECT count(*)::int AS n FROM labor_allocation_provider_receipts WHERE organization_id=$1`,
    [seeded.organizationId],
  )
  if (receipts.rows[0].n !== 3) throw new Error(`RECEIPT_COUNT_WRONG_${receipts.rows[0].n}`)

  // ── ADIM 5: yeni koşu başlatılıp İPTAL edilir; kısmi öneri sızmaz.
  const reviseStatus = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet/versions', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: 1, confirmed: true, reason: 'Iptal senaryosu icin yeni surum',
        items: [{ description: 'Kalem 1', action: 'Onarım', partAmountMinor: 100000, laborAmountMinor: 50000 }] })
    });
    return response.status;
  })()`)
  if (![200, 201].includes(reviseStatus)) throw new Error(`SHEET_REVISE_FAILED_${reviseStatus}`)
  await openLaborTab()
  await fillLabel('Hasar tarifi', 'Iptal edilecek analiz.')
  await clickExact('Analiz Et')
  await waitFor(`document.querySelector('.allocation-progress')!==null`)
  await clickExact('Analizi İptal Et')

  // İptal isteği önce ARA durum olarak kaydedilir; başarı hemen iddia edilmez.
  await retry(async () => {
    const state = await pool.query(
      `SELECT status FROM labor_allocation_runs WHERE case_id=$1 AND source_sheet_version=2`,
      [seeded.caseId],
    )
    const current = state.rows[0]?.status ?? '(yok)'
    if (!['cancel_requested', 'cancelled'].includes(current)) {
      const cancelCalls = cdp.events.filter((event) =>
        event.method === 'Network.requestWillBeSent'
        && String(event.params?.request?.url ?? '').includes('/cancel'))
      const uiError = await evaluate(`document.querySelector('.allocation-panel__error')?.textContent ?? '(yok)'`)
      throw new Error(`CANCEL_REQUEST_NOT_RECORDED_${current}; istek=${cancelCalls.length}; ekranHatası=${uiError}`)
    }
  }, 10_000)

  // Önce sunucu tarafı gerçekten sonlansın; sonra ekranda okunur.
  await retry(async () => {
    const state = await pool.query(
      `SELECT status,safe_error_code FROM labor_allocation_runs
        WHERE case_id=$1 AND source_sheet_version=2`,
      [seeded.caseId],
    )
    const current = state.rows[0]?.status ?? '(yok)'
    if (current !== 'cancelled') {
      throw new Error(`CANCEL_NOT_SETTLED_${current}_${state.rows[0]?.safe_error_code ?? 'null'}`)
    }
  }, 30_000)
  await waitFor("document.body.textContent.includes('iptal edildi; kısmi sonuç kaydedilmedi')", 30_000)
  gate.releaseAll()

  const cancelled = await pool.query(
    `SELECT r.status,
            (SELECT count(*)::int FROM labor_allocation_line_suggestions l WHERE l.run_id=r.id) AS line_count
       FROM labor_allocation_runs r
      WHERE r.case_id=$1 AND r.source_sheet_version=2`,
    [seeded.caseId],
  )
  if (cancelled.rows.length !== 1) throw new Error('CANCELLED_RUN_NOT_PERSISTED')
  if (cancelled.rows[0].status !== 'cancelled') {
    throw new Error(`CANCELLED_STATUS_WRONG_${cancelled.rows[0].status}`)
  }
  if (cancelled.rows[0].line_count !== 0) throw new Error('PARTIAL_SUGGESTION_LEAKED')

  // Önceki başarılı koşu iptalden etkilenmedi.
  const untouched = await pool.query(
    `SELECT status FROM labor_allocation_runs WHERE case_id=$1 AND source_sheet_version=1`,
    [seeded.caseId],
  )
  if (untouched.rows[0]?.status !== 'review_required') throw new Error('PREVIOUS_RUN_MUTATED')

  // Plaka audit kayıtlarına sızmaz.
  const leak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [PLATE],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('PROGRESS_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('PROGRESS_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('PROGRESS_1366_DARK')

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
    lineCount: LINE_COUNT,
    chunkCount: 3,
    providerCalls: gate.arrived.length,
    scenarios: {
      login: true,
      realChunkAndLineProgressShown: true,
      elapsedTimeShown: true,
      analyzeButtonLockedWhileRunning: true,
      doubleStartBlockedWith409: true,
      progressAdvancesPerChunk: true,
      progressSurvivesNavigation: true,
      autoTransitionToReviewOnCompletion: true,
      perChunkReceiptsRecorded: true,
      cancelIsExplicitUserAction: true,
      cancelledRunLeaksNoSuggestion: true,
      previousRunUnchanged: true,
      noPiiInAudit: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1920x1080-dark', '1366x768-dark'],
  }))
} catch (error) {
  // Düşen koşuda sessiz kalmamak için başarısız HTTP yanıtları dökülür.
  const failed = (cdp?.events ?? [])
    .filter((event) => event.method === 'Network.responseReceived'
      && Number(event.params?.response?.status ?? 0) >= 400)
    .map((event) => `${event.params.response.status} ${event.params.response.url}`)
  if (failed.length > 0) console.error(JSON.stringify({ failedResponses: failed }))
  throw error
} finally {
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) chrome.kill()
  await closeDatabasePool(pool)
}
