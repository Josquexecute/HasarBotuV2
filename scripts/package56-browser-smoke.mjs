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
 * Paket 56 tarayıcı smoke'u: AI kanıt zenginleştirme uçtan uca.
 *
 * Ölçülen: üç kanıt kanalı (araç profili, parça kodu, hasar bölgesi) kullanıcı
 * tarafından doldurulduğunda ilgili eksik kanıt kodlarının GERÇEKTEN düşmesi,
 * buna karşılık sunucu tarafındaki `control_required` zorlamasının kalkmaması,
 * tam şasi ve plakanın dışarı çıkmaması ve eski önerilerin okunabilir kalması.
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

const PLATE = '34 AL 5610'
const CHASSIS_PREFIX = 'NM4BJ12'
const CHASSIS_SUFFIX = 'K7T9931'
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

/** Tablo içindeki alanlar `aria-label` taşır; `<span>` etiketi yoktur. */
async function fillAriaLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const input=document.querySelector('[aria-label='+JSON.stringify(${encodedLabel})+']');
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

async function checkByText(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.textContent?.includes(${encoded}));
    const box=label?.querySelector('input[type="checkbox"]');
    if(!box || box.checked) return false;
    box.click();
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

/**
 * Analiz sonrasında ekranda görünen eksik kanıt kodlarını topla.
 *
 * Kodlar ayrı `<span>` içinde basılır; `textContent` üzerinde regex taraması
 * bitişik kodları tek eşleşmede yutar, bu yüzden elemanlar tek tek okunur.
 */
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

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const userId = uuidv7()
  const caseId = uuidv7()
  const password = 'p56-browser-sentetik-parola-56'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p56-browser','P56 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p56-browser@test.local','P56 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,5610,'2026/5610','traffic','open','reporting',$4,'34AL5610',$3,'2026-07-01',1)`,
    [caseId, organizationId, userId, PLATE],
  )
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor)
     VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
    [uuidv7(), organizationId],
  )
  return { organizationId, userId, caseId, email: 'p56-browser@test.local', password }
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
    server: { host: '127.0.0.1', port: 4196, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9356',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p56-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9356/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9356/json/new?${encodeURIComponent('http://127.0.0.1:4196/')}`,
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

  // ── Kanıt ÖNCESİ durum: föy kanıt alanları olmadan oluşturulur.
  const created = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedCaseVersion: 1, confirmed: true, items: [
        { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 1800000, laborAmountMinor: 200000 }
      ] })
    });
    return response.status;
  })()`)
  if (created !== 201) throw new Error('LABOR_SHEET_SEED_FAILED')

  await evaluate(`location.href='http://127.0.0.1:4196/dosyalar/${seeded.caseId}'; true`)
  await waitFor("document.body.textContent.includes('İşçilik')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")

  const codesBefore = await missingEvidenceCodes()
  for (const code of ['EVIDENCE_MISSING_VEHICLE_IDENTITY', 'EVIDENCE_MISSING_PART_CODE', 'EVIDENCE_MISSING_DAMAGE_REGION']) {
    if (!codesBefore.includes(code)) {
      throw new Error(`BASELINE_CODE_ABSENT_${code}; görünen: ${codesBefore.join(',') || '(yok)'}`)
    }
  }
  const controlBefore = await evaluate(
    "document.querySelectorAll('.allocation-line--control').length",
  )
  if (controlBefore !== 1) throw new Error('BASELINE_CONTROL_NOT_REQUIRED')

  // ── Kanal 1: dosya düzeyinde araç profili (Özet sekmesi).
  await clickExact('Özet')
  await waitFor("document.body.textContent.includes('Araç Profili')")
  await fillLabel('Marka', 'Sentetik Marka')
  await fillLabel('Model', 'Örnek Model')
  await fillLabel('Model yılı', '2021')
  await fillAriaLabel('Şasi ön eki', CHASSIS_PREFIX)
  await fillLabel('Motor kodu', 'K9K-628')
  await fillAriaLabel('Kanıt referansı', 'Ruhsat s.1')
  await clickExact('Araç profilini kaydet')
  await waitFor("document.body.textContent.includes('Sürüm 1')")

  // Tam şasi numarası UI'dan girilemez: alan yalnız prefix kabul eder.
  const chassisLimit = await evaluate(
    "document.querySelector('[aria-label=\"Şasi ön eki\"]')?.maxLength",
  )
  if (chassisLimit !== 11) throw new Error('CHASSIS_PREFIX_LIMIT_MISSING')

  // ── Kanal 2 ve 3: işçilik satırında parça kodu + hasar bölgesi.
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('Föyü Düzenle')")
  await clickExact('Föyü Düzenle')
  await waitFor("document.querySelector('[aria-label=\"Parça kodu 1\"]')!==null")
  await fillAriaLabel('Parça kodu 1', 'TMP-0142')
  await fillAriaLabel('Hasar bölgesi 1', 'Ön orta')
  await fillLabel('Sürüm gerekçesi', 'Ruhsat ve parça kataloğu ile kanıt tamamlandı')
  await checkByText('sürümlü olarak kaydedilmesini onaylıyorum')
  await clickContains('Sürümü Kaydet')
  await waitFor("document.body.textContent.includes('TMP-0142')")
  await waitFor("document.body.textContent.includes('Ön orta')")

  const storedItem = await pool.query(
    `SELECT i.part_code,i.part_code_source,i.damage_region
       FROM labor_sheet_items i
       JOIN labor_sheets s ON s.current_version_id=i.sheet_version_id
      WHERE s.case_id=$1`,
    [seeded.caseId],
  )
  if (storedItem.rows.length !== 1) throw new Error('EVIDENCE_ITEM_NOT_PERSISTED')
  if (storedItem.rows[0].part_code !== 'TMP-0142') throw new Error('PART_CODE_NOT_PERSISTED')
  if (storedItem.rows[0].part_code_source !== 'user_entered') throw new Error('PART_CODE_SOURCE_WRONG')
  if (storedItem.rows[0].damage_region !== 'Ön orta') throw new Error('DAMAGE_REGION_NOT_PERSISTED')

  // ── Kanıt SONRASI analiz: üç kod düşer, control_required düşmez.
  await fillLabel('Hasar tarifi', 'Ön bölgede darbe; tampon etkilendi.')
  await clickExact('Analiz Et')
  await waitFor("document.querySelectorAll('.allocation-line').length===1")
  await waitFor(`(() => [...document.querySelectorAll('.allocation-code')]
    .every((node)=>node.textContent?.trim()!=='EVIDENCE_MISSING_VEHICLE_IDENTITY'))()`)

  const codesAfter = await missingEvidenceCodes()
  for (const code of ['EVIDENCE_MISSING_VEHICLE_IDENTITY', 'EVIDENCE_MISSING_PART_CODE', 'EVIDENCE_MISSING_DAMAGE_REGION']) {
    if (codesAfter.includes(code)) throw new Error(`EVIDENCE_CODE_NOT_CLEARED_${code}`)
  }
  if (codesAfter.length >= codesBefore.length) throw new Error('EVIDENCE_CODES_NOT_REDUCED')

  // Model yüksek güven bildirse de sunucu tarafındaki zorlama kalkmaz.
  const controlAfter = await evaluate("document.querySelectorAll('.allocation-line--control').length")
  if (controlAfter !== 1) throw new Error('CONTROL_REQUIRED_WEAKENED_BY_EVIDENCE')

  // Kaynak alanlar değişti: yeni analiz farklı kanıt snapshot'ı üretir; eski
  // öneri okunabilir kalır ve değişmez.
  const runs = await pool.query(
    `SELECT evidence_hash,source_sheet_version,status
       FROM labor_allocation_runs WHERE case_id=$1 ORDER BY created_at`,
    [seeded.caseId],
  )
  if (runs.rows.length !== 2) throw new Error('EXPECTED_TWO_RUNS')
  if (runs.rows[0].evidence_hash === runs.rows[1].evidence_hash) {
    throw new Error('EVIDENCE_SNAPSHOT_NOT_INVALIDATED')
  }
  if (runs.rows[0].status !== 'review_required') throw new Error('OLD_RUN_MUTATED')

  // Araç profili sürümlenir ve tam şasi veritabanına da girmez.
  const profile = await pool.query(
    `SELECT v.profile_version,v.chassis_prefix
       FROM case_vehicle_profiles p
       JOIN case_vehicle_profile_versions v ON v.id=p.current_version_id
      WHERE p.case_id=$1`,
    [seeded.caseId],
  )
  if (profile.rows.length !== 1) throw new Error('VEHICLE_PROFILE_NOT_PERSISTED')
  if (profile.rows[0].chassis_prefix !== CHASSIS_PREFIX) throw new Error('CHASSIS_PREFIX_NOT_STORED')
  if (String(profile.rows[0].chassis_prefix).includes(CHASSIS_SUFFIX)) throw new Error('FULL_CHASSIS_STORED')

  // Plaka ve tam şasi audit kayıtlarına sızmaz.
  const leak = await pool.query(
    `SELECT count(*)::int AS n FROM audit_events
      WHERE details::text LIKE '%' || $1 || '%' OR details::text LIKE '%' || $2 || '%'`,
    [PLATE, CHASSIS_SUFFIX],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('EVIDENCE_1920_LIGHT')
  await clickExact('Özet')
  await waitFor("document.body.textContent.includes('Araç Profili')")
  await assertNoHorizontalOverflow('VEHICLE_PROFILE_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('VEHICLE_PROFILE_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('VEHICLE_PROFILE_1366_DARK')
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('TMP-0142')")
  await assertNoHorizontalOverflow('LABOR_EVIDENCE_1366_DARK')

  // API kapatıldığında araç profili sahte veriyle doldurulmaz.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 25_000)
  const staleProfile = await evaluate("document.querySelectorAll('.vehicle-profile').length")
  if (staleProfile > 0) throw new Error('STALE_VEHICLE_PROFILE_AFTER_SHUTDOWN')

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
    controlRequiredLines: { before: controlBefore, after: controlAfter },
    scenarios: {
      login: true,
      vehicleProfileSavedAndVersioned: true,
      chassisPrefixOnly: true,
      partCodeAndDamageRegionPersisted: true,
      evidenceCodesReduced: true,
      controlRequiredStillEnforced: true,
      evidenceSnapshotInvalidated: true,
      previousRunUnchanged: true,
      noPiiInAudit: true,
      noStaleProfileAfterShutdown: true,
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
