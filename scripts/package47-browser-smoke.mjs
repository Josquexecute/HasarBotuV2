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
  const adminId = uuidv7()
  const expertId = uuidv7()
  const foreignUserId = uuidv7()
  const password = 'p47-browser-sentetik-parola-47'
  const passwordHash = await hashPassword(password)
  await pool.query(
    `INSERT INTO organizations (id,code,name)
     VALUES ($1,'p47-browser','P47 Browser Sentetik'),($2,'p47-foreign','P47 Yabancı')`,
    [organizationId, foreignOrganizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$4,'p47-admin@test.local','P47 Gerçek Yönetici',$6,'active'),
            ($2,$4,'p47-expert@test.local','P47 Gerçek Eksper',$6,'active'),
            ($3,$5,'p47-foreign@test.local','P47 Yabancı Kullanıcı',$6,'active')`,
    [adminId, expertId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
  )
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id)
     SELECT $1::uuid,id FROM roles WHERE code='admin'
     UNION ALL SELECT $2::uuid,id FROM roles WHERE code='expert'
     UNION ALL SELECT $3::uuid,id FROM roles WHERE code='admin'`,
    [adminId, expertId, foreignUserId],
  )
  await pool.query(
    `INSERT INTO service_centers (id,organization_id,name,center_type,service_type,is_active)
     VALUES ($1,$3,'P47 Gerçek Yetkili Servis','yetkili','authorized',true),
            ($2,$4,'P47 Yabancı Servis','ozel','private',true)`,
    [uuidv7(), uuidv7(), organizationId, foreignOrganizationId],
  )
  return { organizationId, email: 'p47-admin@test.local', password }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-18T13:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4187, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9347',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p47-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9347/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9347/json/new?${encodeURIComponent('http://127.0.0.1:4187/')}`,
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
  await evaluate(`location.href='http://127.0.0.1:4187/yonetim'; true`)
  await waitFor("document.body.textContent.includes('Kullanıcı ve Sorumlu Listesi')")

  // Gerçek kullanıcılar görünür, mock kullanıcı sızmaz, eksper rolü türetilir.
  await waitFor("document.body.textContent.includes('P47 Gerçek Yönetici') && document.body.textContent.includes('P47 Gerçek Eksper')")
  const usersText = await evaluate('document.body.textContent')
  if (/Ömer Faruk Kaya|Ahmet Yılmaz|Selin Aras|Zeynep Demir/.test(usersText)) {
    throw new Error('MANAGEMENT_MOCK_USER_LEAK')
  }
  if (usersText.includes('P47 Yabancı Kullanıcı')) throw new Error('MANAGEMENT_TENANT_LEAK')
  if (!usersText.includes('Eksper')) throw new Error('MANAGEMENT_EXPERT_ROLE_MISSING')

  // Servis listesi gerçek veriden gelir; uydurulmuş sütun yoktur.
  await clickExact('Servisler')
  await waitFor("document.body.textContent.includes('P47 Gerçek Yetkili Servis')")
  const servicesText = await evaluate('document.body.textContent')
  if (/Akşam Otomotiv|Ege Hasar Merkezi|Başkent Oto|Marmara Motorlu/.test(servicesText)) {
    throw new Error('MANAGEMENT_MOCK_SERVICE_LEAK')
  }
  if (servicesText.includes('P47 Yabancı Servis')) throw new Error('MANAGEMENT_SERVICE_TENANT_LEAK')
  if (/Telefon|Açık Dosya/.test(servicesText)) throw new Error('MANAGEMENT_INVENTED_COLUMN')

  await assertNoHorizontalOverflow('MANAGEMENT_1366_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('MANAGEMENT_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('MANAGEMENT_1920_DARK')

  // Salt okunur referans görünümü audit yazmaz. Oturum açma auditleri (auth.*)
  // Paket 06'dan beri beklenen davranıştır ve bu kontrolün dışındadır.
  const audits = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'",
  )
  if (audits.rows[0]?.n !== 0) {
    const actions = await pool.query(
      "SELECT DISTINCT action FROM audit_events WHERE action NOT LIKE 'auth.%'",
    )
    console.error(JSON.stringify(actions.rows))
    throw new Error('MANAGEMENT_WROTE_AUDIT')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/references/')
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
  if (/Ömer Faruk Kaya|Akşam Otomotiv|P47 Gerçek Yetkili Servis/.test(afterShutdown)) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      realUsersInApiMode: true,
      noMockUserLeak: true,
      expertRoleDerived: true,
      realServicesInApiMode: true,
      noMockServiceLeak: true,
      tenantIsolation: true,
      noInventedColumns: true,
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
