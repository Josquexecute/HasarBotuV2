import { existsSync, writeFileSync } from 'node:fs'
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
  fixedClock,
  hashPassword,
} from '../services/api/dist/index.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL_REQUIRED')
const databaseConfig = assertTestDatabaseUrl(DATABASE_URL)
const repoRoot = resolve(import.meta.dirname, '..')
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
const chromeExecutable = chromeCandidates.find(existsSync)
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
        return
      }
      this.events.push(message)
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

async function retry(fn, timeoutMs = 10_000) {
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

async function waitFor(expression, timeoutMs = 10_000) {
  return retry(async () => {
    const value = await evaluate(expression)
    if (!value) throw new Error('browser_condition_pending')
    return value
  }, timeoutMs)
}

async function clickButton(text) {
  const encoded = JSON.stringify(text)
  await waitFor(`(() => {
    const item=[...document.querySelectorAll('button,a')].find((node)=>
      node.textContent?.trim()===${encoded} || node.getAttribute('aria-label')===${encoded});
    if(!item || item.disabled) return false;
    item.click();
    return true;
  })()`)
}

async function fillLabel(label, value) {
  const encodedLabel = JSON.stringify(label)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>node.querySelector(':scope > span')?.textContent?.trim()===${encodedLabel});
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

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function assertNoHorizontalOverflow(label) {
  const result = await evaluate(`({
    width: window.innerWidth,
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    operations: document.querySelector('.case-operations')?.scrollWidth ?? 0
  })`)
  if (result.body > result.width + 1 || result.root > result.width + 1) {
    throw new Error(`HORIZONTAL_OVERFLOW_${label}`)
  }
}

async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  const path = join(tmpdir(), `hasarbotu-${name}.png`)
  writeFileSync(path, Buffer.from(result.data, 'base64'))
  return path
}

