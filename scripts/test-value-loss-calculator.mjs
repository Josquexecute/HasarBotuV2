import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { startDesktopBridge } from '@hasarbotu/desktop-bridge'
import { buildApp, hashPassword } from '../services/api/dist/index.js'

const output = resolve(process.env.VALUE_LOSS_EVIDENCE ?? '.local/value-loss-calculator-browser')
await mkdir(output, { recursive: true })
const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const pool = new pg.Pool({ connectionString: config.url })
let api, bridge, browser
const checks = []
const check = (name, pass) => { assert.ok(pass, name); checks.push({ name, pass: true }) }
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  const org = uuidv7(), user = uuidv7(), caseId = uuidv7()
  const email = 'calculator@example.test', password = 'Synthetic-Calculator-2026!'
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'calculator-browser','Synthetic calculator office')", [org])
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Test Eksper',$4)", [user,org,email,await hashPassword(password)])
  await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [user])
  await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,loss_date,workflow_stage) VALUES($1,$2,2026,1,'2026/1','traffic','34 TEST 46','34TEST46','2026-10-01','damage_assessment')", [caseId,org])
  api = buildApp({ loggerEnabled:false, auth:{ pool, cookieSecure:false } })
  const apiOrigin = await api.listen({ host:'127.0.0.1', port:0 })
  bridge = await startDesktopBridge({ apiOrigin, assetRoot:resolve('dist'), port:0 })
  browser = await chromium.launch({ headless:true })
  const page = await browser.newPage({ viewport:{ width:1440,height:1100 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(bridge.origin + '/dosyalar/' + caseId)
  await page.getByLabel('E-posta', { exact:true }).fill(email)
  await page.getByLabel('Parola', { exact:true }).fill(password)
  await page.getByRole('button',{ name:'Giriş Yap', exact:true }).click()
  await page.locator('.app-shell').waitFor()
  await page.goto(bridge.origin + '/dosyalar/' + caseId)
  await page.getByRole('button',{ name:'Değer Kaybı', exact:true }).click()
  await page.getByRole('heading',{ name:'Değer Kaybı Hesapla', exact:true }).waitFor()
  await page.getByLabel('Model yılı', { exact:true }).fill('2024')
  await page.getByLabel('Kilometre', { exact:true }).fill('50.000')
  await page.getByLabel('Rayiç bedeli (TL)', { exact:true }).fill('1.000.000')
  await page.getByLabel('Hasar tutarı (TL)', { exact:true }).fill('100.000')
  const partInput = page.getByLabel('Hasarlı parça', { exact:true })
  await partInput.waitFor({ state:'visible' })
  await page.locator('#calculator-part-catalog option').first().waitFor({ state:'attached' })
  const part = await page.locator('#calculator-part-catalog option').first().getAttribute('value')
  await partInput.fill(part)
  await page.getByRole('button',{ name:'Ekle', exact:true }).click()
  await page.getByRole('button',{ name:'Hesapla', exact:true }).click()
  await page.locator('.value-loss-calculator__footer strong').waitFor()
  const amount = await page.locator('.value-loss-calculator__footer strong').textContent()
  check('real UI calls authenticated API and shows a TL amount', /[\d.,]+/.test(amount))
  check('only the calculator is rendered', await page.locator('.value-loss-approval,.value-loss-evidence,.value-loss-history,.value-loss-report-panel').count() === 0)
  await page.screenshot({ path:output+'/desktop.png', fullPage:true })
  await page.getByRole('button',{ name:'Özet',exact:true }).click()
  await page.getByRole('button',{ name:'Değer Kaybı',exact:true }).click()
  await page.getByRole('heading',{ name:'Değer Kaybı Hesapla' }).waitFor()
  check('navigation retains the entered values and result', await page.getByLabel('Kilometre',{ exact:true }).inputValue() === '50.000' && await page.locator('.value-loss-calculator__footer strong').textContent() === amount)
  for (const width of [1024,768,390]) {
    await page.setViewportSize({ width,height:1000 })
    check(`calculator fits ${width}px without internal horizontal overflow`, await page.locator('.value-loss-calculator').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await page.locator('.value-loss-calculator').screenshot({ path:output+`/calculator-${width}.png` })
  }
  await page.getByLabel('Kilometre',{ exact:true }).fill('60000')
  check('changing inputs removes the old amount immediately', await page.locator('.value-loss-calculator__footer strong').count() === 0)
  check('no JavaScript errors', errors.length === 0)
  check('calculation does not create an assessment or report', (await pool.query('SELECT count(*)::int AS n FROM traffic_value_loss_assessments')).rows[0].n === 0)
  await writeFile(output+'/results.json', JSON.stringify({ status:'PASS', checks, amount },null,2))
  console.log(JSON.stringify({ status:'PASS', checks:checks.length, amount }))
} finally {
  await browser?.close()
  await bridge?.close()
  await api?.close()
  await pool.end()
}
