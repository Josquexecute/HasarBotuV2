import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { _electron } from '@playwright/test'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../services/api/dist/index.js'
import { measureValueLossElectronTyping } from './value-loss-electron-performance.mjs'
import { verifyNoticeSheetDelivery } from './verify-notice-sheet-delivery.mjs'
import { downloadElectronFixture } from './electron-fixture-download.mjs'

const evidenceRoot = resolve(process.env.VALUE_LOSS_EVIDENCE ?? '.local/value-loss-calculator-electron')
await mkdir(evidenceRoot, { recursive: true })
const output = await mkdtemp(evidenceRoot + '/run-')
const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const pool = new pg.Pool({ connectionString: config.url })
const checks = []
const check = (name, pass) => { assert.ok(pass, name); checks.push(name); console.log(JSON.stringify({ check: checks.length, name })) }
let api, electron
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  const org = uuidv7(), user = uuidv7()
  const email = 'calculator@example.test', password = 'Synthetic-Calculator-2026!'
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'calculator-electron','Synthetic calculator office')", [org])
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Test Eksper',$4)", [user, org, email, await hashPassword(password)])
  await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [user])
  await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'calculator-source','Synthetic source root')", [uuidv7(), org])
  api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  const apiOrigin = await api.listen({ host: '127.0.0.1', port: 0 })
  const profile = await mkdtemp(output + '/profile-')
  electron = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [resolve('apps/desktop/test/harness/value-loss-calculator-main.mjs'), '--user-data-dir=' + profile], env: { ...process.env, HB_CALCULATOR_API: apiOrigin, HB_CALCULATOR_ASSETS: resolve('dist') } })
  const page = await electron.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByLabel('E-posta', { exact: true }).fill(email)
  await page.getByLabel('Parola', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
  await page.locator('.app-shell').waitFor()
  const origin = new URL(page.url()).origin
  const post = (path, data, headers = {}) => page.evaluate(async ({ path, data, headers }) => {
    const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) })
    return { status: response.status, body: await response.json() }
  }, { path, data, headers })
  const sourceText = 'Talep İşlem Ref No: calculator-automatic\nÜrün: Trafik\nPlaka: 034 - TST5050\nHasar Tarihi: 01.10.2026\nSigorta Şirketi: Sentetik Sigorta\nEksper Ad-Soyad: Test Eksper\nEksper Atama Tarihi: 02.10.2026 12:00\nMarka: FORD\nAraç Tipi: FOCUS SEDAN\nModel Yılı: 2021\nAraç Tarife Grubu: OTOMOBİL\nKilometre: 51.001\nÖnceki Hasar Sayısı: 2\nKullanım Amacı: Hususi\nMotor No: SYNTHETIC-ENGINE\nŞasi No: SYNTHETIC-CHASSIS'
  const sourceResponse = await post('/api/v1/eksist/sources', { kind: 'text', text: sourceText })
  assert.equal(sourceResponse.status, 201)
  const imported = sourceResponse.body
  const createdResponse = await post('/api/v1/cases/quick-create', { case: { caseType: 'traffic', plate: '34 TST 5050', lossDate: '2026-10-01', notificationDate: '2026-10-02' }, storageRootKey: 'calculator-source', source: { id: imported.id, reference: 'calculator-automatic' } }, { 'idempotency-key': uuidv7() })
  assert.equal(createdResponse.status, 202)
  const created = createdResponse.body, caseId = created.case.id
  await page.goto(origin + '/dosyalar/' + caseId)
  await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
  await page.getByRole('heading', { name: 'Değer Kaybı Hesapla', exact: true }).waitFor()
  check('source extraction reaches the actual calculator without manual vehicle entry', await page.getByLabel('Model yılı').inputValue() === '2021' && await page.getByLabel('Kilometre').inputValue() === '51001' && await page.getByLabel('Önceki hasar sayısı').inputValue() === '2' && (await page.getByLabel('Dosyadan alınan araç bilgileri').textContent()).includes('FORD · FOCUS SEDAN · Sedan'))
  check('imported identity is concise and body classification is editable', await page.getByLabel('Marka', { exact: true }).count() === 0 && await page.getByLabel('Kasa / araç yapısı').inputValue() === 'sedan')
  // This source has no repair assessment; only the missing amount is entered.
  const details = page.locator('.value-loss-calculator details').first()
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  await page.getByLabel('Hasar tutarı (TL)', { exact: true }).fill('100.000')
  await page.getByLabel('Rayiç bedeli (TL)', { exact: true }).fill('1.000.000')
  await page.getByLabel('Araç durumu', { exact: true }).selectOption('normal')
  const partInput = page.getByRole('combobox', { name: 'Hasarlı parça', exact: true })
  await partInput.click()
  const part = await page.getByRole('listbox', { name: 'Hasarlı parça' }).getByRole('option').first().textContent()
  await page.getByRole('option', { name: part, exact: true }).click()
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  const requests = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/traffic-value-loss/calculate') && request.method() === 'POST') requests.push(request.postDataJSON()) })
  await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Önceki parça hasarı bilinmiyor' }).waitFor()
  check('unknown history blocks the request and any amount', requests.length === 0 && await page.locator('.value-loss-calculator__footer strong').count() === 0)
  await page.getByLabel(part + ' önceki durumu', { exact: true }).selectOption('none')
  const calculate = async () => {
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/traffic-value-loss/calculate') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    const body = await response.json()
    assert.deepEqual(body.issues, [])
    await page.locator('.value-loss-calculator__footer strong').waitFor()
    return body
  }
  const replacement = await calculate()
  check('automatic values reach the authenticated API', requests.at(-1).modelYear === 2021 && requests.at(-1).usageValue === 51001 && requests.at(-1).previousDamageCount === 2 && requests.at(-1).bodyType === 'sedan' && requests.at(-1).vehicleIdentity.manufacturer === 'FORD' && Number.isSafeInteger(replacement.amountMinor))
  await page.getByLabel(part + ' işlemi', { exact: true }).selectOption('repair')
  await page.getByLabel('Parça bedeli bilinmiyor', { exact: true }).check()
  const repair = await calculate()
  await page.getByLabel(part + ' işlemi', { exact: true }).selectOption('repair_paint')
  await page.getByLabel(part + ' boya türü', { exact: true }).selectOption('local')
  const combined = await calculate(), amount = await page.locator('.value-loss-calculator__footer strong').textContent()
  check('combined operation uses one physical row and changes the actual result', await page.locator('.value-loss-calculator__part').count() === 1 && requests.at(-1).partSelections.length === 1 && requests.at(-1).partSelections[0].operation === 'repair_paint' && combined.amountMinor !== repair.amountMinor)
  await page.getByRole('button', { name: 'Özet', exact: true }).click()
  await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
  check('navigation retains actual inputs and result', await page.getByLabel('Rayiç bedeli (TL)', { exact: true }).inputValue() === '1.000.000' && await page.locator('.value-loss-calculator__footer strong').textContent() === amount)
  await partInput.click()
  await page.keyboard.press('End'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape')
  check('keyboard navigation does not submit the form', requests.length === 3)
  for (const [width, height] of [[1440, 900], [1024, 700], [768, 700], [390, 600]]) {
    await electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
    check('calculator fits ' + width + 'px', await page.locator('.value-loss-calculator').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await partInput.click()
    const popup = page.locator('.searchable-select__popup')
    await popup.waitFor()
    const dimensions = await popup.evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: innerHeight, width: innerWidth } })
    check('part list stays inside ' + width + 'px', dimensions.top >= 0 && dimensions.bottom <= dimensions.height && dimensions.left >= 0 && dimensions.right <= dimensions.width)
    await popup.hover(); await page.mouse.wheel(0, 400)
    await page.waitForFunction(() => document.querySelector('.searchable-select__popup')?.scrollTop > 0)
    await page.keyboard.press('Escape')
  }
  await page.getByLabel('Rayiç bedeli (TL)', { exact: true }).fill('1.100.000')
  check('changed input immediately removes the old amount', await page.locator('.value-loss-calculator__footer strong').count() === 0)
  const saved = (await pool.query('SELECT input,result FROM case_value_loss_calculations WHERE case_id=$1', [caseId])).rows[0]
  check('successful estimate and physical part inputs are stored on their own case', saved.result.amountMinor === combined.amountMinor && saved.input.partSelections[0].operation === 'repair_paint' && saved.input.marketValueMinor === 100_000_000)
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
  await page.locator('.value-loss-calculator__footer strong').waitFor()
  check('saved estimate survives clearing the renderer session and reloading', await page.locator('.value-loss-calculator__footer strong').textContent() === amount && await page.getByLabel('Rayiç bedeli (TL)').inputValue() === '1000000')
  check('reference estimate preserves explicit vehicle condition', await page.getByLabel('Hesap yöntemi').count() === 0 && await page.getByLabel('Araç durumu').inputValue() === 'normal' && saved.input.calculationBasis === 'reference' && saved.input.vehicleCondition === 'normal')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(480, 760))
  await page.goto(origin + '/touch-assistant')
  await page.getByRole('tab', { name: 'Dosyalar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Plaka veya dosya numarası' }).fill('34 TST 5050')
  await page.getByRole('button', { name: 'Ara', exact: true }).click()
  await page.locator('.assistant-result').first().click()
  await page.locator('.assistant-value-loss strong').waitFor()
  check('Touch reads the exact persisted amount from the authenticated API', await page.locator('.assistant-value-loss strong').textContent() === amount)
  check('Touch combines the note composer and searchable history in one panel', await page.getByRole('tab').count() === 3 && await page.getByRole('textbox', { name: 'Hızlı not', exact: true }).isVisible() && await page.getByRole('region', { name: 'Geçmiş notlar', exact: true }).isVisible())
  const processBounds = await page.getByRole('tab', { name: 'Süreçler' }).boundingBox()
  const folderBounds = await page.getByRole('button', { name: 'Klasörü Aç', exact: true }).boundingBox()
  check('open folder action is placed to the right of Processes', folderBounds.x >= processBounds.x + processBounds.width)
  await page.goto(origin + '/dosyalar/' + caseId)
  await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
  await page.locator('.value-loss-calculator__footer strong').waitFor()
  const currentDetails = page.locator('.value-loss-calculator details').first()
  if (await currentDetails.getAttribute('open') === null) await currentDetails.locator('summary').click()
  await page.getByLabel('Karşı taraf kusuru (%)').fill('75')
  const adjusted = await calculate()
  check('counterparty fault is applied after gross rounding and persisted with the detailed source', adjusted.amountMinor === combined.amountMinor * 0.75 && adjusted.breakdown.grossAmountMinor === combined.amountMinor && adjusted.breakdown.sourceSha256.length === 64)
  await page.getByText('Hesap dökümü ve kaynaklar', { exact: true }).click()
  const reportPath = output + '/calculation-report.html'
  await downloadElectronFixture(electron, reportPath, () => page.getByRole('button', { name: 'Hesap dökümünü indir' }).click())
  const html = await readFile(reportPath, 'utf8')
  check('actual downloaded report has source provenance, part rows and a printable layout', html.includes(adjusted.breakdown.sourceSha256) && html.includes('@media print') && html.includes('Kusur uygulanmış tahmin') && !html.includes('<script'))
  const requestCount = requests.length
  await page.getByLabel('Araç durumu', { exact: true }).selectOption('current_heavy_damage')
  await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'ağır hasar' }).waitFor()
  check('heavy damage stops the UI without an API call or obsolete amount', requests.length === requestCount && await page.locator('.value-loss-calculator__footer strong').count() === 0)
  check('no formal assessment or production data is written', (await pool.query('SELECT count(*)::int AS n FROM traffic_value_loss_assessments')).rows[0].n === 0)
  check('no renderer JavaScript errors', errors.length === 0)
  if (process.env.VALUE_LOSS_VERIFY_NOTICE === '1') {
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
    const noticeTraffic = await verifyNoticeSheetDelivery({ page, electron, caseId, caseType: 'traffic', output })
    const cascoSourceText = sourceText.replaceAll('calculator-automatic', 'calculator-casco').replace('Ürün: Trafik', 'Ürün: Kasko').replaceAll('TST5050', 'TST6060')
    const cascoSource = await post('/api/v1/eksist/sources', { kind: 'text', text: cascoSourceText })
    assert.equal(cascoSource.status, 201)
    const casco = await post('/api/v1/cases/quick-create', { case: { caseType: 'casco', plate: '34 TST 6060', lossDate: '2026-10-01', notificationDate: '2026-10-02' }, storageRootKey: 'calculator-source', source: { id: cascoSource.body.id, reference: 'calculator-casco' } }, { 'idempotency-key': uuidv7() })
    assert.equal(casco.status, 202)
    const noticeCasco = await verifyNoticeSheetDelivery({ page, electron, caseId: casco.body.case.id, caseType: 'casco', output })
    check('traffic and casco editor, preview, actual PDF and Word outputs preserve hidden data', noticeTraffic.hiddenDataPreserved && noticeCasco.hiddenDataPreserved)
    await page.goto(origin + '/dosyalar/' + caseId)
    await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
  }
  if (process.env.VALUE_LOSS_MEASURE_PERFORMANCE === '1') {
    const cpuBefore = process.cpuUsage(), memoryBefore = process.memoryUsage()
    const httpStarted = performance.now()
    const samples = await page.evaluate(async ({ url, input }) => {
      const times = []
      for (let index = 0; index < 100; index++) {
        const start = performance.now()
        const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
        const result = await response.json()
        if (response.status !== 200 || result.amountMinor === null || result.issues.length) throw new Error('Synthetic API performance calculation failed')
        times.push(performance.now() - start)
      }
      return times.sort((left, right) => left - right)
    }, { url: `/api/v1/cases/${caseId}/traffic-value-loss/calculate?details=1`, input: { ...requests[0], faultRateBasisPoints: 7500 } })
    const cpu = process.cpuUsage(cpuBefore), wallMs = performance.now() - httpStarted, memoryAfter = process.memoryUsage()
    await writeFile(output + '/api-http-performance.json', JSON.stringify({ runtime: 'real authenticated Electron HTTP + API + disposable PostgreSQL writes/audit; 100 sequential calculations; no production data', requests: samples.length, p95Ms: samples[94], p99Ms: samples[98], minMs: samples[0], maxMs: samples.at(-1), wallMs, apiProcessCpuMs: (cpu.user + cpu.system) / 1000, apiProcessCpuPercent: (cpu.user + cpu.system) / (wallMs * 10), memoryBefore, memoryAfter }, null, 2))
    const storageKey = `hasarbotu-value-loss-calculator-v1:${org}:${user}:${caseId}`
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    const current = await measureValueLossElectronTyping({ page, electron, storageKey, caseUrl: origin + '/dosyalar/' + caseId, mode: 'candidate' })
    await writeFile(output + '/electron-performance.json', JSON.stringify(current, null, 2))
  }
  const summary = { status: 'PASS', runtime: 'real Electron shell + API + disposable PostgreSQL', checks: checks.length, screenshots: false, productionDataTouched: false }
  await writeFile(output + '/results.json', JSON.stringify({ ...summary, checks }, null, 2))
  await writeFile(evidenceRoot + '/latest-results.json', JSON.stringify({ ...summary, output, checks }, null, 2))
  console.log(JSON.stringify(summary))
} finally {
  await electron?.close()
  await api?.close()
  await pool.end()
}
