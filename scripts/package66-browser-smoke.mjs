import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
  process.env.ProgramFiles === undefined
    ? null
    : join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] === undefined
    ? null
    : join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] === undefined
    ? null
    : join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((path) => path !== null && existsSync(path))
if (chromeExecutable === undefined) throw new Error('CHROME_OR_EDGE_NOT_FOUND')

const pool = createDatabasePool({ config: databaseConfig })
const chromeProfile = mkdtempSync(join(tmpdir(), 'hasarbotu-p66-chrome-'))
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
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

async function fillAria(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const input=document.querySelector('[aria-label='+JSON.stringify(${encodedLabel})+']');
    if(!input) return false;
    (${SET_VALUE})(input,${encodedValue});
    return true;
  })()`)
}

async function fillAllAria(label, values) {
  const encodedLabel = JSON.stringify(label)
  const encodedValues = JSON.stringify(values)
  await waitFor(`(() => {
    const inputs=[...document.querySelectorAll('[aria-label='+JSON.stringify(${encodedLabel})+']')];
    if(inputs.length!==${values.length}) return false;
    const values=${encodedValues};
    inputs.forEach((input,index)=>(${SET_VALUE})(input,values[index]));
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

async function clickLabelContains(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.textContent?.includes(${encoded}));
    const input=label?.querySelector('input');
    if(!input) return false;
    if(!input.checked) input.click();
    return input.checked;
  })()`)
}

async function clickAllLabelsContaining(text, expectedCount) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const inputs=[...document.querySelectorAll('label')]
      .filter((node)=>node.textContent?.includes(${encoded}))
      .map((node)=>node.querySelector('input'))
      .filter(Boolean);
    if(inputs.length!==${expectedCount}) return false;
    inputs.forEach((input)=>{ if(!input.checked) input.click(); });
    return inputs.every((input)=>input.checked);
  })()`)
}

