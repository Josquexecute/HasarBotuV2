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
  const userId = uuidv7()
  const caseId = uuidv7()
  const password = 'p45-browser-sentetik-parola-45'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p45-browser','P45 Browser Sentetik')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p45-browser@test.local','P45 Eksper',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [userId])
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,loss_date,notification_date,
        created_at,updated_at,version)
     VALUES ($1,$2,2026,4501,'2026/4501','casco','open','damage_assessment','34 PT 4501','34PT4501',
             $3,'2026-07-10','2026-07-11','2026-07-11T09:00:00Z','2026-07-18T12:00:00Z',1)`,
    [caseId, organizationId, userId],
  )
  return { organizationId, caseId, email: 'p45-browser@test.local', password }
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
    server: { host: '127.0.0.1', port: 4185, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9345',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p45-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9345/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9345/json/new?${encodeURIComponent('http://127.0.0.1:4185/')}`,
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
  await evaluate(`location.href=${JSON.stringify(`http://127.0.0.1:4185/dosyalar/${seeded.caseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 PT 4501')")
  await clickExact('Ağır Hasar')
  await waitFor("document.body.textContent.includes('PERT Değerlendirmesi Oluştur')")

  // Oluşturma: ekonomik veriler + türetilmiş oran + açık onay.
  await clickExact('PERT Değerlendirmesi Oluştur')
  await fillLabel('Süreç durumu', 'under_review')
  await fillLabel('Tahmini hasar (₺)', '480000')
  await fillLabel('Rayiç değer (₺)', '625000')
  await fillLabel('Yapısal değerlendirme notu', 'Ön panel ölçümü bekleniyor.')
  await waitFor("document.body.textContent.includes('%77')")
  await checkLabel('sürümlü olarak kaydedilmesini onaylıyorum')
  await clickExact('Değerlendirmeyi Kaydet')
  await waitFor("document.body.textContent.includes('PERT değerlendirmesi kullanıcı onayıyla kaydedildi.')")
  await waitFor("document.body.textContent.includes('Merkez / sigorta kararı')")
  await retry(async () => {
    const created = await pool.query(
      `SELECT workflow_status,expert_opinion,center_decision
         FROM pert_assessment_versions WHERE case_id=$1 AND assessment_version=1`,
      [seeded.caseId],
    )
    if (
      created.rows[0]?.workflow_status !== 'under_review'
      || created.rows[0]?.expert_opinion !== null
      || created.rows[0]?.center_decision !== null
    ) {
      throw new Error('PERT_CREATE_INVALID')
    }
  })

  // Kanaat ayrı sürümle verilir; merkez kararı hâlâ ayrıdır.
  await clickExact('Değerlendirmeyi Düzenle')
  await fillLabel('Süreç durumu', 'center_decision_pending')
  await fillLabel('Eksper kanaati', 'pert')
  await fillLabel('Kanaat gerekçesi', 'Hasar/rayiç oranı yüksek; yapısal hasar mevcut.')
  await fillLabel('Sürüm gerekçesi', 'Eksper kanaati verildi')
  await checkLabel('sürümlü olarak kaydedilmesini onaylıyorum')
  await clickExact('Yeni Sürümü Kaydet')
  await waitFor("document.body.textContent.includes('PERT değerlendirmesinin yeni sürümü kaydedildi.')")
  await retry(async () => {
    const revised = await pool.query(
      `SELECT a.version,v.expert_opinion,v.center_decision
         FROM pert_assessments a
         JOIN pert_assessment_versions v ON v.id=a.current_version_id
        WHERE a.case_id=$1`,
      [seeded.caseId],
    )
    if (
      revised.rows[0]?.version !== 2
      || revised.rows[0]?.expert_opinion !== 'pert'
      || revised.rows[0]?.center_decision !== null
    ) {
      throw new Error('PERT_OPINION_INVALID')
    }
  })

  await assertNoHorizontalOverflow('PERT_1366_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('PERT_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('PERT_1920_DARK')

  // Audit yalnız güvenli kod/oran metadata taşır.
  const audits = (await pool.query(
    `SELECT action,details FROM audit_events
      WHERE organization_id=$1 AND action LIKE 'pert_assessment.%' ORDER BY occurred_at`,
    [seeded.organizationId],
  )).rows
  const auditText = JSON.stringify(audits)
  if (audits.length !== 2 || /Ön panel|ölçümü bekleniyor|yapısal hasar mevcut|[A-Z]:\\|\\\\|password|secret|SELECT |INSERT /i.test(auditText)) {
    throw new Error('PERT_AUDIT_LEAK')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.endsWith('/pert-assessment')
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
  if (afterShutdown.includes('Merkez Kararı Bekleniyor') || afterShutdown.includes('%77')) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      emptyAssessmentState: true,
      userControlledCreate: true,
      derivedRatioNoThreshold: true,
      separateExpertOpinion: true,
      separateCenterDecision: true,
      immutableRevision: true,
      auditSafe: true,
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
