import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { _electron } from '@playwright/test'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../services/api/dist/index.js'

const output = resolve(process.env.VALUE_LOSS_EVIDENCE ?? '.local/value-loss-calculator-electron')
await mkdir(output, { recursive: true })
const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const pool = new pg.Pool({ connectionString: config.url })
const checks = []
const check = (name, pass) => { assert.ok(pass, name); checks.push(name) }
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
  check('removed fields have no editable controls', await page.getByLabel('Marka', { exact: true }).count() === 0 && await page.getByLabel('Kasa / araç yapısı').count() === 0)
  // This source has no repair assessment; only the missing amount is entered.
  const details = page.locator('.value-loss-calculator details').first()
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  await page.getByLabel('Hasar tutarı (TL)', { exact: true }).fill('100.000')
  await page.getByLabel('Rayiç bedeli (TL)', { exact: true }).fill('1.000.000')
  const partInput = page.getByRole('combobox', { name: 'Hasarlı parça', exact: true })
  await partInput.click()
  const part = await page.getByRole('listbox', { name: 'Hasarlı parça' }).getByRole('option').first().textContent()
  await page.getByRole('option', { name: part, exact: true }).click()
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  const requests = []
  page.on('request', request => { if (request.url().endsWith('/traffic-value-loss/calculate')) requests.push(request.postDataJSON()) })
  await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Önceki parça hasarı bilinmiyor' }).waitFor()
  check('unknown history blocks the request and any amount', requests.length === 0 && await page.locator('.value-loss-calculator__footer strong').count() === 0)
  await page.getByLabel(part + ' önceki durumu', { exact: true }).selectOption('none')
  const calculate = async () => {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/traffic-value-loss/calculate') && response.request().method() === 'POST')
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
  check('no formal assessment or production data is written', (await pool.query('SELECT count(*)::int AS n FROM traffic_value_loss_assessments')).rows[0].n === 0)
  check('no renderer JavaScript errors', errors.length === 0)
  const summary = { status: 'PASS', runtime: 'real Electron shell + API + disposable PostgreSQL', checks: checks.length, screenshots: false, productionDataTouched: false }
  await writeFile(output + '/results.json', JSON.stringify({ ...summary, checks }, null, 2))
  console.log(JSON.stringify(summary))
} finally {
  await electron?.close()
  await api?.close()
  await pool.end()
}
