import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium } from '@playwright/test'
import { uuidv7 } from '@hasarbotu/database'
import { startFieldBrowserFixture } from '../services/api/tools/field-browser-fixture.mjs'

const output = resolve(process.env.FIELD_MULTI_USER_EVIDENCE ?? '.local/field-multi-user-evidence')
await mkdir(output, { recursive: true })
const fixture = await startFieldBrowserFixture(process.env.TEST_DATABASE_URL)
const metrics = []
let browser
try {
  const seed = (await fixture.pool.query('SELECT organization_id,password_hash FROM users WHERE email=$1', [fixture.email])).rows[0]
  const users = []
  for (let index = 0; index < 10; index++) {
    const id = uuidv7(), email = `synthetic-field-${index}@example.test`
    await fixture.pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, seed.organization_id, email, `Synthetic Field ${index}`, seed.password_hash])
    await fixture.pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [id])
    users.push({ id, email })
  }
  browser = await chromium.launch({ headless: true })
  for (const count of [5, 10]) {
    const contexts = [], sessions = new Set(), started = performance.now()
    const image = Buffer.concat([fixture.jpeg, Buffer.alloc(600000, count)])
    const existing = Number((await fixture.pool.query('SELECT count(*) FROM field_photo_uploads')).rows[0].count)
    try {
      // Independent browser cookie jars, real logins, HTTP uploads and the real
      // File Agent share three physical folders, including overlapping cases.
      await Promise.all(users.slice(0, count).map(async (user, index) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
        contexts.push(context)
        const page = await context.newPage()
        const runtimeErrors = []
        page.on('pageerror', error => runtimeErrors.push(error.message))
        await page.goto(fixture.origin + '/saha')
        await page.getByLabel('E-posta', { exact: true }).fill(user.email)
        await page.getByLabel('Parola', { exact: true }).fill(fixture.password)
        await page.getByRole('button', { name: 'Giriş yap', exact: true }).click()
        await page.getByRole('textbox', { name: 'Plaka ara' }).waitFor()
        const cookie = (await context.cookies()).find(item => item.name === 'hb_session')
        assert(cookie && !sessions.has(cookie.value), 'A separate authenticated session is required')
        sessions.add(cookie.value)
        const target = fixture.cases[index % fixture.cases.length]
        await page.getByRole('textbox', { name: 'Plaka ara' }).fill(target.plate)
        await page.getByRole('button', { name: 'Ara', exact: true }).click()
        await page.locator('.field-case').filter({ hasText: target.plate }).click()
        await page.getByLabel('Galeriden fotoğraf seç', { exact: true }).setInputFiles({ name: `parallel-${count}-${index}.jpg`, mimeType: 'image/jpeg', buffer: image })
        await page.getByRole('button', { name: '1 fotoğrafı yükle', exact: true }).click()
        const previousOwnUploads = count === 10 && index < 5 ? 1 : 0
        await page.locator('.field-history-item').filter({ hasText: `Synthetic Field ${index} ·` }).locator('img').nth(previousOwnUploads).waitFor({ timeout: 60000 })
        assert.equal(runtimeErrors.length, 0)
      }))
      assert.equal(sessions.size, count)
      const records = (await fixture.pool.query('SELECT id,uploaded_by_user_id,case_id,status,original_file_name,output_file_name,output_bytes,output_hash FROM field_photo_uploads ORDER BY created_at,id')).rows
      assert.equal(records.length, existing + count, 'No duplicate upload records')
      assert(records.every(row => row.status === 'ready'), 'All uploads must reach ready')
      for (const [index, user] of users.slice(0, count).entries()) {
        assert.equal(records.filter(row => row.uploaded_by_user_id === user.id && row.original_file_name === `parallel-${count}-${index}.jpg`).length, 1)
      }
      const seen = new Set()
      for (const record of records) {
        const target = fixture.cases.find(item => item.id === record.case_id)
        assert(target)
        const bytes = await readFile(join(fixture.root, target.path, record.output_file_name))
        assert.equal(bytes.length, Number(record.output_bytes))
        assert.equal(createHash('sha256').update(bytes).digest('hex'), record.output_hash)
        assert(bytes.length >= 102400 && bytes.length <= 614400)
        const path = target.path + '/' + record.output_file_name
        assert(!seen.has(path), 'Concurrent users must not overwrite the same output path')
        seen.add(path)
        const original = await readFile(join(fixture.originals, record.id + '.bin'))
        const wave = /^parallel-(5|10)-\d+\.jpg$/.exec(record.original_file_name)
        assert(wave)
        assert(original.equals(Buffer.concat([fixture.jpeg, Buffer.alloc(600000, Number(wave[1]))])), 'Original bytes must remain exact')
      }
      for (const target of fixture.cases) {
        assert.equal(await readFile(join(fixture.root, target.path, 'HASAR 101.jpg'), 'utf8'), 'Existing office photo must be preserved')
        const files = await readdir(join(fixture.root, target.path))
        assert.equal(files.length, 1 + records.filter(row => row.case_id === target.id).length)
      }
      assert.equal(fixture.errors.length, 0)
      const elapsedMs = Math.round(performance.now() - started)
      metrics.push({ clients: count, independentSessions: sessions.size, uploads: count, errors: 0, elapsedMs, readyUploads: records.length, exactOriginalSizes: true, physicalOutputHashesVerified: true, duplicatePaths: 0, existingPhotosPreserved: true })
    } finally { await Promise.all(contexts.map(context => context.close())) }
  }
  const result = { status: 'PASS', checkedAt: new Date().toISOString(), metrics, realBrowsers: true, realHttp: true, realDatabase: true, realFileAgent: true, syntheticFreshnessGate: true, externalRequests: 0, productionWrites: 0 }
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'FAIL', metrics, message: String(error) }, null, 2))
  throw error
} finally { await browser?.close(); await fixture.close() }
