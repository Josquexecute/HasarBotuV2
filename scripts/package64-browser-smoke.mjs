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
 * Paket 64 tarayıcı smoke'u: işçilik dağıtım KATEGORİSİ (branş) zinciri.
 *
 * Kanıtlanan sıra:
 *   AI kategori dağılımı ekranda görünür → kontrol gerektiren satır otomatik
 *   seçili DEĞİLDİR → kullanıcı satırı seçer → iki kategori tutarını değiştirir
 *   → geçersiz toplamda uygulama kilitlenir ve fark OTOMATİK DAĞITILMAZ →
 *   toplam düzeltilince onay modalı açılır → onaydan önce föy/uygulama sayısı
 *   değişmez → uygulama tamamlanır → category_modified=true → provenance oluşur
 *   → projeksiyon uygulanan tutarları doğru sütuna koyar → provenance'ı olmayan
 *   satırda hücre üretilmez → bayat önizleme yazılabilir sayılmaz → hiçbir
 *   fiziksel .xlsx yazılmaz.
 *
 * DİKKAT (P62 dersi): teşhis kodu ürünün işini KENDİSİ yapmaz. Föy ve analiz
 * kurulumu hazırlıktır; test edilen eylemleri (seçim, düzenleme, onay) her
 * zaman UI yapar.
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

const PLATE = '34 KT 6400'
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

