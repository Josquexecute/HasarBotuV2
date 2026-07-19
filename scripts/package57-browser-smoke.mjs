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
 * Paket 57 tarayıcı smoke'u: eksper baseline kanıtı uçtan uca.
 *
 * Ölçülen: önceki onaylı föy sürümü baseline olarak bağlanınca
 * `EVIDENCE_MISSING_EXPERT_BASELINE` kodunun gerçekten düşmesi, karşılaştırmanın
 * satır bazında görünmesi, çelişkide kontrol zorlamasının kalkmaması ve
 * AI önerisinin baseline'a dönüşmemesi.
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

const PLATE = '34 AL 5710'
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
  const password = 'p57-browser-sentetik-parola-57'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p57-browser','P57 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p57-browser@test.local','P57 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,5710,'2026/5710','traffic','open','reporting',$4,'34AL5710',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId, PLATE],
  )
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor)
     VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
    [uuidv7(), organizationId],
  )
  return { organizationId, userId, caseId, email: 'p57-browser@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-19T14:00:00.000Z'),
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
    server: { host: '127.0.0.1', port: 4197, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9357',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p57-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9357/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9357/json/new?${encodeURIComponent('http://127.0.0.1:4197/')}`,
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

  // Sürüm 1: eksperin onayladığı ilk dağılım. Parça ağırlıklı.
  const created = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedCaseVersion: 1, confirmed: true, items: [
        { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900000, laborAmountMinor: 100000 }
      ] })
    });
    return response.status;
  })()`)
  if (created !== 201) throw new Error('LABOR_SHEET_SEED_FAILED')

  await evaluate(`location.href='http://127.0.0.1:4197/dosyalar/${seeded.caseId}'; true`)
  await waitFor("document.body.textContent.includes('İşçilik')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")

  // ── Baseline ÖNCESİ: tek sürüm var, karşılaştırılacak onaylı geçmiş yok.
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")
  await waitFor("document.body.textContent.includes('Eksper baseline yok')")

  const codesBefore = await missingEvidenceCodes()
  if (!codesBefore.includes('EVIDENCE_MISSING_EXPERT_BASELINE')) {
    throw new Error(`BASELINE_CODE_ABSENT; görünen: ${codesBefore.join(',') || '(yok)'}`)
  }
  const baselineBlocksBefore = await evaluate("document.querySelectorAll('.allocation-baseline').length")
  if (baselineBlocksBefore !== 0) throw new Error('BASELINE_SHOWN_WITHOUT_SOURCE')

  // AI önerisi üretildi ama baseline'a DÖNÜŞMEZ: kaynak hâlâ yok.
  const runsWithoutBaseline = await pool.query(
    'SELECT count(*)::int AS n FROM labor_allocation_runs WHERE case_id=$1 AND baseline_sheet_version IS NOT NULL',
    [seeded.caseId],
  )
  if (runsWithoutBaseline.rows[0].n !== 0) throw new Error('AI_SUGGESTION_TREATED_AS_BASELINE')

  // ── Föyü revize et: sürüm 1 artık eksper baseline'ı olur.
  // Yeni dağılım işçilik ağırlıklı; ekonomik şekil belirgin değişir.
  const revised = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet/versions', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: 1, confirmed: true,
        reason: 'Onarım yönünde revize edildi', items: [
        { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 100000, laborAmountMinor: 900000 }
      ] })
    });
    return response.status;
  })()`)
  if (revised !== 200) throw new Error('LABOR_SHEET_REVISE_FAILED')

  // Föy değişti: AI modülü yeniden kurulur (Paket 56 davranışı).
  await clickExact('Özet')
  await waitFor("document.body.textContent.includes('Araç Profili')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")
  await waitFor("document.body.textContent.includes('Eksper baseline mevcut')")

  // ── Baseline SONRASI: yalnız baseline kodu düşer.
  const codesAfter = await missingEvidenceCodes()
  if (codesAfter.includes('EVIDENCE_MISSING_EXPERT_BASELINE')) {
    throw new Error('BASELINE_CODE_NOT_CLEARED')
  }
  for (const code of ['EVIDENCE_MISSING_VEHICLE_IDENTITY', 'EVIDENCE_MISSING_APPROVED_HISTORY']) {
    if (!codesAfter.includes(code)) throw new Error(`UNRELATED_CODE_CLEARED_${code}`)
  }

  // Satır bazlı karşılaştırma görünür.
  await waitFor("document.querySelectorAll('.allocation-baseline').length===1")
  const comparison = await evaluate(`(() => {
    const node=document.querySelector('.allocation-baseline');
    return {
      text: node?.textContent ?? '',
      conflict: node?.classList.contains('allocation-baseline--conflict') ?? false,
    };
  })()`)
  if (!comparison.text.includes('Eksper baseline (Sürüm 1)')) throw new Error('BASELINE_VERSION_NOT_SHOWN')
  if (!comparison.text.includes('Onaylı:')) throw new Error('BASELINE_APPROVED_SPLIT_NOT_SHOWN')
  if (!comparison.text.includes('fark %')) throw new Error('BASELINE_DELTA_NOT_SHOWN')

  // Ekonomik şekil belirgin saptığı için çelişki kodu SUNUCUDA zorlanır.
  const conflictShown = await evaluate(`(() => [...document.querySelectorAll('.allocation-code')]
    .some((node)=>node.textContent?.trim()==='CONFLICT_EXPERT_BASELINE_DISAGREEMENT'))()`)
  if (!conflictShown) throw new Error('BASELINE_CONFLICT_NOT_ENFORCED')
  if (!comparison.conflict) throw new Error('BASELINE_CONFLICT_NOT_HIGHLIGHTED')

  // Çelişkili satır kontrol gerekli kalır ve toplu seçim onu seçemez.
  const controlAfter = await evaluate("document.querySelectorAll('.allocation-line--control').length")
  if (controlAfter !== 1) throw new Error('CONTROL_REQUIRED_WEAKENED_BY_BASELINE')
  const bulkDisabled = await evaluate(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
      item.textContent?.includes('hariç tümünü seç'));
    return node ? node.disabled : null;
  })()`)
  if (bulkDisabled !== true) throw new Error('BULK_SELECT_SHOULD_BE_DISABLED')

  // Kayıt: baseline seçimi ve karşılaştırma immutable saklanır.
  const stored = await pool.query(
    `SELECT r.baseline_sheet_version,r.baseline_match_version,r.baseline_matched_line_count,
            l.baseline_part_amount_minor::text AS baseline_part,
            l.baseline_labor_amount_minor::text AS baseline_labor,l.baseline_conflict
       FROM labor_allocation_runs r
       JOIN labor_allocation_line_suggestions l ON l.run_id=r.id
      WHERE r.case_id=$1 AND r.baseline_sheet_version IS NOT NULL`,
    [seeded.caseId],
  )
  if (stored.rows.length !== 1) throw new Error('BASELINE_RUN_NOT_PERSISTED')
  if (stored.rows[0].baseline_sheet_version !== 1) throw new Error('BASELINE_VERSION_WRONG')
  if (stored.rows[0].baseline_match_version !== 'labor-baseline-match/1.0.0') {
    throw new Error('BASELINE_MATCH_VERSION_NOT_STORED')
  }
  if (stored.rows[0].baseline_matched_line_count !== 1) throw new Error('BASELINE_MATCH_COUNT_WRONG')
  if (stored.rows[0].baseline_part !== '900000') throw new Error('BASELINE_APPROVED_AMOUNT_WRONG')
  if (stored.rows[0].baseline_conflict !== true) throw new Error('BASELINE_CONFLICT_NOT_PERSISTED')

  // Kanıt hash'i baseline dahil edildiği için değişir.
  const hashes = await pool.query(
    'SELECT DISTINCT evidence_hash FROM labor_allocation_runs WHERE case_id=$1',
    [seeded.caseId],
  )
  if (hashes.rows.length !== 2) throw new Error('EVIDENCE_HASH_NOT_INVALIDATED')

  // Plaka audit kayıtlarına sızmaz.
  const leak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [PLATE],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('BASELINE_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('BASELINE_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('BASELINE_1366_DARK')

  // API kapatıldığında bayat karşılaştırma gösterilmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 25_000)
  const staleBaseline = await evaluate("document.querySelectorAll('.allocation-baseline').length")
  if (staleBaseline > 0) throw new Error('STALE_BASELINE_AFTER_SHUTDOWN')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico') || url.endsWith('/api/v1/auth/session')
    || url.includes('/labor-allocation-ai') || url.includes('/labor')
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
      noBaselineOnFirstVersion: true,
      aiSuggestionNotTreatedAsBaseline: true,
      previousApprovedVersionBecomesBaseline: true,
      onlyBaselineCodeCleared: true,
      perLineComparisonVisible: true,
      conflictEnforcedServerSide: true,
      controlRequiredStillEnforced: true,
      baselineStoredImmutably: true,
      evidenceHashInvalidated: true,
      noPiiInAudit: true,
      noStaleBaselineAfterShutdown: true,
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
