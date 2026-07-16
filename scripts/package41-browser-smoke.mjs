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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
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
  const rootId = uuidv7()
  const documentId = uuidv7()
  const documentVersionId = uuidv7()
  const password = 'p41-browser-sentetik-parola-42'

  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p41-browser','P41 Browser Sentetik')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p41-browser@test.local','P41 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO storage_roots (id,organization_id,root_key,label)
     VALUES ($1,$2,'synthetic-root','Sentetik Root')`,
    [rootId, organizationId],
  )
  await pool.query(
    `INSERT INTO cases
     (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
      workflow_stage,plate,plate_normalized,responsible_user_id,loss_date,notification_date,
      created_at,updated_at,version)
     VALUES ($1,$2,2026,4101,'2026/4101','traffic','open','reporting','34 P 4101','34P4101',
             $3,'2026-07-10','2026-07-11','2026-07-11T09:00:00Z',
             '2026-07-16T12:00:00Z',1)`,
    [caseId, organizationId, userId],
  )
  await pool.query(
    `INSERT INTO documents
     (id,organization_id,case_id,document_type,current_version_number,status)
     VALUES ($1,$2,$3,'preliminary_report',1,'ready')`,
    [documentId, organizationId, caseId],
  )
  await pool.query(
    `INSERT INTO document_versions
     (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
      extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
      status,hash_verified,size_verified,verified_at,registered_by_user_id)
     VALUES ($1,$2,$3,$4,1,'sentetik-on-rapor.pdf','Sentetik Ön Rapor.pdf','pdf',
             'application/pdf',256,$5,'synthetic-root',$6,'manual','ready',true,true,
             '2026-07-16T10:00:00Z',$7)`,
    [
      documentVersionId,
      organizationId,
      documentId,
      caseId,
      'a'.repeat(64),
      `sentetik/${caseId}/on-rapor.pdf`,
      userId,
    ],
  )
  await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, documentVersionId])

  return {
    organizationId,
    caseId,
    email: 'p41-browser@test.local',
    password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-16T12:00:00.000Z'),
    loggerEnabled: false,
    auth: {
      pool,
      cookieSecure: false,
      loginRateLimit: { limit: 100, windowMs: 60_000 },
    },
  })
  await app.listen({ host: '127.0.0.1', port: 3100 })
  apiOpen = true

  process.env.VITE_DATA_SOURCE = 'api'
  vite = await createViteServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4181, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=9341',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p41-chrome-${process.pid}`)}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9341/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9341/json/new?${encodeURIComponent('http://127.0.0.1:4181/')}`,
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

  await evaluate(`location.href=${JSON.stringify(`http://127.0.0.1:4181/dosyalar/${seeded.caseId}`)}; true`)
  await waitFor("document.body.textContent.includes('34 P 4101')")
  await clickExact('E-postalar')
  await waitFor("document.body.textContent.includes('E-posta Hazırla')")
  await fillLabel('E-posta türü', 'preliminary_report_notice')
  await clickExact('Taslağı Önizle')
  await waitFor("document.body.textContent.includes('Alıcı otomatik tahmin edilmedi')")
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>
      node.textContent?.includes('Sentetik Ön Rapor.pdf'));
    return label?.querySelector('input[type="checkbox"]')?.checked===true;
  })()`)
  const previewWriteCounts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM email_drafts) AS draft_count,
       (SELECT count(*)::int FROM audit_events WHERE action LIKE 'email_draft.%') AS audit_count`,
  )
  if (previewWriteCounts.rows[0]?.draft_count !== 0 || previewWriteCounts.rows[0]?.audit_count !== 0) {
    throw new Error('PREVIEW_WROTE_STATE')
  }

  await fillLabel('Alıcılar', 'hasar@example.test')
  await checkLabel('sürümlü taslak olarak kaydedilmesini')
  await clickExact('Taslağı Kaydet')
  await waitFor("document.body.textContent.includes('Gönderilmedi')")
  await assertNoHorizontalOverflow('EMAIL_1366_LIGHT')

  await clickExact('Yeni Sürüm Düzenle')
  await fillLabel('Konu', '2026/4101 · 34 P 4101 · Güncel Ön Rapor')
  await fillLabel('Düzeltme gerekçesi', 'Konu kullanıcı tarafından netleştirildi.')
  await checkLabel('Önceki sürüm korunarak')
  await clickExact('Yeni Sürümü Kaydet')
  await waitFor("document.body.textContent.includes('Taslak sürüm 2 oluşturuldu')")

  await evaluate(`window.__p41OpenedUrl=''; window.open=(url)=>{window.__p41OpenedUrl=String(url); return {};}; true`)
  await checkLabel('harici veri çıkışını onaylıyorum')
  await clickExact('Gmail Taslağını Aç')
  await waitFor("document.body.textContent.includes('gönderim uygulama tarafından doğrulanmadı')")
  const composeUrl = await evaluate('window.__p41OpenedUrl')
  if (
    typeof composeUrl !== 'string'
    || !composeUrl.startsWith('https://mail.google.com/mail/')
    || /[A-Z]:\\|\\\\|sentetik%2F|synthetic-root|password|secret/i.test(composeUrl)
  ) {
    throw new Error('GMAIL_COMPOSE_URL_UNSAFE')
  }

  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('EMAIL_1366_DARK')
  await setViewport(1920, 1080)
  await assertNoHorizontalOverflow('EMAIL_1920_DARK')

  const persisted = await pool.query(
    `SELECT
       draft.version,
       (SELECT count(*)::int FROM email_draft_versions WHERE draft_id=draft.id) AS version_count,
       (SELECT count(*)::int FROM email_handoffs WHERE draft_id=draft.id) AS handoff_count,
       (SELECT count(*)::int FROM email_draft_attachments WHERE draft_id=draft.id) AS attachment_count
     FROM email_drafts draft
     WHERE draft.organization_id=$1 AND draft.case_id=$2`,
    [seeded.organizationId, seeded.caseId],
  )
  if (
    persisted.rows[0]?.version !== 2
    || persisted.rows[0]?.version_count !== 2
    || persisted.rows[0]?.handoff_count !== 1
    || persisted.rows[0]?.attachment_count !== 2
  ) {
    throw new Error('EMAIL_DRAFT_PERSISTENCE_INVALID')
  }
  const auditRows = (await pool.query(
    `SELECT action,details FROM audit_events
     WHERE organization_id=$1 AND action LIKE 'email_draft.%'
     ORDER BY occurred_at,action`,
    [seeded.organizationId],
  )).rows
  if (auditRows.length !== 3) throw new Error('EMAIL_DRAFT_AUDIT_COUNT_INVALID')
  const auditText = JSON.stringify(auditRows)
  if (
    /hasar@example|Güncel Ön Rapor|Konu kullanıcı|mail\.google|sentetik|synthetic-root|[A-Z]:\\|password|secret|stack|SELECT |INSERT /i
      .test(auditText)
  ) {
    throw new Error('EMAIL_DRAFT_AUDIT_LEAK')
  }

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico')
    || url.endsWith('/api/v1/auth/session')
    || url.includes('/workspace-plans')
  const browserProblems = cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Runtime.consoleAPICalled') {
      return ['error', 'warning'].includes(event.params?.type)
    }
    if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)) {
      return event.params?.entry?.source !== 'network'
        || !expectedNetworkError(event.params?.entry?.url)
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
  if (afterShutdown.includes('Sentetik Ön Rapor.pdf') || afterShutdown.includes('Güncel Ön Rapor')) {
    throw new Error('API_SHUTDOWN_MOCK_FALLBACK')
  }

  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      login: true,
      previewReadOnly: true,
      verifiedAttachmentSuggestion: true,
      explicitSave: true,
      immutableRevision: true,
      explicitGmailEgress: true,
      deliveryNotSent: true,
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
