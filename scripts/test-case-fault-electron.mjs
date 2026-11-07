import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron } from '@playwright/test'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'

const stage = process.argv[2] ?? 'candidate'
assert.ok(['baseline', 'candidate'].includes(stage))
const output = resolve(process.env.FAULT_EVIDENCE ?? '.local/fault-0192')
const baseline = resolve(process.env.FAULT_BASELINE ?? join(output, 'baseline'))
const assets = resolve(process.env.FAULT_ASSETS ?? (stage === 'baseline' ? join(baseline, 'ui') : 'dist'))
const module = stage === 'baseline' ? join(baseline, 'services/api/dist/index.js') : resolve('services/api/dist/index.js')
const { buildApp, hashPassword } = await import(pathToFileURL(module).href)
const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const pool = new pg.Pool({ connectionString: config.url })
await mkdir(output, { recursive: true })
const checks = []
const check = (name, value) => { assert.ok(value, name); checks.push(name) }
const report = { stage, runtime: { node: process.version, electron: createRequire(import.meta.url)('electron/package.json').version, platform: process.platform, arch: process.arch }, fixtureCases: 1000, checks, measurements: [], productionChanged: false, feedChanged: false, screenshots: false }
let api, app
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await runMigrations({ databaseUrl: config.url, quiet: true, ...(stage === 'baseline' ? { dir: join(baseline, 'migrations') } : {}) })
  const org = uuidv7(), user = uuidv7(), traffic = uuidv7(), casco = uuidv7()
  const password = 'Synthetic-Fault-Electron-2026!'
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'fault-electron','Synthetic fault office')", [org])
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'fault@example.test','Test Eksper',$3)", [user, org, await hashPassword(password)])
  await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [user])
  await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized,notification_date)
    SELECT CASE n WHEN 1 THEN $2::uuid WHEN 2 THEN $3::uuid ELSE gen_random_uuid() END,$1,2026,n,'2026/'||n,
      CASE WHEN n%2=1 THEN 'traffic' ELSE 'casco' END,'open','new_notification','34 TEST '||n,'34TEST'||n,'2026-11-06' FROM generate_series(1,1000) n`, [org, traffic, casco])
  api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  const origin = await api.listen({ host: '127.0.0.1', port: 0 })
  const profile = await mkdtemp(join(output, stage + '-profile-'))
  const env = { ...process.env, HB_FAULT_API: origin, HB_FAULT_ASSETS: assets }
  delete env.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [resolve('apps/desktop/test/harness/case-fault-main.mjs'), '--user-data-dir=' + profile], env })
  const main = await app.firstWindow()
  main.setDefaultTimeout(15000)
  const errors = []
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  main.on('pageerror', error => errors.push(error.message))
  const requests = []
  const recordRequest = request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ url: new URL(request.url()).pathname, method: request.method() }) }
  main.on('request', recordRequest)
  await main.getByLabel('E-posta', { exact: true }).fill('fault@example.test')
  await main.getByLabel('Parola', { exact: true }).fill(password)
  await main.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
  await main.locator('.app-shell').waitFor()
  const shellOrigin = new URL(main.url()).origin
  await main.goto(shellOrigin + '/dosyalar/' + casco)
  await main.getByRole('heading', { name: 'Dosya Özeti', exact: true }).waitFor()
  await app.evaluate(async () => {
    faultShell.window.setBounds({ x: 0, y: 0, width: 1440, height: 900 })
    await faultAssistant.menuWindow.loadURL(faultShell.origin + '/touch-assistant')
    faultAssistant.menuWindow.setBounds({ x: 1000, y: 80, width: 420, height: 720 })
    faultAssistant.menuWindow.showInactive()
  })
  const panel = app.windows().find(page => page.url().includes('/touch-assistant'))
  const touch = app.windows().find(page => page.url().includes('/desktop-assistant.html'))
  assert.ok(panel && touch)
  panel.on('request', recordRequest)
  await panel.locator('.desktop-assistant-panel').waitFor()
  await panel.evaluate(({ user, casco }) => { localStorage.setItem('hasarbotu-assistant-case:' + user, casco); window.dispatchEvent(new Event('focus')) }, { user, casco })
  await panel.getByRole('textbox', { name: 'Hızlı not', exact: true }).waitFor()
  await panel.getByRole('tab', { name: 'Süreçler' }).click()
  await panel.getByText('Tramer talebi yok.').waitFor()
  check('real main, process panel and character loaded', await touch.locator('canvas').count() === 1)
  if (stage === 'candidate' && process.env.FAULT_PERF_ONLY !== '1') {
    const left = main.getByRole('combobox', { name: 'Kaskolu Sigortalı kusur oranı' })
    await left.waitFor()
    await main.getByRole('region', { name: 'Kusur oranı' }).scrollIntoViewIfNeeded()
    check('no manual percentage field', await main.getByRole('region', { name: 'Kusur oranı' }).getByRole('textbox').count() === 0)
    await left.selectOption('25')
    check('other side complements before save', await main.getByRole('combobox', { name: 'Karşı Taraf kusur oranı' }).inputValue() === '75')
    await main.getByRole('button', { name: 'Kusuru kaydet' }).click()
    await main.getByText('Kusur bilgisi kaydedildi.').waitFor()
    await panel.waitForFunction(() => document.querySelector('[aria-label="Kaskolu Sigortalı kusur oranı"]')?.value === '25')
    check('main save synchronizes the already-open Touch window', true)
    check('potential recourse is explicitly provisional', (await panel.getByRole('note').textContent()).includes('Potansiyel Rücu: %75') && (await panel.getByRole('note').textContent()).includes('Kesinleşmiş rücu değildir.'))
    await panel.getByRole('combobox', { name: 'Karşı Taraf kusur oranı' }).selectOption('50')
    await panel.getByRole('button', { name: 'Kusuru kaydet' }).click()
    await panel.getByText('Kusur bilgisi kaydedildi.').waitFor()
    await main.waitForFunction(() => document.querySelector('[aria-label="Kaskolu Sigortalı kusur oranı"]')?.value === '50')
    check('Touch save synchronizes the already-open main window', true)
    await main.reload()
    await left.waitFor()
    check('reload restores persisted ratio', await left.inputValue() === '50')
    await left.selectOption('100')
    check('zero counterparty fault has no recourse warning', await main.getByRole('note').filter({ hasText: 'Potansiyel Rücu' }).count() === 0)
    await main.getByRole('button', { name: 'Vazgeç' }).click()
    await left.selectOption('')
    check('undetermined clears both sides', await main.getByRole('combobox', { name: 'Karşı Taraf kusur oranı' }).inputValue() === '')
    await main.getByRole('button', { name: 'Kusuru kaydet' }).click()
    await main.getByText('Kusur bilgisi kaydedildi.').waitFor()
    await panel.waitForFunction(() => document.querySelector('[aria-label="Karşı Taraf kusur oranı"]')?.value === '')
    const row = (await pool.query('SELECT recourse_status FROM cases WHERE id=$1', [casco])).rows[0]
    check('no confirmed recourse decision was created', row.recourse_status === 'unknown')
    const legacyModule = await import(pathToFileURL(join(baseline, 'services/api/dist/index.js')).href)
    const legacyApp = legacyModule.buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    try {
      const legacyLogin = await legacyApp.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'fault@example.test', password } })
      const legacyCookie = String(legacyLogin.headers['set-cookie']).split(';')[0]
      const oldDetail = await legacyApp.inject({ url: `/api/v1/cases/${casco}`, headers: { cookie: legacyCookie } })
      check('previous API reads migrated cases without new DTO fields', oldDetail.statusCode === 200 && !Object.hasOwn(oldDetail.json().case, 'insuredPercent'))
      const oldWrite = await legacyApp.inject({ method: 'PATCH', url: `/api/v1/cases/${casco}`, headers: { cookie: legacyCookie }, payload: { expectedVersion: oldDetail.json().case.version, insurerClaimNumber: 'SYNTHETIC-LEGACY' } })
      check('previous API still updates cases after migration', oldWrite.statusCode === 200)
      check('legacy write preserves separate persisted fault version', (await pool.query('SELECT version,insured_percent FROM case_fault_ratios WHERE case_id=$1', [casco])).rows[0]?.version === 3)
    } finally { await legacyApp.close() }
    await main.goto(shellOrigin + '/dosyalar/' + traffic)
    const insured = main.getByRole('combobox', { name: 'Sigortalı kusur oranı' })
    await insured.waitFor()
    check('traffic uses insured left, victim right and has independent storage', await insured.inputValue() === '' && await main.getByRole('combobox', { name: 'Mağdur kusur oranı' }).inputValue() === '')
    await insured.focus()
    await insured.press('Home')
    await insured.press('ArrowDown')
    await insured.press('Tab')
    check('keyboard selection complements the other side', await insured.inputValue() === '0' && await main.getByRole('combobox', { name: 'Mağdur kusur oranı' }).inputValue() === '100')
    await main.getByRole('button', { name: 'Kusuru kaydet' }).click()
    await main.getByText('Kusur bilgisi kaydedildi.').waitFor()
    await main.goto(shellOrigin + '/dosyalar/' + casco)
    await left.waitFor()
    for (const theme of ['light', 'dark']) {
      await panel.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      for (const zoom of [1, 1.25, 1.5]) {
        await app.evaluate((_, zoom) => faultAssistant.menuWindow.webContents.setZoomFactor(zoom), zoom)
        check(`${theme} ${zoom} Touch form fits without horizontal overflow`, await panel.getByRole('region', { name: 'Kusur oranı' }).evaluate(node => {
          const rect = node.getBoundingClientRect(), content = document.querySelector('.assistant-content').getBoundingClientRect()
          return node.scrollWidth <= node.clientWidth + 1 && rect.left >= content.left - 1 && rect.right <= content.right + 1
        }))
      }
    }
    await app.evaluate(() => faultAssistant.menuWindow.webContents.setZoomFactor(1))
  }
  if (process.env.FAULT_FUNCTIONAL_ONLY !== '1') {
    const cdpMain = await app.context().newCDPSession(main), cdpPanel = await app.context().newCDPSession(panel)
    for (const cdp of [cdpMain, cdpPanel]) await cdp.send('Performance.enable')
    const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
    await panel.evaluate(() => {
      window.faultInput = { handlers: [], paints: [], storage: [] }
      const startedEvents = new WeakMap()
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (...args) {
        const started = performance.now()
        try { return setItem.apply(this, args) }
        finally { if (args[0].startsWith('hasarbotu-quick-note:')) window.faultInput.storage.push(performance.now() - started) }
      }
      document.addEventListener('input', event => {
        if (event.target.getAttribute('aria-label') !== 'Hızlı not' && event.target.tagName !== 'TEXTAREA') return
        startedEvents.set(event, performance.now())
      }, true)
      document.addEventListener('input', event => {
        const started = startedEvents.get(event)
        if (started === undefined) return
        queueMicrotask(() => window.faultInput.handlers.push(performance.now() - started))
        requestAnimationFrame(() => window.faultInput.paints.push(performance.now() - started))
      })
    })
    await app.evaluate(() => { faultShell.window.focus(); faultAssistant.menuWindow.showInactive() })
    await main.evaluate(async () => {
      if (!window.hasarbotuTouch) throw new Error('Touch bridge missing')
      await window.hasarbotuTouch.control({ type: 'wake' })
      await window.hasarbotuTouch.control({ type: 'play', id: 'sulk' })
      // Harness-only stimulus keeps the same real 3s reaction active throughout
      // both builds; natural idle states intentionally skip canvas redraws.
      window.faultPerfTimer = setInterval(() => void window.hasarbotuTouch.control({ type: 'play', id: 'sulk' }), 2000)
    })
    // Let all lazy neighbors finish before taking the retained baseline.
    await main.waitForTimeout(1500)
    report.retainedBefore = {}
    for (const [name, cdp] of [['main', cdpMain], ['panel', cdpPanel]]) {
      await cdp.send('HeapProfiler.collectGarbage')
      const values = await metrics(cdp)
      report.retainedBefore[name] = { heapMiB: values.JSHeapUsedSize / 1048576, nodes: values.Nodes, listeners: values.JSEventListeners }
    }
    await touch.evaluate(() => {
      const context = document.querySelector('canvas').getContext('2d'), clear = context.clearRect
      window.faultFrames = []
      context.clearRect = function (...args) { if (window.faultFrames.length < 5000) window.faultFrames.push(performance.now()); return clear.apply(this, args) }
    })
    // Warm up both runs before measuring; never collect garbage during timed samples.
    await main.waitForTimeout(1200)
    for (const scenario of ['idle', 'input-and-tabs']) {
      for (let trial = 0; trial < 3; trial++) {
        await touch.evaluate(() => window.faultFrames = [])
        await panel.evaluate(() => { window.faultInput.handlers = []; window.faultInput.paints = []; window.faultInput.storage = [] })
        const beforeMain = await metrics(cdpMain), beforePanel = await metrics(cdpPanel), requestStart = requests.length
        await app.evaluate(({ app }) => app.getAppMetrics())
        const started = performance.now()
        const latency = []
        const keyLatency = []
        if (scenario === 'idle') await main.waitForTimeout(8000)
        else {
          for (let n = 0; n < 12; n++) {
            await panel.getByRole('tab', { name: 'Hızlı not' }).click()
            const note = panel.getByRole('textbox', { name: 'Hızlı not', exact: true })
            const start = performance.now()
            await note.fill(`Sentetik ölçüm ${trial}-${n}`)
            assert.equal(await note.inputValue(), `Sentetik ölçüm ${trial}-${n}`)
            latency.push(performance.now() - start)
            if (process.env.FAULT_EXTENDED_INPUT === '1') {
              for (let key = 0; key < 10; key++) {
                const keyStarted = performance.now()
                await note.press('a')
                keyLatency.push(performance.now() - keyStarted)
              }
              assert.equal(await note.inputValue(), `Sentetik ölçüm ${trial}-${n}` + 'a'.repeat(10))
            }
            await panel.getByRole('tab', { name: 'Süreçler' }).click()
            await panel.waitForTimeout(300)
          }
          await panel.waitForTimeout(Math.max(0, 8000 - (performance.now() - started)))
        }
        const duration = performance.now() - started
        const frames = await touch.evaluate(() => window.faultFrames)
        const gaps = frames.slice(1).map((frame, i) => frame - frames[i]).sort((a, b) => a - b)
        const afterMain = await metrics(cdpMain), afterPanel = await metrics(cdpPanel)
        const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, pid: item.pid, cpuPercent: item.cpu.percentCPUUsage, privateMiB: item.memory.privateBytes / 1024 })))
        const p95 = items => { const sorted = [...items].sort((a, b) => a - b); return sorted[Math.floor(sorted.length * .95)] ?? null }
        const p99 = items => { const sorted = [...items].sort((a, b) => a - b); return sorted[Math.floor(sorted.length * .99)] ?? null }
        const input = await panel.evaluate(() => window.faultInput)
        report.measurements.push({ scenario, trial, durationMs: duration, touchFps: frames.length * 1000 / duration, frameP95Ms: p95(gaps), longFrames50: gaps.filter(gap => gap > 50).length,
          inputP95Ms: p95(latency), inputP99Ms: p99(latency), inputSamples: latency, keyInputP95Ms: p95(keyLatency), keyInputP99Ms: p99(keyLatency), keySamples: keyLatency,
          handlerP95Ms: p95(input.handlers), handlerP99Ms: p99(input.handlers), paintP95Ms: p95(input.paints), paintP99Ms: p99(input.paints), input,
          requests: requests.slice(requestStart), mainScriptMs: (afterMain.ScriptDuration - beforeMain.ScriptDuration) * 1000,
          panelScriptMs: (afterPanel.ScriptDuration - beforePanel.ScriptDuration) * 1000, mainHeapMiB: afterMain.JSHeapUsedSize / 1048576, panelHeapMiB: afterPanel.JSHeapUsedSize / 1048576,
          mainNodes: afterMain.Nodes, panelNodes: afterPanel.Nodes, panelListeners: afterPanel.JSEventListeners, processes })
      }
    }
    await main.evaluate(() => clearInterval(window.faultPerfTimer))
    report.retained = {}
    for (const [name, cdp] of [['main', cdpMain], ['panel', cdpPanel]]) {
      await cdp.send('HeapProfiler.collectGarbage')
      const values = await metrics(cdp)
      report.retained[name] = { heapMiB: values.JSHeapUsedSize / 1048576, nodes: values.Nodes, listeners: values.JSEventListeners }
    }
    const login = await api.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'fault@example.test', password } })
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    report.api = {}
    for (const [name, path] of [['detail', `/api/v1/cases/${casco}`], ['list', '/api/v1/cases?pageSize=50'], ...(stage === 'candidate' ? [['fault', `/api/v1/cases/${casco}/fault`]] : [])]) {
      const timings = []
      for (let n = 0; n < 110; n++) {
        const started = performance.now()
        const response = await fetch(new URL(path, origin), { headers: { cookie } })
        assert.equal(response.status, 200)
        await response.arrayBuffer()
        if (n >= 10) timings.push(performance.now() - started)
      }
      timings.sort((a, b) => a - b)
      report.api[name] = { samples: timings.length, medianMs: timings[50], p95Ms: timings[95] }
    }
    if (stage === 'candidate') {
      const path = new URL(`/api/v1/cases/${casco}/fault`, origin)
      let version = (await (await fetch(path, { headers: { cookie } })).json()).version
      const timings = []
      for (let n = 0; n < 110; n++) {
        const started = performance.now()
        const response = await fetch(path, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ insuredPercent: [0, 25, 50, 75, 100][n % 5], expectedVersion: version }) })
        assert.equal(response.status, 200)
        version = (await response.json()).version
        if (n >= 10) timings.push(performance.now() - started)
      }
      timings.sort((a, b) => a - b)
      report.api.faultSave = { samples: timings.length, medianMs: timings[50], p95Ms: timings[95] }
    }
  }
  report.rendererErrors = errors
  check('zero renderer exceptions', errors.length === 0)
  const hashTree = async directory => {
    const hashes = {}
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) for (const [key, value] of Object.entries(await hashTree(path))) hashes[item.name + '/' + key] = value
      else hashes[item.name] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
    return hashes
  }
  const oldAssets = await hashTree(join(baseline, 'ui'))
  const newAssets = await hashTree(resolve('dist'))
  const characterFiles = Object.keys(oldAssets).filter(file => /desktop-assistant|touch|mochi/i.test(file) && !file.startsWith('assets/'))
  check('original Touch animation assets remain byte-identical', characterFiles.length > 0 && characterFiles.every(file => oldAssets[file] === newAssets[file]))
  report.touchAssetsVerified = characterFiles.length
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1
} finally {
  await writeFile(join(output, `${stage}${process.env.FAULT_FUNCTIONAL_ONLY === '1' ? '-functional' : ''}-electron.json`), JSON.stringify(report, null, 2))
  await app?.close(); await api?.close(); await pool.end()
}
console.log(JSON.stringify({ stage, status: report.status, checks: checks.length, error: report.error?.split('\n').slice(0, 3), evidence: join(output, `${stage}${process.env.FAULT_FUNCTIONAL_ONLY === '1' ? '-functional' : ''}-electron.json`) }))