async function seed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
  const organizationId = uuidv7()
  const managerUserId = uuidv7()
  const assigneeUserId = uuidv7()
  const caseId = uuidv7()
  const password = 'p37-browser-sentetik-parola-42'
  const passwordHash = await hashPassword(password)
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p37-browser','P37 Browser Sentetik')",
    [organizationId],
  )
  await pool.query(
     `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$3,'p37-browser@test.local','P37 Dosya Sorumlusu',$4,'active'),
            ($2,$3,'p37-browser-assignee@test.local','P37 Görevli',$4,'active')`,
    [managerUserId, assigneeUserId, organizationId, passwordHash],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='case_manager'",
    [managerUserId],
  )
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date)
     VALUES ($1,$2,2026,3701,'2026/3701','traffic','open','inspection_pending',
             '34 P 3701','34P3701',$3,'2026-07-18','2026-07-16')`,
    [caseId, organizationId, managerUserId],
  )
  await pool.query(
    `INSERT INTO case_follow_up_history
     (id,organization_id,case_id,previous_follow_up_date,new_follow_up_date,source,case_version,actor_user_id)
     VALUES ($1,$2,$3,NULL,'2026-07-18','case_create',1,$4)`,
    [uuidv7(), organizationId, caseId, managerUserId],
  )
  return { organizationId, caseId, email: 'p37-browser@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-16T10:30:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true
  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4177, strictPort: true },
  })
  await vite.listen()

  const profile = join(tmpdir(), `hasarbotu-p37-chrome-${process.pid}`)
  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9337',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9337/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9337/json/new?${encodeURIComponent('http://127.0.0.1:4177/')}`,
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
  await waitFor("document.querySelector('button')?.textContent?.includes('Giriş Yap')")
  await fillLabel('E-posta', seeded.email)
  await fillLabel('Parola', seeded.password)
  await clickButton('Giriş Yap')
  await waitFor("document.body.textContent.includes('Operasyon Durumu')", 15_000)
  await waitFor("document.querySelectorAll('.workflow-card').length===1")
  await evaluate("document.querySelector('.workflow-card').click(); true")
  await waitFor("document.body.textContent.includes('Dosya Özeti')")
  await clickButton('Operasyon')
  await waitFor("document.body.textContent.includes('Notlar ve Görüşmeler')")

  await fillLabel('Konu', 'Sentetik servis görüşmesi')
  await fillLabel('Not', 'Gerçek tarayıcıyla oluşturulan sentetik operasyon notu.')
  await clickButton('Notu Ekle')
  await waitFor("document.body.textContent.includes('Gerçek tarayıcıyla oluşturulan sentetik operasyon notu.')")

  await fillLabel('Görev', 'Tamamlanacak sentetik görev')
  await fillLabel('Son tarih', '2026-07-16')
  await clickButton('Görev Oluştur')
  await waitFor("document.body.textContent.includes('Tamamlanacak sentetik görev')")
  await clickButton('Tamamla')
  await fillLabel('Görev sonucu', 'Sentetik görev gerçek tarayıcıda tamamlandı.')
  await clickButton('Onayla')
  await waitFor("document.body.textContent.includes('Sentetik görev gerçek tarayıcıda tamamlandı.')")

  await fillLabel('Görev', 'Geciken sentetik görev')
  await fillLabel('Son tarih', '2026-07-15')
  await clickButton('Görev Oluştur')
  await waitFor("document.body.textContent.includes('Geciken sentetik görev')")
  await fillLabel('Yeni takip tarihi', '2026-07-22')
  await clickButton('Takibi Kaydet')
  await waitFor("document.body.textContent.includes('22 Tem 2026')")

  await assertNoHorizontalOverflow('1366_LIGHT')
  const light1366 = await screenshot('p37-1366-light')
  await clickButton('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('1366_DARK')
  const dark1366 = await screenshot('p37-1366-dark')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('1920_DARK')
  const dark1920 = await screenshot('p37-1920-dark')

  await evaluate("document.querySelector('a[href=\"/\"]').click(); true")
  await waitFor("document.body.textContent.includes('Operasyon Durumu')")
  await waitFor("document.body.textContent.includes('Geciken görev')")
  const dashboardText = await evaluate("document.body.textContent")
  if (!dashboardText.includes('1 açık görev')) throw new Error('DASHBOARD_TASK_COUNT_MISSING')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico') ||
    url.endsWith('/api/v1/auth/session') ||
    url.includes('/workspace-plans')
  const browserProblems = cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Runtime.consoleAPICalled') {
      return ['error', 'warning'].includes(event.params?.type)
    }
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
  await clickButton('Yenile')
  await waitFor("document.body.textContent.includes('Durum panosu alınamadı')", 15_000)
  const fallbackState = await evaluate("({cards:document.querySelectorAll('.workflow-card').length,text:document.body.textContent})")
  if (fallbackState.cards !== 0 || fallbackState.text.includes('12 açık')) throw new Error('API_MOCK_FALLBACK_DETECTED')

  const counts = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM case_notes WHERE organization_id=$1 AND case_id=$2) AS notes,
      (SELECT count(*)::int FROM case_tasks WHERE organization_id=$1 AND case_id=$2) AS tasks,
      (SELECT count(*)::int FROM case_tasks WHERE organization_id=$1 AND case_id=$2 AND status='completed') AS completed,
      (SELECT count(*)::int FROM case_tasks WHERE organization_id=$1 AND case_id=$2 AND status='open') AS open_tasks,
      (SELECT count(*)::int FROM case_follow_up_history WHERE organization_id=$1 AND case_id=$2) AS follow_history`,
    [seeded.organizationId, seeded.caseId],
  )
  const auditLeak = await pool.query(
    `SELECT count(*)::int AS count FROM audit_events
     WHERE organization_id=$1 AND details::text ~* 'Gerçek tarayıcı|Sentetik görev gerçek|Tamamlanacak sentetik'`,
    [seeded.organizationId],
  )
  const result = counts.rows[0]
  if (result.notes !== 1 || result.tasks !== 2 || result.completed !== 1 || result.open_tasks !== 1 || result.follow_history !== 2) {
    throw new Error('BROWSER_DB_RESULT_INVALID')
  }
  if (auditLeak.rows[0]?.count !== 0) throw new Error('BROWSER_AUDIT_CONTENT_LEAK')

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      noteCreate: true,
      taskCreateComplete: true,
      overdueTaskDashboard: true,
      followUpHistory: true,
      noFallback: true,
      consoleClean: true,
    },
    resolutions: ['1366x768-light', '1366x768-dark', '1920x1080-dark'],
    counts: result,
    screenshots: [light1366, dark1366, dark1920],
  }))
} finally {
  cdp?.close()
  if (apiOpen) await app?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  if (chrome !== undefined && !chrome.killed) chrome.kill()
  await closeDatabasePool(pool)
}
