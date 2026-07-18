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

async function fillAria(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const input=document.querySelector('[aria-label='+JSON.stringify(${encodedLabel})+']');
    if(!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${encodedValue});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
}

async function readAria(label) {
  const encoded = JSON.stringify(label)
  return evaluate(`document.querySelector('[aria-label='+JSON.stringify(${encoded})+']')?.value ?? null`)
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

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const foreignOrganizationId = uuidv7()
  const userId = uuidv7()
  const foreignUserId = uuidv7()
  const historyCaseId = uuidv7()
  const targetCaseId = uuidv7()
  const foreignCaseId = uuidv7()
  const password = 'p46-browser-sentetik-parola-46'
  const passwordHash = await hashPassword(password)
  await pool.query(
    `INSERT INTO organizations (id,code,name)
     VALUES ($1,'p46-browser','P46 Browser Sentetik'),($2,'p46-foreign','P46 Yabancı')`,
    [organizationId, foreignOrganizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$3,'p46-browser@test.local','P46 Yetkili',$5,'active'),
            ($2,$4,'p46-foreign@test.local','P46 Yabancı',$5,'active')`,
    [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
  )
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id)
     SELECT $1::uuid,id FROM roles WHERE code='admin'
     UNION ALL SELECT $2::uuid,id FROM roles WHERE code='admin'`,
    [userId, foreignUserId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,loss_date,notification_date,
        created_at,updated_at,version)
     VALUES
     ($1,$4,2026,4601,'2026/4601','traffic','open','reporting','34 SZ 4601','34SZ4601',$5,'2026-07-10','2026-07-11','2026-07-11T09:00:00Z','2026-07-18T12:00:00Z',1),
     ($2,$4,2026,4602,'2026/4602','traffic','open','reporting','34 SZ 4602','34SZ4602',$5,'2026-07-10','2026-07-11','2026-07-11T09:00:00Z','2026-07-18T12:00:00Z',1),
     ($3,$6,2026,4603,'2026/4603','traffic','open','reporting','35 SZ 4603','35SZ4603',$7,'2026-07-10','2026-07-11','2026-07-11T09:00:00Z','2026-07-18T12:00:00Z',1)`,
    [historyCaseId, targetCaseId, foreignCaseId, organizationId, userId, foreignOrganizationId, foreignUserId],
  )

  // Sözlük yalnız kullanıcı onaylı föylerden türetilir: geçmiş dosyaya onaylı föy,
  // yabancı organization'a ayrı föy yazılır (tenant sınırı kanıtı).
  const seedSheet = async (sheetCaseId, ownerId, orgId, description, action, part, labor) => {
    const sheetId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      'INSERT INTO labor_sheets (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [sheetId, orgId, sheetCaseId, ownerId],
    )
    await pool.query(
      `INSERT INTO labor_sheet_versions
         (id,organization_id,case_id,sheet_id,sheet_version,source_type,currency,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'user_entered','TRY',$5)`,
      [versionId, orgId, sheetCaseId, sheetId, ownerId],
    )
    await pool.query(
      `INSERT INTO labor_sheet_items
         (id,organization_id,case_id,sheet_id,sheet_version_id,ordinal,description,action,
          part_amount_minor,labor_amount_minor)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)`,
      [uuidv7(), orgId, sheetCaseId, sheetId, versionId, description, action, part, labor],
    )
    await pool.query('UPDATE labor_sheets SET current_version_id=$2 WHERE id=$1', [sheetId, versionId])
  }
  await seedSheet(historyCaseId, userId, organizationId, 'Ön tampon kaplama', 'Değişim', 1_840_000, 220_000)
  await seedSheet(foreignCaseId, foreignUserId, foreignOrganizationId, 'Yabancı kalem', 'Değişim', 100_000, 50_000)

  return { organizationId, targetCaseId, email: 'p46-browser@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-18T12:30:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4186, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9346',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p46-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9346/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9346/json/new?${encodeURIComponent('http://127.0.0.1:4186/')}`,
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
  await evaluate(`location.href=${JSON.stringify(`http://127.0.0.1:4186/dosyalar/${seeded.targetCaseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 SZ 4602')")
  await clickExact('İşçilik')
  await waitFor("document.body.textContent.includes('İşçilik Föyü Oluştur')")
  await clickExact('İşçilik Föyü Oluştur')

  // Sözlük önceki onaylı föyden türetilir ve datalist olarak sunulur.
  await waitFor("document.body.textContent.includes('kalem önerisi')")
  const options = await evaluate(`(() => {
    const list=document.getElementById('labor-dictionary-descriptions');
    return list===null ? [] : [...list.options].map((option)=>option.value);
  })()`)
  if (!Array.isArray(options) || !options.includes('Ön tampon kaplama')) {
    throw new Error('LABOR_DICTIONARY_MISSING')
  }
  if (options.includes('Yabancı kalem')) throw new Error('LABOR_DICTIONARY_TENANT_LEAK')

  // Seçim boş alanları doldurur; hiçbir şey otomatik kaydedilmez.
  await fillAria('Kalem 1', 'Ön tampon kaplama')
  await waitFor(`(() => {
    const action=document.querySelector('[aria-label="İşlem 1"]')?.value;
    const part=document.querySelector('[aria-label="Parça tutarı 1"]')?.value;
    const labor=document.querySelector('[aria-label="İşçilik tutarı 1"]')?.value;
    return action==='Değişim' && part==='18400' && labor==='2200';
  })()`)
  const beforeSave = await pool.query(
    'SELECT count(*)::int AS n FROM labor_sheets WHERE case_id=$1',
    [seeded.targetCaseId],
  )
  if (beforeSave.rows[0]?.n !== 0) throw new Error('LABOR_DICTIONARY_AUTO_SAVED')

  // Kullanıcının yazdığı değer önerilerle ezilmez.
  await clickExact('Satır ekle')
  await fillAria('İşlem 2', 'Onarım')
  await fillAria('Kalem 2', 'Ön tampon kaplama')
  if (await readAria('İşlem 2') !== 'Onarım') throw new Error('LABOR_DICTIONARY_OVERWROTE_USER_INPUT')
  await fillAria('İşçilik tutarı 2', '900')

  await checkLabel('sürümlü olarak kaydedilmesini onaylıyorum')
  await clickExact('Föyü Kaydet')
  await waitFor("document.body.textContent.includes('Sürüm 1') && document.body.textContent.includes('Ön tampon kaplama')")
  await assertNoHorizontalOverflow('LABOR_DICTIONARY_1366_LIGHT')

  // Salt okunur sözlük audit yazmaz.
  const audits = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'labor_dictionary%'",
  )
  if (audits.rows[0]?.n !== 0) throw new Error('LABOR_DICTIONARY_WROTE_AUDIT')

  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('LABOR_DICTIONARY_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('LABOR_DICTIONARY_1920_DARK')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.endsWith('/labor-sheet')
    || url.includes('/labor-dictionary')
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

  await app.close()
  apiOpen = false
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor("document.body.textContent.includes('Giriş Yap')", 15_000)
  const afterShutdown = await evaluate('document.body.textContent')
  if (afterShutdown.includes('Ön tampon kaplama') || afterShutdown.includes('kalem önerisi')) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      dictionaryDerivedFromApprovedSheets: true,
      tenantIsolation: true,
      suggestionFillsEmptyFieldsOnly: true,
      userInputNotOverwritten: true,
      noAutoSave: true,
      readOnlyNoAudit: true,
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
