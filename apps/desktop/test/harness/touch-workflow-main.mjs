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
  shell = await startDesktopShell({ apiOrigin: process.env.HB_TOUCH_API, assetRoot: process.env.HB_TOUCH_ASSETS, userDataPath: app.getPath('userData'), show: false })
  helper = await startDesktopAssistant({ shell, assetRoot: process.env.HB_TOUCH_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} })
  helper.window.hide()
  await until('!!document.querySelector(".login-card, .app-shell")')
  if (await evaluate('!!document.querySelector(".login-card")')) {
    const deadline = Date.now() + 10_000
    while (!await helper.menuWindow.webContents.executeJavaScript('document.body.textContent.includes("hesabınızla giriş yapın")')) {
      if (Date.now() > deadline) throw new Error('Assistant anonymous bootstrap timed out')
      await delay(50)
    }
    check('native assistant starts without a session before main-window login', true)
    await fill('input[name=email]', process.env.HB_TOUCH_EMAIL)
    await fill('input[name=password]', process.env.HB_TOUCH_PASSWORD)
    await click('.login-card button[type=submit]')
    await until('!!document.querySelector(".app-shell")')
  }
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
    shell.window.hide()
    helper.menu.items.find((item) => item.label === 'Hızlı not').click()
    const menuEval = code => helper.menuWindow.webContents.executeJavaScript(code)
    const menuUntil = async code => {
      const deadline = Date.now() + 15_000
      while (!await menuEval(code)) { if (Date.now() > deadline) throw new Error(`Assistant condition timed out: ${code}`); await delay(80) }
    }
    await menuUntil('!!document.querySelector(".assistant-search input")')
    await menuEval('(()=>{ const input=document.querySelector(".assistant-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"34 TEST");input.dispatchEvent(new Event("input",{bubbles:true})) })()')
    await menuEval('document.querySelector(".assistant-search").requestSubmit()')
    await menuUntil('document.querySelectorAll(".assistant-result").length === 2')
    await menuEval('[...document.querySelectorAll(".assistant-result")].find(button=>button.textContent.includes("34 TEST 01")).click()')
    await menuUntil('!!document.querySelector("textarea")')
    check('native assistant searches and selects while main remains hidden', !shell.window.isVisible() && await evaluate('location.href') === previousRoute)
    await menuEval('(()=>{const input=document.querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Dokunmatik kalıcı not.");input.dispatchEvent(new Event("input",{bubbles:true}))})()')
    await menuUntil('!!document.querySelector(".assistant-case form button[type=submit]:not(:disabled)")')
    await menuEval('document.querySelector(".assistant-case form").requestSubmit()')
    await menuUntil('document.body.textContent.includes("Not dosyaya kaydedildi.")')
    check('native assistant saves the note without opening the main app', !shell.window.isVisible())
    await menuEval('[...document.querySelectorAll("button")].find(button=>button.textContent==="Görünümümü özelleştir").click()')
    await menuUntil('!!document.querySelector(".assistant-appearance-editor")')
    await menuEval('[...document.querySelectorAll(".assistant-palette-presets button")].find(button=>button.textContent==="Yeşil").click()')
    await menuEval('document.querySelector(".assistant-appearance-editor").requestSubmit()')
    await menuUntil('document.body.textContent.includes("Touch görünümünüz hesabınıza kaydedildi.")')
    check('personal palette changes actual panel styles after API save', await menuEval('document.querySelector(".desktop-assistant-panel").style.getPropertyValue("--accent") === "#15803d"'))
    const mainSessionResponse = await shell.window.webContents.session.fetch(`${shell.origin}/api/v1/me/assistant-appearance`, { credentials: 'include', redirect: 'error' })
    check('main-process update transport retains the authenticated HttpOnly session', mainSessionResponse.ok && (await mainSessionResponse.json()).appearance.accentColor === '#15803d')
    await menuEval('[...document.querySelectorAll("button")].find(button=>button.textContent==="Dosya aramasına dön").click()')
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Geçmiş notlar").click()')
    await menuUntil('!![...document.querySelectorAll(".assistant-entry")].find(entry=>entry.textContent.includes("Dokunmatik kalıcı not."))')
    check('native assistant reads committed note history', true)
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Süreçler").click()')
    await menuUntil('document.querySelector(".assistant-process")?.textContent.includes("Ekspertiz Bekliyor") && document.body.textContent.includes("Tramer talebi yok.")')
    check('native assistant reads effective workflow and tracking state', true)
    for (const theme of ['light','dark']) {
      await menuEval(`document.querySelector('.theme-root').dataset.theme=${JSON.stringify(theme)}`)
      check(`assistant ${theme}: fits work area`, await menuEval('document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").scrollHeight <= innerHeight'))
      await writeFile(join(output,`standalone-assistant-${theme}.png`),(await helper.menuWindow.webContents.capturePage()).toPNG())
    }
    helper.menuWindow.webContents.setZoomFactor(1.5)
    await menuUntil('innerWidth <= 280')
    await menuEval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    check('assistant at 150 percent: no horizontal overflow', await menuEval('document.documentElement.scrollWidth <= innerWidth'))
    await writeFile(join(output,'standalone-assistant-zoom.png'),(await helper.menuWindow.webContents.capturePage()).toPNG())
    helper.menuWindow.webContents.setZoomFactor(1)
    await menuUntil('innerWidth === 420')
    await menuEval('document.querySelector("header button").click()')
    shell.window.show()
    shell.window.focus()
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
    helper.menu.items.find((item) => item.label === 'Hızlı not').click()
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    await menuUntil('document.querySelector(".desktop-assistant-panel").style.getPropertyValue("--accent") === "#15803d"')
    check('account palette reloads after complete Electron restart', true)
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Geçmiş notlar").click()')
    await menuUntil('!![...document.querySelectorAll(".assistant-entry")].find(entry=>entry.textContent.includes("Dokunmatik kalıcı not."))')
    check('native assistant restores selection and server history after shell restart', true)
    await menuEval('document.querySelector("header button").click()')
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
