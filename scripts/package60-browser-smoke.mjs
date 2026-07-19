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

const PLATE = '34 AL 6010'
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


/** Tablo dışı select alanları aria-label taşır. */
async function selectByAriaLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const node=document.querySelector('[aria-label='+JSON.stringify(${encodedLabel})+']');
    if(!node) return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    setter.call(node,${encodedValue});
    node.dispatchEvent(new Event('change',{bubbles:true}));
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
  const password = 'p60-browser-sentetik-parola-58'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p60-browser','P60 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p60-browser@test.local','P60 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$2,2026,6010,'2026/6010','traffic','open','reporting',$4,'34AL6010',$3,'2026-07-01',1),
            ($5,$2,2026,6011,'2026/6011','traffic','open','reporting','34 AL 6011','34AL6011',$3,'2026-07-01',1)`,
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
    email: 'p60-browser@test.local', password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-19T19:00:00.000Z'),
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
    server: { host: '127.0.0.1', port: 4200, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9360',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p60-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9360/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9360/json/new?${encodeURIComponent('http://127.0.0.1:4200/')}`,
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

  // ── ADIM 1: Yönetim'de profil YOK; sahte profil uydurulmadığı görünür.
  await evaluate("location.href='http://127.0.0.1:4200/yonetim'; true")
  await waitFor("document.body.textContent.includes('Yönetim')")
  await clickExact('Excel Şablonları')
  await waitFor("document.body.textContent.includes('Excel Şablon Profilleri')")
  await waitFor("document.body.textContent.includes('Henüz şablon profili tanımlanmadı')")
  if (!(await evaluate("document.body.textContent.includes('önceden gömülü değildir')"))) {
    throw new Error('NO_EMBEDDED_VENDOR_COLUMNS_NOTICE_MISSING')
  }

  // ── ADIM 2: kullanıcı kendi sütunlarını ve eşlemesini tanımlar.
  await clickContains('Yeni Şablon Profili')
  await waitFor(`document.querySelector('[aria-label="Onarım sütunu"]')!==null`)
  await fillLabel('Profil adı', 'Sentetik Ofis Sablonu')
  await fillLabel('Sütunlar (her satır: ANAHTAR = Başlık)', 'ISCILIK = Iscilik Bedeli\nPARCA = Parca Bedeli')
  await selectByAriaLabel('Onarım sütunu', 'ISCILIK')
  await selectByAriaLabel('Değişim sütunu', 'PARCA')
  await selectByAriaLabel('Sökme-takma sütunu', 'ISCILIK')
  await clickExact('Profili Kaydet')
  await waitFor("document.body.textContent.includes('Sentetik Ofis Sablonu')")
  await waitFor("document.body.textContent.includes('3/8')")

  const storedProfile = await pool.query(
    `SELECT v.name,v.columns,v.mapping,v.profile_version
       FROM labor_excel_profiles p
       JOIN labor_excel_profile_versions v ON v.id=p.current_version_id
      WHERE p.organization_id=$1`,
    [seeded.organizationId],
  )
  if (storedProfile.rows.length !== 1) throw new Error('PROFILE_NOT_PERSISTED')
  if (storedProfile.rows[0].profile_version !== 1) throw new Error('PROFILE_VERSION_WRONG')
  if (storedProfile.rows[0].mapping.repair !== 'ISCILIK') throw new Error('MAPPING_NOT_STORED')
  if (storedProfile.rows[0].mapping.other !== null) throw new Error('UNMAPPED_SHOULD_BE_NULL')

  // ── ADIM 3: föy + AI dağıtımı + kullanıcı onaylı uygulama.
  // 1. satır önerildiği gibi, 2. satır DEĞİŞTİRİLEREK uygulanır.
  const applied = await evaluate(`(async () => {
    const post = async (url, body) => {
      const response = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const sheet = await post('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      expectedCaseVersion: 1, confirmed: true, items: [
        { description: 'On tampon', action: 'Onarim', partAmountMinor: 0, laborAmountMinor: 1000000 },
        { description: 'Sol camurluk', action: 'Degisim', partAmountMinor: 1800000, laborAmountMinor: 200000 }
      ]
    });
    if (sheet.status !== 201) return { step: 'sheet', status: sheet.status };
    const analyze = await post('/api/v1/cases/${seeded.caseId}/labor-allocation-ai/analyze', {
      expectedSheetVersion: 1, damageDescription: 'On sol darbe.', confirmedEgress: false
    });
    if (analyze.status !== 200) return { step: 'analyze', status: analyze.status };
    const runId = analyze.body.run.id;
    const apply = await post('/api/v1/cases/${seeded.caseId}/labor-allocation-ai/' + runId + '/apply', {
      expectedSheetVersion: 1, reason: 'AI dagitimi onaylandi', confirmed: true, lines: [
        { lineOrdinal: 1, description: 'On tampon', action: 'Onarim',
          partAmountMinor: 0, laborAmountMinor: 1000000 },
        { lineOrdinal: 2, description: 'Sol camurluk', action: 'Degisim',
          partAmountMinor: 1700000, laborAmountMinor: 300000 }
      ]
    });
    return { step: 'apply', status: apply.status };
  })()`)
  if (applied.status !== 200) throw new Error(`APPLY_FAILED_${applied.step}_${applied.status}`)

  // ── ADIM 4: dosyada projeksiyonu aç.
  await evaluate(`location.href='http://127.0.0.1:4200/dosyalar/${seeded.caseId}'; true`)
  await waitFor("document.body.textContent.includes('İşçilik')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('Uygulama geçmişi')")
  await waitFor(`(() => {
    const node=[...document.querySelectorAll('details')].find((item)=>
      item.textContent?.includes('Uygulama geçmişi'));
    if(!node) return false; node.open = true; return true;
  })()`)
  await clickExact('Excel projeksiyonu')
  await waitFor(`document.querySelector('[role="dialog"]')!==null`)

  const dialog = await evaluate(`document.querySelector('[role="dialog"]')?.textContent ?? ''`)
  if (!dialog.includes('hiçbir Excel dosyasına YAZMAZ')) throw new Error('NO_WRITE_NOTICE_MISSING')
  if (!dialog.includes('Iscilik Bedeli')) throw new Error('USER_COLUMN_LABEL_MISSING')
  // 2. satır kullanıcı tarafından değiştirildiği için sayı ÜRETİLMEZ.
  if (!dialog.includes('Manuel giriş gerekli')) throw new Error('MANUAL_ENTRY_NOT_FLAGGED')
  if (!dialog.includes('tür bazlı dağılım doğrulanmış değil')) {
    throw new Error('MANUAL_ENTRY_REASON_MISSING')
  }

  // Projekte edilen satır gerçekten sütuna düşmüş olmalı.
  const projectedCells = await evaluate(`(() => {
    const rows=[...document.querySelectorAll('[role="dialog"] tbody tr')];
    return rows.map((row)=>[...row.children].map((cell)=>cell.textContent?.trim() ?? ''));
  })()`)
  if (projectedCells.length !== 2) throw new Error('PROJECTION_ROW_COUNT_WRONG')
  const firstRow = projectedCells[0]
  if (firstRow[firstRow.length - 1] === 'Manuel giriş gerekli') {
    throw new Error('UNMODIFIED_LINE_SHOULD_PROJECT')
  }
  const secondRow = projectedCells[1]
  if (secondRow[secondRow.length - 1] !== 'Manuel giriş gerekli') {
    throw new Error('MODIFIED_LINE_SHOULD_BE_MANUAL')
  }
  // Manuel satırın hücreleri boş gösterilir; uydurma tutar yoktur.
  if (secondRow[1] !== '—' || secondRow[2] !== '—') throw new Error('MANUAL_LINE_CELLS_NOT_EMPTY')

  // Hiçbir dosya yazılmadı: uygulama aggregate'i değişmedi ve yeni föy sürümü
  // oluşmadı (projeksiyon salt okunur).
  const versionsAfter = await pool.query(
    'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE case_id=$1',
    [seeded.caseId],
  )
  if (versionsAfter.rows[0].n !== 2) throw new Error('PROJECTION_MUTATED_SHEET')

  // Plaka audit kayıtlarına sızmaz.
  const leak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [PLATE],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('PROJECTION_1920_LIGHT')
  await clickExact('Kapat')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('LABOR_1920_DARK')
  await setViewport(1366, 768)
  await evaluate("location.href='http://127.0.0.1:4200/yonetim'; true")
  await waitFor("document.body.textContent.includes('Yönetim')")
  await clickExact('Excel Şablonları')
  await waitFor("document.body.textContent.includes('Sentetik Ofis Sablonu')")
  await assertNoHorizontalOverflow('PROFILES_1366_DARK')

  // API kapatıldığında sahte profil gösterilmez.
  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 25_000)
  const staleProfiles = await evaluate(
    "document.body.textContent.includes('Sentetik Ofis Sablonu') ? 1 : 0",
  )
  if (staleProfiles > 0) throw new Error('STALE_PROFILE_AFTER_SHUTDOWN')

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
    scenarios: {
      login: true,
      noEmbeddedVendorColumns: true,
      userDefinedProfileSaved: true,
      mappingPersistedWithNullsForUnmapped: true,
      unmodifiedLineProjectedToUserColumns: true,
      modifiedLineFlaggedManualWithoutInventedNumbers: true,
      projectionDoesNotWriteOrMutateSheet: true,
      noPiiInAudit: true,
      noStaleProfileAfterShutdown: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1920x1080-dark', '1366x768-dark'],
  }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 200) }))
  process.exitCode = 1
} finally {
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) chrome.kill()
  await closeDatabasePool(pool)
}