async function clickSupport(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('.value-loss-supports label')].find((node)=>
      node.textContent?.trim()===${encoded});
    const input=label?.querySelector('input[type=checkbox]');
    if(!input) return false;
    if(!input.checked) input.click();
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
  const documentId = uuidv7()
  const documentVersionId = uuidv7()
  const password = 'p66-browser-sentetik-parola-66'
  const contentHash = 'a'.repeat(64)
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p66-browser','P66 Browser')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p66-browser@test.local','P66 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,loss_date,notification_date,responsible_user_id,
        closed_at,version)
     VALUES ($1,$2,2026,6603,'2026/6603','traffic','closed','closed',
             '34 DK 6603','34DK6603','2026-07-02','2026-07-03',$3,
             '2026-07-20T10:00:00Z',1)`,
    [caseId, organizationId, userId],
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
     VALUES ($1,$2,$3,$4,1,'sentetik.pdf','Sentetik Ekspertiz','pdf','application/pdf',256,$5,
             'synthetic-root',$6,'manual','ready',true,true,'2026-07-15T08:00:00Z',$7)`,
    [
      documentVersionId,
      organizationId,
      documentId,
      caseId,
      contentHash,
      `sentetik/${caseId}/rapor.pdf`,
      userId,
    ],
  )
  await pool.query(
    'UPDATE documents SET current_version_id=$2 WHERE id=$1',
    [documentId, documentVersionId],
  )
  return {
    caseId,
    email: 'p66-browser@test.local',
    password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-20T11:00:00.000Z'),
    loggerEnabled: false,
    auth: {
      pool,
      cookieSecure: false,
      loginRateLimit: { limit: 200, windowMs: 60_000 },
    },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4199, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9366',
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9366/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9366/json/new?${encodeURIComponent('http://127.0.0.1:4199/')}`,
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

  await evaluate(`location.href='http://127.0.0.1:4199/dosyalar/${seeded.caseId}'; true`)
  await waitFor("document.body.textContent.includes('Değer Kaybı')")
  await clickExact('Değer Kaybı')
  await waitFor("document.body.textContent.includes('Uygunluk ve Kanıt Kontrolü')")
  await waitFor("document.body.textContent.includes('Henüz sürüm yok')")
  const consoleBaseline = cdp.events.length

  await fillLabel('Ağır / tam hasar', 'no')
  await fillLabel('Kusur oranı (%)', '75')
  await fillLabel('Marka', 'Sentetik')
  await fillLabel('Model', 'Model 66')
  await fillLabel('Varyant', 'Paket')
  await fillLabel('Model yılı', '2024')
  await fillLabel('Kilometre', '50000')
  await fillLabel('Kullanım şekli', 'Hususi')
  await fillLabel('Kaza öncesi piyasa değeri', '1000000')
  await fillLabel('Rayiç giriş gerekçesi', 'Onaylı rayiç analizi referansı kontrol edildi.')
  await fillLabel('Onarım sonrası piyasa değeri', '900000')
  await fillLabel('Antika / koleksiyon araç', 'no')
  await fillLabel('Önceki ağır hasar', 'no')
  await fillAria('Parça kataloğunda ara', 'SOL ÖN ÇAMURLUK (SAC)')
  await waitFor(`(() => {
    const input=document.querySelector('[aria-label="Parça kataloğunda ara"]');
    const operation=document.querySelector('[aria-label="Katalog işlemi"]');
    return input?.value==='SOL ÖN ÇAMURLUK (SAC)' && operation && !operation.disabled;
  })()`)
  await fillAria('Katalog işlemi', 'paint')
  await clickExact('Katalogdan Ekle')
  await waitFor("document.querySelectorAll('.value-loss-parts')[0]?.textContent.includes('Katsayı:')")
  await fillAria('Parça kodu', 'SOL_CAMURLUK')
  await fillAria('Parça adı', 'Sol çamurluk')
  await fillAria('Önceki hasar', 'no')
  await clickLabelContains('Ekspertiz raporu')
  for (const support of [
    'Araç kimliği',
    'Kilometre',
    'Kullanım',
    'Hasarlı parçalar',
    'Önceki hasar',
    'Kusur',
    'Ağır/tam hasar',
  ]) {
    await clickSupport(support)
  }
  await fillAllAria(
    'Emsal tutarı',
    ['1020000', '1010000', '1000000', '910000', '900000', '890000'],
  )
  await fillAllAria(
    'Emsal kilometresi',
    ['49000', '49300', '49600', '49900', '50200', '50500'],
  )
  await fillAllAria(
    'Emsal kaynağı',
    Array.from({ length: 6 }, (_, index) => `ref:sentetik-emsal-${index + 1}`),
  )
  await clickAllLabelsContaining('Doğrulandı', 6)

  await clickExact('Önizleme Oluştur')
  await waitFor("document.body.textContent.includes('Hesap önizlemesi üretildi')")
  await clickLabelContains('Önizleme girdilerini')
  await clickExact('Onaylanan Önizlemeyi Sürümle')
  await waitFor("document.body.textContent.includes('Yeni hesaplama taslağı ve sürümü oluşturuldu')")
  await clickLabelContains('insan onayına gönderiyorum')
  await clickExact('Onaya Gönder')
  await waitFor("document.body.textContent.includes('Onay bekliyor')")
  await clickLabelContains('insan olarak inceledim')
  await fillLabel('Onay / red gerekçesi', 'Kanıtlar insan tarafından kontrol edildi.')
  await clickExact('İnsan Onayı Ver')
  await waitFor("document.body.textContent.includes('İnsan onaylı sonuç')")
  await waitFor("document.body.textContent.includes('Hesap v1')")

  await fillLabel('Nihai rapor notu (isteğe bağlı)', 'P66 tarayıcı smoke nihai raporu.')
  await clickExact('Nihai Raporu Önizle')
  await waitFor("document.body.textContent.includes('Trafik Değer Kaybı Nihai Raporu')")
  await clickLabelContains('bu önizlemeden nihai PDF')
  await clickExact('Onayla ve Nihai PDF Oluştur')
  await waitFor("document.body.textContent.includes('Final PDF hazır')")

  const approvedClosure = await evaluate(`(async () => {
    const response=await fetch('/api/v1/traffic-value-loss/closure-summaries',{credentials:'include'});
    return {status:response.status,body:await response.json()};
  })()`)
  const approvedItem = approvedClosure.body.items.find((item) => item.caseId === seeded.caseId)
  if (approvedClosure.status !== 200 || approvedItem?.summary?.status !== 'present') {
    throw new Error(`CLOSURE_NOT_PRESENT_${approvedClosure.status}_${approvedItem?.summary?.status}`)
  }
  const approvedVersionId = approvedItem.summary.assessmentVersionId

  await clickExact('Önizleme Oluştur')
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.textContent?.includes('Önizleme girdilerini'));
    const input=label?.querySelector('input[type=checkbox]');
    return input && !input.checked;
  })()`)
  await clickLabelContains('Önizleme girdilerini')
  await clickExact('Onaylanan Önizlemeyi Sürümle')
  await waitFor("document.body.textContent.includes('Hesap v2')")
  await waitFor("document.body.textContent.includes('Mevcut onaylı revision v1 salt okunur tutuluyor')")

  const draftClosure = await evaluate(`(async () => {
    const response=await fetch('/api/v1/traffic-value-loss/closure-summaries',{credentials:'include'});
    return {status:response.status,body:await response.json()};
  })()`)
  const draftItem = draftClosure.body.items.find((item) => item.caseId === seeded.caseId)
  if (draftClosure.status !== 200
    || draftItem?.summary?.assessmentVersionId !== approvedVersionId) {
    throw new Error('NEW_DRAFT_REPLACED_APPROVED_CLOSURE')
  }

  await assertNoHorizontalOverflow('VALUE_LOSS_1920_LIGHT')
  await setViewport(1366, 768)
  await evaluate("document.documentElement.dataset.theme='dark'; true")
  await assertNoHorizontalOverflow('VALUE_LOSS_1366_DARK')
  const scrollState = await evaluate(`(() => {
    const history=document.querySelector('.value-loss-history ol');
    const module=document.querySelector('.case-module');
    return {
      historyOverflow:history ? getComputedStyle(history).overflow : null,
      moduleOverflow:module ? getComputedStyle(module).overflow : null,
    };
  })()`)
  if (!['auto', 'scroll'].includes(scrollState.historyOverflow)
    || !['auto', 'scroll'].includes(scrollState.moduleOverflow)) {
    throw new Error('VALUE_LOSS_SCROLLBAR_NOT_AVAILABLE')
  }

  const consoleErrors = cdp.events
    .slice(consoleBaseline)
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    .filter((event) => {
      const url = String(event.params?.entry?.url ?? '')
      return !/\/traffic-value-loss(?:\/current-approved)?$/.test(url)
    })
    .map((event) => `${event.params.entry.text} ${event.params.entry.url ?? ''}`.trim())
  if (consoleErrors.length > 0) {
    console.error(JSON.stringify({ consoleErrors }))
    throw new Error(`CONSOLE_ERRORS_${consoleErrors.length}`)
  }

  await app.close()
  apiOpen = false
  await clickExact('Özet')
  await clickExact('Değer Kaybı')
  await waitFor("document.body.textContent.includes('Bağlantı kurulamadı')")
  if (await evaluate("document.body.textContent.includes('İnsan onaylı sonuç')")) {
    throw new Error('MOCK_OR_STALE_APPROVED_FALLBACK_SHOWN')
  }

  console.log(JSON.stringify({
    smoke: 'package66-value-loss-revision',
    checks: {
      authenticatedSession: true,
      searchableCatalog: true,
      supportedOperation: true,
      previewAndBreakdown: true,
      revisionCreated: true,
      submitted: true,
      humanApproved: true,
      historyAndCurrentApproved: true,
      package40ReadsApprovedReport: true,
      newDraftKeepsApprovedClosure: true,
      noMockFallback: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1366x768-dark'],
  }))
} catch (error) {
  console.error(JSON.stringify({
    smokeError: error instanceof Error ? error.message : String(error),
  }))
  const failed = (cdp?.events ?? [])
    .filter((event) => event.method === 'Network.responseReceived'
      && Number(event.params?.response?.status ?? 0) >= 400)
    .map((event) => `${event.params.response.status} ${event.params.response.url}`)
  if (failed.length > 0) console.error(JSON.stringify({ failedResponses: failed }))
  throw error
} finally {
  await cdp?.send('Browser.close').catch(() => undefined)
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) {
    chrome.kill()
    await Promise.race([
      new Promise((resolveExit) => chrome.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ])
  }
  await closeDatabasePool(pool)
  try {
    rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (cleanupError) {
    console.error(JSON.stringify({
      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      chromeProfile,
    }))
  }
}
