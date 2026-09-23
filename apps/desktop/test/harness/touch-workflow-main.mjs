import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'

const output = process.env.HB_TOUCH_OUTPUT
const checks = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let shell, helper
const evaluate = (code) => shell.window.webContents.executeJavaScript(code)
const until = async (code) => {
  const deadline = Date.now() + 15_000
  while (!await evaluate(code)) {
    if (Date.now() > deadline) throw new Error(`UI condition timed out: ${code}`)
    await delay(80)
  }
}
const click = async (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const fill = async (selector, value, textarea = false) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
const screenshot = async (name) => writeFile(join(output, `${name}.png`), (await shell.window.webContents.capturePage()).toPNG())
async function boot() {
  shell = await startDesktopShell({ apiOrigin: process.env.HB_TOUCH_API, assetRoot: process.env.HB_TOUCH_ASSETS, show: false })
  await until('!!document.querySelector(".login-card, .app-shell")')
  if (await evaluate('!!document.querySelector(".login-card")')) {
    await fill('input[name=email]', process.env.HB_TOUCH_EMAIL)
    await fill('input[name=password]', process.env.HB_TOUCH_PASSWORD)
    await click('.login-card button[type=submit]')
    await until('!!document.querySelector(".app-shell")')
  }
  helper = await startDesktopAssistant({ shell, assetRoot: process.env.HB_TOUCH_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} })
  helper.window.hide()
}
const navigate = async (path) => {
  await shell.window.loadURL(`${shell.origin}${path}`)
  await until('!!document.querySelector(".page h1")')
}
async function saveNote(text) {
  await until('!!document.querySelector(".touch-assistant textarea")')
  await fill('.touch-assistant textarea', text, true)
  await until('!!document.querySelector(".touch-assistant button[type=submit]:not(:disabled)")')
  await click('.touch-assistant button[type=submit]')
  await until('document.querySelector(".touch-assistant")?.textContent.includes("Not dosyaya kaydedildi.")')
  await click('[aria-label="Hızlı notu kapat"]')
}
app.disableHardwareAcceleration()
app.enableSandbox()
app.on('window-all-closed', () => { /* The test recreates the shell in the same process. */ })
void app.whenReady().then(async () => {
  try {
    await boot()
    const pages = [['/', 'dashboard'], ['/dosyalar', 'cases'], ['/kapanan-dosyalar', 'closed'], ['/raporlar-ve-ucretler', 'reports'], ['/mevzuat-ve-ai', 'legislation'], ['/bildirimler', 'notifications'], ['/yonetim', 'management'], ['/ayarlar', 'settings']]
    for (const width of [1440, 390]) {
      shell.window.setContentSize(width, 900)
      for (const [path, name] of pages) {
        await navigate(path)
        await until(`innerWidth === ${width}`)
        check(`${name} at ${width}: viewport does not overflow`, await evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".app-shell").getBoundingClientRect().width <= innerWidth'))
        await screenshot(`${name}-${width}`)
      }
    }
    check('production settings omit simulated folder and status', await evaluate('!document.body.textContent.includes("Mock Çalışma Klasörü") && !document.body.textContent.includes("BackendEklenmedi")'))
    await click('[aria-label="Sol menüyü aç veya kapat"]')
    check('mobile menu opens with readable links', await evaluate('document.querySelector(".sidebar").getBoundingClientRect().width > 100'))
    await click('.sidebar a[href="/dosyalar"]')
    await until('location.pathname === "/dosyalar" && !document.querySelector(".app-shell--menu-open")')
    check('mobile menu closes after navigation', true)
    await navigate(`/dosyalar/${process.env.HB_TOUCH_CASE}`)
    await until('!!document.querySelector(".vehicle-profile")')
    check('technical vehicle fields initially collapsed', await evaluate('!document.querySelector(".vehicle-profile__technical").open'))
    for (const tab of ['Özet', 'Operasyon', 'Evrak ve Fotoğraf', 'Ağır Hasar', 'Değer Kaybı', 'Raporlar ve Ücretler', 'E-postalar', 'Geçmiş']) {
      await evaluate(`[...document.querySelectorAll('.case-tabs button')].find(el => el.textContent === ${JSON.stringify(tab)}).click()`)
      await until(`document.querySelector('.module-heading h1')?.textContent === ${JSON.stringify(tab)}`)
      check(`case tab ${tab}: no viewport overflow`, await evaluate('document.documentElement.scrollWidth <= innerWidth'))
      await screenshot(`case-tab-${tab.replaceAll(' ', '-')}`)
    }
    const previousRoute = await evaluate('location.href')
    helper.menu.items.find((item) => item.label === 'Hızlı not').click()
    await until('!!document.querySelector(".touch-assistant textarea")')
    check('native assistant preserves the open case route', await evaluate('location.href') === previousRoute)
    check('native assistant resolves open case without dropdown', await evaluate('document.querySelector(".touch-assistant").textContent.includes("34 TEST 01") && !document.querySelector(".touch-assistant select")'))
    await screenshot('quick-note-mobile')
    await saveNote('Dokunmatik kalıcı not.')
    await until('document.querySelector(".case-operations__notes")?.textContent.includes("Dokunmatik kalıcı not.")')
    check('saved note immediately visible in case details', true)
    await navigate('/dosyalar')
    await until('document.querySelectorAll(".case-table tbody tr").length === 2')
    await evaluate("[...document.querySelectorAll('.case-table tbody tr')].find(el => el.textContent.includes('34 TEST 02')).click()")
    await click('.touch-assistant-trigger')
    check('list selection supplies the second case', await evaluate('document.querySelector(".touch-assistant").textContent.includes("34 TEST 02")'))
    await saveNote('Seçili dosyaya not.')
    await shell.close()
    await boot()
    await navigate(`/dosyalar/${process.env.HB_TOUCH_CASE}?tab=operations`)
    await until('document.querySelector(".case-operations__notes")?.textContent.includes("Dokunmatik kalıcı not.")')
    check('recreated shell reloads committed note from API', true)
    await screenshot('note-after-restart')
  } catch (error) {
    checks.push({ name: error instanceof Error ? error.message : 'Unexpected failure', pass: false })
    if (shell && !shell.window.isDestroyed()) await screenshot('failure')
  } finally {
    helper?.dispose()
    await shell?.close()
    await writeFile(join(output, 'results.json'), JSON.stringify({ checks }, null, 2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
