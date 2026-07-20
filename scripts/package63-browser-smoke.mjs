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
 * Paket 63 tarayıcı smoke'u: çoklu Excel profil seçimi.
 *
 * Kanıtlanan sıra:
 *   tek aktif profil önerilir (kesinleşmez) → ikinci profil eklenince öneri
 *   düşer ve seçim kullanıcıya kalır → pasifleştirilen profil aday olmaktan
 *   çıkar → başka şirketin profili hiç görünmez.
 *
 * Ayrıca: otomatik önerinin "şablon eşleşmesi" olarak sunulmaması ve
 * seçilmeden projeksiyon üretilmemesi.
 *
 * DİKKAT (P62 dersi): bu betikteki hiçbir teşhis kodu ürünün işini KENDİSİ
 * yapmaz. Teşhis yalnız okur; tıklamayı ve seçimi her zaman UI yapar.
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

const PLATE = '34 AL 6310'
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

/** Seçim panelindeki aday profil etiketleri; ekranda ne görünüyorsa o. */
async function candidateLabels() {
  return evaluate(`[...document.querySelectorAll('.profile-choice label span')]
    .map((node) => node.textContent.trim())`)
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
  const otherInsurerId = uuidv7()
  const password = 'p63-browser-sentetik-parola-63'
  await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p63-browser','P63 Browser')", [organizationId])
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p63-browser@test.local','P63 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(password)],
  )
  await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'", [userId])
  await pool.query(
    `INSERT INTO insurers (id,organization_id,name)
     VALUES ($1,$3,'Sentetik Sigorta A'),($2,$3,'Sentetik Sigorta B')`,
    [insurerId, otherInsurerId, organizationId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version,insurer_id)
     VALUES ($1,$2,2026,6310,'2026/6310','traffic','open','reporting',$4,'34AL6310',$3,'2026-07-01',1,$5)`,
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
    organizationId, userId, caseId, insurerId, otherInsurerId,
    email: 'p63-browser@test.local', password,
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
    server: { host: '127.0.0.1', port: 4198, strictPort: true },
  })
  await vite.listen()

  chrome = spawn(chromeExecutable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=9363',
    `--user-data-dir=${join(tmpdir(), `hasarbotu-p63-chrome-${process.pid}`)}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:9363/json/version')
    if (!response.ok) throw new Error('cdp_not_ready')
  })
  const target = await fetch(
    `http://127.0.0.1:9363/json/new?${encodeURIComponent('http://127.0.0.1:4198/')}`,
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

  // Föy + analiz + uygulama: projeksiyonun kaynağı TAMAMLANMIŞ provenance'tır.
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
    // Analiz P62'den beri asenkrondur; sonuç beklenir.
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
    const applied = await post(
      '/api/v1/cases/${seeded.caseId}/labor-allocation-ai/' + runId + '/apply',
      {
        expectedSheetVersion: 1, reason: 'Onaylandı', confirmed: true,
        lines: [{
          lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
          partAmountMinor: 0, laborAmountMinor: 1000000,
        }],
      },
    );
    if (applied.status !== 200) return { step: 'apply', status: applied.status };
    return { step: 'ok', status: 200 };
  })()`)
  if (prepared.step !== 'ok') {
    throw new Error(`PREPARATION_FAILED_${prepared.step}_${prepared.status}`)
  }

  // Profiller: A şirketi, B şirketi (yasak) ve genel.
  /*
   * P64: profil eşlemesi KATEGORİ (branş) eksenindedir. Operasyon türü
   * anahtarları artık geçersizdir ve sunucu 400 döner — bu doğrudur:
   * "iş neydi" ile "işi hangi branş yaptı" farklı sorulardır.
   */
  const CATEGORY_MAPPING = {
    bodywork: 'ISCILIK', mechanical: 'ISCILIK', electrical: null, upholstery_lock: null,
    glass: null, calibration: null, repair: 'ISCILIK', paint: 'PARCA',
  }

  const createProfile = async (name, insurerId, targetSheet, mapping = CATEGORY_MAPPING) => evaluate(`(async () => {
    const response = await fetch('/api/v1/labor-excel-profiles', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: ${JSON.stringify(name)},
          insurerId: ${insurerId === null ? 'null' : JSON.stringify(insurerId)},
          targetSheet: ${JSON.stringify(targetSheet)},
          identityChecks: { plate: true, officeNumber: false },
          columns: [
            { key: 'ISCILIK', label: 'İşçilik Bedeli' },
            { key: 'PARCA', label: 'Parça Bedeli' },
          ],
          mapping: ${JSON.stringify(mapping)},
        },
        expectedVersion: null, reason: null, confirmed: true,
      }),
    });
    const body = await response.json();
    return {
      status: response.status,
      id: body?.profile?.id ?? null,
      version: body?.profile?.version ?? null,
      schemaVersion: body?.profile?.schemaVersion ?? null,
      writable: body?.profile?.writable ?? null,
    };
  })()`)

  const profileA = await createProfile('A Sigorta Şablonu', seeded.insurerId, 'İşçilik')
  if (profileA.status !== 201) throw new Error(`PROFILE_A_FAILED_${profileA.status}`)
  // Kategori eksenli profil GÜNCEL şemadadır ve yazılabilir.
  if (profileA.schemaVersion !== 'labor-excel-profile/2.0.0') {
    throw new Error(`PROFILE_SCHEMA_VERSION_${profileA.schemaVersion}`)
  }
  if (profileA.writable !== true) throw new Error('CURRENT_SCHEMA_PROFILE_NOT_WRITABLE')

  // Operasyon türü anahtarları Excel sütununa DOĞRUDAN eşlenemez.
  const operationAxisProfile = await createProfile(
    'Operasyon Ekseni Şablonu', seeded.insurerId, 'İşçilik',
    {
      repair: 'ISCILIK', replace: 'PARCA', remove_install: null, paint: null,
      consumable: null, calibration: null, related_operation: null, other: null,
    },
  )
  if (operationAxisProfile.status !== 400) {
    throw new Error(`OPERATION_AXIS_MAPPING_ACCEPTED_${operationAxisProfile.status}`)
  }
  const profileB = await createProfile('B Sigorta Şablonu', seeded.otherInsurerId, 'Föy')
  if (profileB.status !== 201) throw new Error(`PROFILE_B_FAILED_${profileB.status}`)

  const openLaborTab = async () => {
    await evaluate(`location.href='http://127.0.0.1:4198/dosyalar/${seeded.caseId}'; true`)
    await waitFor("document.body.textContent.includes('İşçilik')")
    await clickExact('İşçilik')
    await waitFor("document.body.textContent.includes('AI İşçilik Dağıtımı')")
  }

  const openSelection = async () => {
    await waitFor(`(() => {
      const node=[...document.querySelectorAll('summary,details')].find((item)=>
        item.textContent?.includes('Uygulama geçmişi'));
      if(node && node.tagName==='DETAILS') node.open = true;
      else if(node) node.click();
      return true;
    })()`)
    await clickExact('Excel projeksiyonu')
    await waitFor(`document.querySelector('.profile-choice')!==null
      || document.body.textContent.includes('şablon profili yok')`)
  }

  // ── ADIM 1: tek aktif profil ÖNERİLİR ama kesinleşmez.
  await openLaborTab()
  await openSelection()

  const panelText = await evaluate(`document.querySelector('[aria-label="Excel şablon profili seçimi"]')?.textContent ?? ''`)
  if (!panelText.includes('profil önerisidir')) throw new Error('SUGGESTION_NOT_LABELLED_AS_PROFILE_ONLY')
  if (panelText.includes('şablon eşleşmesi doğrulandı')) throw new Error('TEMPLATE_MATCH_FALSELY_CLAIMED')

  const firstLabels = await candidateLabels()
  if (firstLabels.length !== 1) throw new Error(`CANDIDATE_COUNT_WRONG_${firstLabels.length}`)
  if (!firstLabels[0].includes('A Sigorta Şablonu')) throw new Error('WRONG_CANDIDATE_LISTED')
  if (!firstLabels[0].includes('Önerilen')) throw new Error('SUGGESTION_NOT_MARKED')
  // Başka şirketin profili HİÇ görünmez.
  if (firstLabels.some((label) => label.includes('B Sigorta'))) {
    throw new Error('FOREIGN_INSURER_PROFILE_VISIBLE')
  }

  // Öneri ön-seçilidir ama projeksiyon HENÜZ üretilmemiştir.
  const preSelected = await evaluate(`document.querySelector('.profile-choice input:checked')!==null`)
  if (!preSelected) throw new Error('SUGGESTION_NOT_PRESELECTED')
  if (await evaluate(`document.body.textContent.includes('Excel Projeksiyonu')`)) {
    throw new Error('PROJECTION_PRODUCED_WITHOUT_CONFIRMATION')
  }

  // Eşleşme önizlemesi profil bilgisini gösterir.
  const previewText = await evaluate(`document.querySelector('.profile-preview')?.textContent ?? ''`)
  if (!previewText.includes('İşçilik')) throw new Error('TARGET_SHEET_NOT_SHOWN')
  if (!previewText.includes('Plaka')) throw new Error('IDENTITY_CHECK_NOT_SHOWN')
  if (!previewText.includes('Eşlenmedi')) throw new Error('UNMAPPED_CATEGORIES_NOT_SHOWN')
  // Eşleme tablosu KATEGORİ eksenini gösterir; operasyon türü başlığı hatadır.
  if (!previewText.includes('İşçilik kategorisi')) throw new Error('MAPPING_AXIS_LABEL_WRONG')
  if (previewText.includes('Operasyon türü')) throw new Error('OPERATION_AXIS_LABEL_IN_MAPPING')
  for (const label of ['Kaporta', 'Mekanik', 'Boya', 'Cam']) {
    if (!previewText.includes(label)) throw new Error(`CATEGORY_LABEL_MISSING_${label}`)
  }

  // ── ADIM 2: kullanıcı onaylayınca projeksiyon üretilir.
  await clickExact('Bu Profille Önizle')
  await waitFor("document.body.textContent.includes('Excel Projeksiyonu')")
  const projectionText = await evaluate(`document.querySelector('[aria-label="Excel projeksiyonu"]')?.textContent ?? ''`)
  if (!projectionText.includes('YAZMAZ')) throw new Error('READ_ONLY_NOTICE_MISSING')

  // ── ADIM 3: ikinci profil eklenince öneri DÜŞER; seçim kullanıcıya kalır.
  const profileA2 = await createProfile('A Sigorta Şablonu 2', seeded.insurerId, 'İşçilik')
  if (profileA2.status !== 201) throw new Error(`PROFILE_A2_FAILED_${profileA2.status}`)
  await openLaborTab()
  await openSelection()

  const secondLabels = await candidateLabels()
  if (secondLabels.length !== 2) throw new Error(`SECOND_CANDIDATE_COUNT_${secondLabels.length}`)
  if (secondLabels.some((label) => label.includes('Önerilen'))) {
    throw new Error('SUGGESTION_SHOULD_HAVE_DROPPED')
  }
  if (await evaluate(`document.querySelector('.profile-choice input:checked')!==null`)) {
    throw new Error('NOTHING_SHOULD_BE_PRESELECTED')
  }
  const disabledPreview = await evaluate(`(() => {
    const node=[...document.querySelectorAll('button')].find((item)=>
      item.textContent?.trim()==='Bu Profille Önizle');
    return node ? node.disabled : null;
  })()`)
  if (disabledPreview !== true) throw new Error('PREVIEW_SHOULD_BE_DISABLED_WITHOUT_SELECTION')

  // ── ADIM 4: profil pasifleştirilince aday olmaktan çıkar.
  const deactivated = await evaluate(`(async () => {
    const response = await fetch('/api/v1/labor-excel-profiles/${profileA2.id}/status', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'inactive', expectedVersion: ${profileA2.version},
        reason: 'Şablon kullanımdan kalktı', confirmed: true,
      }),
    });
    return response.status;
  })()`)
  if (deactivated !== 200) throw new Error(`DEACTIVATION_FAILED_${deactivated}`)

  await openLaborTab()
  await openSelection()
  const thirdLabels = await candidateLabels()
  if (thirdLabels.length !== 1) throw new Error(`AFTER_DEACTIVATION_COUNT_${thirdLabels.length}`)
  if (thirdLabels[0].includes('Şablonu 2')) throw new Error('INACTIVE_PROFILE_STILL_CANDIDATE')
  // Tek aktif profil kaldığı için öneri geri gelir.
  if (!thirdLabels[0].includes('Önerilen')) throw new Error('SUGGESTION_NOT_RESTORED')

  // Pasif profil SİLİNMEDİ; kaydı hâlâ okunabilir.
  const stillStored = await pool.query(
    "SELECT status FROM labor_excel_profiles WHERE id=$1",
    [profileA2.id],
  )
  if (stillStored.rows[0]?.status !== 'inactive') throw new Error('INACTIVE_PROFILE_RECORD_LOST')

  // ── ADIM 5: sunucu sınırı istemciden bağımsızdır.
  const forced = await evaluate(`(async () => {
    const applications = await fetch(
      '/api/v1/cases/${seeded.caseId}/labor-allocation-applications',
      { credentials: 'include' },
    ).then((response) => response.json());
    const applicationId = applications.applications[0].id;
    const attempt = async (profileId) => (await fetch(
      '/api/v1/cases/${seeded.caseId}/labor-allocation-applications/' + applicationId
      + '/excel-projection?profileId=' + profileId,
      { credentials: 'include' },
    )).status;
    return {
      foreignInsurer: await attempt('${profileB.id}'),
      inactive: await attempt('${profileA2.id}'),
      valid: await attempt('${profileA.id}'),
    };
  })()`)
  if (forced.foreignInsurer !== 409) throw new Error(`FOREIGN_INSURER_NOT_BLOCKED_${forced.foreignInsurer}`)
  if (forced.inactive !== 409) throw new Error(`INACTIVE_NOT_BLOCKED_${forced.inactive}`)
  if (forced.valid !== 200) throw new Error(`VALID_PROFILE_BLOCKED_${forced.valid}`)

  // Plaka audit kayıtlarına sızmaz.
  const leak = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
    [PLATE],
  )
  if (leak.rows[0].n !== 0) throw new Error('PII_LEAKED_TO_AUDIT')

  await assertNoHorizontalOverflow('SELECTION_1920_LIGHT')
  await clickExact('Koyu temaya geç')
  await waitFor("document.querySelector('.theme-root')?.dataset.theme==='dark'")
  await assertNoHorizontalOverflow('SELECTION_1920_DARK')
  await setViewport(1366, 768)
  await assertNoHorizontalOverflow('SELECTION_1366_DARK')

  const expectedNetworkError = (url = '') =>
    url.endsWith('/favicon.ico') || url.endsWith('/api/v1/auth/session')
    || url.includes('/labor-allocation') || url.includes('/labor')
    || url.includes('/labor-excel') || url.includes('/excel-projection')
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
      singleActiveProfileSuggested: true,
      suggestionLabelledAsProfileOnlyNotTemplateMatch: true,
      foreignInsurerProfileNeverListed: true,
      noProjectionWithoutExplicitConfirmation: true,
      matchPreviewShowsSheetIdentityAndUnmapped: true,
      secondProfileDropsSuggestion: true,
      previewDisabledWithoutSelection: true,
      deactivatedProfileLeavesCandidates: true,
      suggestionRestoredWhenSingleAgain: true,
      inactiveProfileRecordStillReadable: true,
      serverBlocksForeignInsurerProfile: true,
      serverBlocksInactiveProfile: true,
      noPiiInAudit: true,
      consoleClean: true,
    },
    resolutions: ['1920x1080-light', '1920x1080-dark', '1366x768-dark'],
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