/** aria-label ile eşleşen alanı doldurur; kategori girişleri böyle etiketli. */
async function fillAria(ariaLabel, value) {
  const encodedLabel = JSON.stringify(ariaLabel)
  const encodedValue = JSON.stringify(value)
  await waitFor(`(() => {
    const input=[...document.querySelectorAll('input')].find((node)=>
      (node.getAttribute('aria-label')??'').startsWith(${encodedLabel}));
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
  const insurerId = uuidv7()
  const password = 'p64-browser-sentetik-parola-64'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p64-browser','P64 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p64-browser@test.local','P64 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    "INSERT INTO insurers (id,organization_id,name) VALUES ($1,$2,'Sentetik Sigorta')",
    [insurerId, organizationId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version,insurer_id)
     VALUES ($1,$2,2026,6400,'2026/6400','traffic','open','reporting',$4,'34KT6400',$3,'2026-07-01',1,$5)`,
    [caseId, organizationId, userId, PLATE, insurerId],
  )
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor)
     VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],10000000,10000000)`,
    [uuidv7(), organizationId],
  )
  return {
    organizationId, userId, caseId, insurerId,
    email: 'p64-browser@test.local', password,
  }
}

try {
  const seeded = await seed()
  app = buildApp({
    clock: fixedClock('2026-07-20T11:00:00.000Z'),
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
    server: { host: '127.0.0.1', port: 4199, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9364',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p64-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9364/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9364/json/new?${encodeURIComponent('http://127.0.0.1:4199/')}`,
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

  /*
   * Konsol kontrolü GİRİŞTEN SONRA başlar. Giriş öncesi favicon 404'ü ve
   * kimliksiz oturum yoklamasının 401'i uygulamanın normal açılışıdır;
   * bunları hata saymak smoke'u gürültüyle kör ederdi. Girişten sonraki
   * her konsol hatası ise gerçek bir kusurdur.
   */
  const consoleBaseline = cdp.events.length

  /*
   * HAZIRLIK (test edilen davranış değil): föy ve analiz kurulur. Kategori
   * inceleme, düzeltme ve uygulama adımlarını UI yapacak.
   */
  const prepared = await evaluate(`(async () => {
    const post = async (url, body) => {
      const response = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const sheet = await post('/api/v1/cases/${seeded.caseId}/labor-sheet', {
      expectedCaseVersion: 1, confirmed: true,
      items: [{ description: 'Ön tampon', action: 'Onarım', partAmountMinor: 0, laborAmountMinor: 1000000 }],
    });
    if (sheet.status !== 201) return { step: 'sheet', status: sheet.status };
    const started = await post('/api/v1/cases/${seeded.caseId}/labor-allocation-ai/analyze', {
      expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: false,
    });
    if (started.status !== 200) return { step: 'analyze', status: started.status };
    const runId = started.body.run.id;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await fetch(
        '/api/v1/cases/${seeded.caseId}/labor-allocation-ai/' + runId,
        { credentials: 'include' },
      ).then((response) => response.json());
      const status = current.run.status;
      if (!['queued', 'running', 'cancel_requested'].includes(status)) {
        if (status !== 'review_required') return { step: 'run', status };
        break;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    return { step: 'ok', status: 200 };
  })()`)
  if (prepared.step !== 'ok') {
    throw new Error(`PREPARATION_FAILED_${prepared.step}_${prepared.status}`)
  }

  // Kategori ekseninde eşleme taşıyan güncel profil (2.0.0).
  const profile = await evaluate(`(async () => {
    const response = await fetch('/api/v1/labor-excel-profiles', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: 'Kategori Şablonu', insurerId: ${JSON.stringify(seeded.insurerId)},
          targetSheet: 'İşçilik', identityChecks: { plate: true, officeNumber: false },
          columns: [
            { key: 'KAPORTA', label: 'Kaporta' },
            { key: 'BOYA', label: 'Boya' },
          ],
          mapping: {
            bodywork: 'KAPORTA', mechanical: null, electrical: null, upholstery_lock: null,
            glass: null, calibration: null, repair: 'KAPORTA', paint: 'BOYA',
          },
        },
        expectedVersion: null, reason: null, confirmed: true,
      }),
    });
    const body = await response.json();
    return { status: response.status, id: body?.profile?.id ?? null, writable: body?.profile?.writable ?? null };
  })()`)
  if (profile.status !== 201) throw new Error(`PROFILE_CREATE_FAILED_${profile.status}`)
  if (profile.writable !== true) throw new Error('CURRENT_SCHEMA_PROFILE_NOT_WRITABLE')

  const openLaborTab = async () => {
    await evaluate(`location.href='http://127.0.0.1:4199/dosyalar/${seeded.caseId}'; true`)
    await waitFor("document.body.textContent.includes('İşçilik')")
    await clickExact('İşçilik')
    await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  }

  await openLaborTab()
  await waitFor("document.body.textContent.includes('1. Ön tampon')")

  // ── ADIM 1: hiçbir satır otomatik seçili DEĞİLDİR.
  const preChecked = await evaluate(
    `[...document.querySelectorAll('.allocation-line input[type=checkbox]')].filter((box)=>box.checked).length`,
  )
  if (preChecked !== 0) throw new Error(`LINES_PRESELECTED_${preChecked}`)

  // Seçilmeden kategori paneli de görünmez.
  if (await evaluate(`document.querySelector('.allocation-category')!==null`)) {
    throw new Error('CATEGORY_PANEL_SHOWN_WITHOUT_SELECTION')
  }

  // ── ADIM 2: kullanıcı satırı seçer; sekiz kategori görünür.
  await waitFor(`(() => {
    const box=document.querySelector('.allocation-line input[type=checkbox]');
    if(!box) return false; box.click(); return true;
  })()`)
  await waitFor(`document.querySelector('.allocation-category')!==null`)

  const categoryInputs = await evaluate(
    `document.querySelectorAll('.allocation-category__field input').length`,
  )
  if (categoryInputs !== 8) throw new Error(`CATEGORY_FIELD_COUNT_${categoryInputs}`)

  const categoryText = await evaluate(`document.querySelector('.allocation-category')?.textContent ?? ''`)
  for (const label of ['Kaporta', 'Mekanik', 'Elektrik', 'Cam', 'Boya']) {
    if (!categoryText.includes(label)) throw new Error(`CATEGORY_LABEL_MISSING_${label}`)
  }
  // Baseline/geçmiş yoksa "yok" yazar; sıfır dağılım çizilmez.
  if (!categoryText.includes('yok')) throw new Error('MISSING_REFERENCE_NOT_LABELLED')

  await assertNoHorizontalOverflow('CATEGORY_PANEL_1920')

  // ── ADIM 3: iki kategori tutarı değiştirilir; toplam BOZULUR.
  await fillAria('Kaporta kategorisi satır 1', '4000.00')
  await fillAria('Boya kategorisi satır 1', '3000.00')
  await waitFor(`document.body.textContent.includes('Toplam eşleşmiyor')`)

  // Sistem farkı OTOMATİK DAĞITMAZ: girilen değerler olduğu gibi kalır.
  const afterInvalid = await evaluate(`(() => {
    const inputs=[...document.querySelectorAll('.allocation-category__field input')];
    return inputs.map((node)=>node.value);
  })()`)
  const invalidSum = afterInvalid.reduce((sum, value) => sum + Number(value), 0)
  if (Math.abs(invalidSum - 7000) > 0.001) throw new Error(`REMAINDER_AUTO_DISTRIBUTED_${invalidSum}`)

  await fillLabel('Sürüm gerekçesi', 'Kategori dağılımı düzeltildi')
  const blockedApply = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find((node)=>
      node.textContent?.trim()==='Seçilenleri Föye Uygula');
    return button === undefined ? 'missing' : button.disabled;
  })()`)
  if (blockedApply !== true) throw new Error(`APPLY_NOT_BLOCKED_ON_INVALID_TOTAL_${blockedApply}`)

  // ── ADIM 4: toplam düzeltilir; öneri ile uygulanan YAN YANA görünür.
  await fillAria('Kaporta kategorisi satır 1', '6000.00')
  await fillAria('Boya kategorisi satır 1', '4000.00')
  await waitFor(`!document.body.textContent.includes('Toplam eşleşmiyor')`)
  await waitFor(`document.body.textContent.includes('Kategori dağılımı kullanıcı tarafından değiştirildi')`)

  const sideBySide = await evaluate(
    `[...document.querySelectorAll('.allocation-category__field small')].map((node)=>node.textContent.trim())`,
  )
  if (!sideBySide.some((text) => text.startsWith('AI:'))) throw new Error('PROPOSED_NOT_SHOWN_BESIDE_APPLIED')

  // ── ADIM 5: onaydan ÖNCE föy ve uygulama sayısı değişmemiştir.
  const beforeConfirm = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM labor_sheet_versions WHERE case_id=$1) AS sheets,
       (SELECT count(*)::int FROM labor_allocation_applications
         WHERE case_id=$1 AND status='completed') AS applications`,
    [seeded.caseId],
  )

  await clickExact('Seçilenleri Föye Uygula')
  await waitFor("document.body.textContent.includes('AI Dağıtımını Föye Uygula')")

  const duringModal = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM labor_sheet_versions WHERE case_id=$1) AS sheets,
       (SELECT count(*)::int FROM labor_allocation_applications
         WHERE case_id=$1 AND status='completed') AS applications`,
    [seeded.caseId],
  )
  if (duringModal.rows[0].sheets !== beforeConfirm.rows[0].sheets
    || duringModal.rows[0].applications !== beforeConfirm.rows[0].applications) {
    throw new Error('STATE_CHANGED_BEFORE_CONFIRMATION')
  }

  // ── ADIM 6: onay verilir; provenance oluşur.
  await clickExact('Onaylıyorum, Uygula')
  await waitFor(`(() => !document.body.textContent.includes('AI Dağıtımını Föye Uygula'))()`)

  const provenance = await retry(async () => {
    const rows = await pool.query(
      `SELECT l.applied_category_amounts,l.proposed_category_amounts,l.category_modified,
              a.id::text AS application_id,a.target_sheet_version
         FROM labor_allocation_applied_lines l
         JOIN labor_allocation_applications a
           ON a.id=l.application_id AND a.organization_id=l.organization_id
        WHERE a.case_id=$1 AND a.status='completed'`,
      [seeded.caseId],
    )
    if (rows.rowCount === 0) throw new Error('application_pending')
    return rows.rows[0]
  })

  if (provenance.category_modified !== true) throw new Error('CATEGORY_MODIFIED_NOT_TRUE')
  if (provenance.applied_category_amounts.bodywork !== 600_000) {
    throw new Error(`APPLIED_BODYWORK_WRONG_${provenance.applied_category_amounts.bodywork}`)
  }
  if (provenance.applied_category_amounts.paint !== 400_000) {
    throw new Error(`APPLIED_PAINT_WRONG_${provenance.applied_category_amounts.paint}`)
  }
  // Modelin ilk değeri KAYBOLMAZ.
  if (provenance.proposed_category_amounts.bodywork !== 1_000_000) {
    throw new Error('PROPOSED_OVERWRITTEN')
  }

  // ── ADIM 7: projeksiyon UYGULANAN tutarları doğru sütuna koyar.
  const projection = await evaluate(`(async () => {
    const response = await fetch(
      '/api/v1/cases/${seeded.caseId}/labor-allocation-applications/'
        + ${JSON.stringify(provenance.application_id)}
        + '/excel-projection?profileId=' + ${JSON.stringify(profile.id)},
      { credentials: 'include' },
    );
    return { status: response.status, body: await response.json().catch(() => null) };
  })()`)
  if (projection.status !== 200) throw new Error(`PROJECTION_FAILED_${projection.status}`)
  const projectedLine = projection.body.lines[0]
  if (projectedLine.status !== 'projected') throw new Error(`PROJECTION_LINE_${projectedLine.status}`)
  if (projectedLine.cells.KAPORTA !== 600_000) {
    throw new Error(`PROJECTED_KAPORTA_${projectedLine.cells.KAPORTA}`)
  }
  if (projectedLine.cells.BOYA !== 400_000) {
    throw new Error(`PROJECTED_BOYA_${projectedLine.cells.BOYA}`)
  }
  // Salt okunur uç: yazma iddiası sözleşme seviyesinde imkânsızdır.
  if (projection.body.written !== false) throw new Error('PROJECTION_CLAIMED_WRITE')
  if (projection.body.writable !== true) throw new Error('FRESH_PROJECTION_NOT_WRITABLE')
  if (projection.body.stale !== false) throw new Error('FRESH_PROJECTION_MARKED_STALE')

  // ── ADIM 8: föy tekrar sürümlenince önizleme BAYAT olur ve yazılamaz.
  const revised = await evaluate(`(async () => {
    const response = await fetch('/api/v1/cases/${seeded.caseId}/labor-sheet/versions', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        expectedVersion: ${provenance.target_sheet_version}, confirmed: true,
        reason: 'Föy elle revize edildi',
        items: [{ description: 'Ön tampon', action: 'Onarım', partAmountMinor: 0, laborAmountMinor: 1100000 }],
      }),
    });
    return response.status;
  })()`)
  if (revised !== 200) throw new Error(`SHEET_REVISION_FAILED_${revised}`)

  const staleProjection = await evaluate(`(async () => {
    const response = await fetch(
      '/api/v1/cases/${seeded.caseId}/labor-allocation-applications/'
        + ${JSON.stringify(provenance.application_id)}
        + '/excel-projection?profileId=' + ${JSON.stringify(profile.id)},
      { credentials: 'include' },
    );
    return await response.json();
  })()`)
  if (staleProjection.stale !== true) throw new Error('STALE_NOT_DETECTED')
  if (staleProjection.writable !== false) throw new Error('STALE_PREVIEW_STILL_WRITABLE')

  // ── ADIM 9: hiçbir fiziksel .xlsx yazılmadı.
  const wroteFile = await pool.query(
    `SELECT count(*)::int AS n FROM audit_events
      WHERE details::text ILIKE '%.xlsx%' OR action ILIKE '%excel_write%'`,
  )
  if (wroteFile.rows[0].n !== 0) throw new Error('PHYSICAL_WRITE_TRACE_FOUND')

  // Ham açıklama ve kategori tutarları audit metadata'sına sızmamalı.
  const leak = await pool.query(
    `SELECT count(*)::int AS n FROM audit_events
      WHERE details::text LIKE '%Ön tampon%' OR details::text LIKE '%bodywork%'`,
  )
  if (leak.rows[0].n !== 0) throw new Error('AUDIT_LEAK_DETECTED')

  // 1366×768 ve koyu tema kontrolü.
  await setViewport(1366, 768)
  await openLaborTab()
  await assertNoHorizontalOverflow('LABOR_TAB_1366')
  await evaluate(`document.documentElement.dataset.theme='dark'; true`)
  await assertNoHorizontalOverflow('LABOR_TAB_1366_DARK')

  const consoleErrors = cdp.events
    .slice(consoleBaseline)
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    .map((event) => event.params.entry.text)
  if (consoleErrors.length > 0) {
    console.error(JSON.stringify({ consoleErrors }))
    throw new Error(`CONSOLE_ERRORS_${consoleErrors.length}`)
  }

  console.log(JSON.stringify({
    smoke: 'package64-category-allocation',
    checks: {
      noLinePreselected: true,
      categoryPanelHiddenUntilSelected: true,
      eightCategoryFieldsShown: true,
      missingReferenceLabelledAsAbsent: true,
      invalidTotalBlocksApply: true,
      remainderNotAutoDistributed: true,
      proposedShownBesideApplied: true,
      stateUnchangedBeforeConfirmation: true,
      categoryModifiedRecorded: true,
      proposedPreserved: true,
      appliedAmountsProjectedToCorrectColumns: true,
      freshProjectionWritable: true,
      staleProjectionNotWritable: true,
      noPhysicalWorkbookWrite: true,
      noAuditLeak: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1366x768-dark'],
  }))
} catch (error) {
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
