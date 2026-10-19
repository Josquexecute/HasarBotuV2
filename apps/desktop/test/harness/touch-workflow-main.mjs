import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'
import { hideToTrayOnClose } from '../../dist/main/window-lifecycle.js'

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
const screenshot = async (name, contents = shell.window.webContents) => {
  if (process.env.HB_CAPTURE_SCREENSHOTS !== '1') return
  // A resized DOM can be ready before Chromium submits its new capture surface.
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  await writeFile(join(output, `${name}.png`), (await contents.capturePage()).toPNG())
}
async function boot() {
  shell = await startDesktopShell({ apiOrigin: process.env.HB_TOUCH_API, assetRoot: process.env.HB_TOUCH_ASSETS, userDataPath: app.getPath('userData'), show: false })
  hideToTrayOnClose(app, shell.window)
  helper = await startDesktopAssistant({ shell, assetRoot: process.env.HB_TOUCH_ASSETS, userDataPath: app.getPath('userData'), quit: () => app.quit() })
  helper.window.hide()
  await until('!!document.querySelector(".login-card, .app-shell")')
  if (await evaluate('!!document.querySelector(".login-card")')) {
    // Open through the real native command before inspecting the lazy panel.
    await helper.window.webContents.executeJavaScript('window.hasarbotuAssistant.menu()')
    const deadline = Date.now() + 10_000
    while (!await helper.menuWindow.webContents.executeJavaScript('document.body.textContent.includes("hesabınızla giriş yapın")')) {
      if (Date.now() > deadline) throw new Error('Assistant anonymous bootstrap timed out')
      await delay(50)
    }
    check('native assistant starts without a session before main-window login', true)
    await helper.menuWindow.webContents.executeJavaScript('window.hasarbotuAssistantMenu.choose("close")')
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
  helper.show()
  await helper.window.webContents.executeJavaScript('window.savedFeedback = false; window.savedFeedbackOff = window.hasarbotuAssistant.onMotion(value => { if (value.type === "success") window.savedFeedback = true }); undefined')
  await until('!!document.querySelector(".touch-assistant textarea")')
  await fill('.touch-assistant textarea', text, true)
  await until('!!document.querySelector(".touch-assistant button[type=submit]:not(:disabled)")')
  await click('.touch-assistant button[type=submit]')
  await until('document.querySelector(".touch-assistant")?.textContent.includes("Not dosyaya kaydedildi.")')
  check('main-app note save sends confirmed feedback to the actual character', await helper.window.webContents.executeJavaScript('window.savedFeedback'))
  await helper.window.webContents.executeJavaScript('window.savedFeedbackOff(); undefined')
  helper.window.hide()
  await click('[aria-label="Hızlı notu kapat"]')
}
app.disableHardwareAcceleration()
app.enableSandbox()
app.on('window-all-closed', () => { /* The test recreates the shell in the same process. */ })
void app.whenReady().then(async () => {
  try {
    await boot()
    shell.window.show()
    const initialRoute = await evaluate('location.href')
    shell.window.close()
    await delay(100)
    check('main X hides to the tray and keeps Touch alive', !shell.window.isDestroyed() && !shell.window.isVisible() && !shell.window.isMinimized() && !helper.window.isDestroyed())
    helper.menu.items.find(item => item.label === 'HasarBotu’yu aç').click()
    check('tray open restores the same main window and route', shell.window.isVisible() && await evaluate('location.href') === initialRoute)
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
    await evaluate('[...document.querySelectorAll(".case-detail-head__actions button")].find(button => button.textContent === "Dosyayı Kapat").click()')
    await until('!!document.querySelector(".modal--case-lifecycle")')
      await until('!![...document.querySelectorAll(".modal--case-lifecycle button")].find(button => button.textContent === "Önizleme Oluştur" && !button.disabled)')
    check('full case header opens the real close preview dialog', await evaluate('!![...document.querySelectorAll(".modal--case-lifecycle button")].find(button => button.textContent === "Önizleme Oluştur")'))
    await screenshot('case-close-dialog')
    await click('.modal--case-lifecycle [aria-label="Pencereyi kapat"]')
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
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    check('main full-case selection reaches Touch without a second search', await menuEval('document.querySelector(".assistant-search input").value === "" && document.querySelectorAll(".assistant-result").length === 0'))
    await navigate(`/dosyalar/${process.env.HB_TOUCH_OTHER_CASE}`)
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 02")')
    check('changing the main full case updates the existing Touch window', true)
    await shell.window.loadURL(previousRoute)
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    await menuEval('(()=>{ const input=document.querySelector(".assistant-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"34 TEST");input.dispatchEvent(new Event("input",{bubbles:true})) })()')
    await menuEval('document.querySelector(".assistant-search").requestSubmit()')
    await menuUntil('document.querySelectorAll(".assistant-result").length === 2')
    await menuEval('[...document.querySelectorAll(".assistant-result")].find(button=>button.textContent.includes("34 TEST 01")).click()')
    await menuUntil('!!document.querySelector("textarea")')
    check('native assistant searches and selects while main remains hidden', !shell.window.isVisible() && await evaluate('location.href') === previousRoute)
    await menuEval('(()=>{const input=document.querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Dokunmatik kalıcı not.");input.dispatchEvent(new Event("input",{bubbles:true}))})()')
    await menuUntil('!!document.querySelector(".assistant-case form button[type=submit]:not(:disabled)")')
    helper.show()
    await helper.window.webContents.executeJavaScript('window.savedFeedback = false; window.savedFeedbackOff = window.hasarbotuAssistant.onMotion(value => { if (value.type === "success") window.savedFeedback = true }); undefined')
    await menuEval('document.querySelector(".assistant-case form").requestSubmit()')
    await menuUntil('document.body.textContent.includes("Not dosyaya kaydedildi.")')
    check('persisted standalone note sends confirmed feedback to the actual character', await helper.window.webContents.executeJavaScript('window.savedFeedback'))
    await helper.window.webContents.executeJavaScript('window.savedFeedbackOff(); undefined')
    helper.window.hide()
    check('native assistant saves the note without opening the main app', !shell.window.isVisible())
    check('Touch has a folder shortcut and no appearance editor or exit', await menuEval('!![...document.querySelectorAll("button")].find(button=>button.textContent.includes("Klasörü Aç")) && !document.querySelector(".assistant-appearance-editor") && ![...document.querySelectorAll("button")].some(button=>button.textContent === "Çıkış" || button.textContent === "Görünümümü özelleştir")'))
    await navigate(`/dosyalar/${process.env.HB_TOUCH_OTHER_CASE}`)
    shell.window.hide()
    helper.menu.items.find(item => item.label === 'Hızlı not').click()
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 02")')
    await menuEval('[...document.querySelectorAll(".assistant-result")].find(button=>button.textContent.includes("34 TEST 01")).click()')
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    await menuEval('[...document.querySelectorAll(".assistant-native-actions button")].find(button=>button.textContent === "Uygulamayı aç").click()')
    await until(`location.pathname === ${JSON.stringify(`/dosyalar/${process.env.HB_TOUCH_CASE}`)} && document.body.textContent.includes('34 TEST 01')`)
    check('Touch opens its searched case instead of the previously visible other case', shell.window.isVisible())
    shell.window.hide()
    helper.menu.items.find(item => item.label === 'Hızlı not').click()
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    await menuEval('[...document.querySelectorAll(".assistant-native-actions button")].find(button=>button.textContent === "Bildirimler").click()')
    await until(`location.pathname === '/bildirimler' && new URLSearchParams(location.search).get('caseId') === ${JSON.stringify(process.env.HB_TOUCH_CASE)} && document.body.textContent.includes('Touch seçili plaka bildirimi')`)
    check('Touch notifications show the selected case and exclude another case owned by the same user', await evaluate('!document.body.textContent.includes("Touch diğer plaka bildirimi") && document.querySelector(".notification-feed__toolbar a")?.textContent.includes("34 TEST 01")'))
    await screenshot('touch-selected-case-notifications')
    await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent === "Tümünü okundu işaretle").click()')
    await until('document.body.textContent.includes("Hepsi güncel")')
    check('case-scoped bulk read clears only the selected notification feed', true)
    await evaluate('[...document.querySelectorAll(".notification-center__tabs button")].find(button=>button.textContent === "Uyarılar").click()')
    await until('document.querySelectorAll(".notification-card").length > 0')
    check('operational alerts stay scoped to the selected plate', await evaluate('[...document.querySelectorAll(".notification-card__identity strong")].every(item=>item.textContent === "34 TEST 01")'))
    await screenshot('touch-selected-case-alerts')
    const selectedUrl = await evaluate('location.href')
    await menuEval('window.hasarbotuAssistantMenu.choose("open","https://example.test/escape")')
    await delay(100)
    check('native navigation rejects a URL supplied as case identity', await evaluate('location.href') === selectedUrl)
    await navigate('/ayarlar')
    shell.window.show()
    await until('!!document.querySelector(".assistant-appearance-editor")')
    await evaluate('[...document.querySelectorAll(".assistant-palette-presets button")].find(button=>button.textContent==="Yeşil").click()')
    await evaluate('document.querySelector(".assistant-appearance-editor").requestSubmit()')
    await until('document.body.textContent.includes("Touch görünümünüz hesabınıza kaydedildi.")')
    await menuUntil('document.querySelector(".desktop-assistant-panel").style.getPropertyValue("--accent") === "#15803d"')
    check('personal palette changes actual panel styles after API save', await menuEval('document.querySelector(".desktop-assistant-panel").style.getPropertyValue("--accent") === "#15803d"'))
    const mainSessionResponse = await shell.window.webContents.session.fetch(`${shell.origin}/api/v1/me/assistant-appearance`, { credentials: 'include', redirect: 'error' })
    check('main-process update transport retains the authenticated HttpOnly session', mainSessionResponse.ok && (await mainSessionResponse.json()).appearance.accentColor === '#15803d')
    await navigate(`/dosyalar/${process.env.HB_TOUCH_CASE}?tab=operations`)
    shell.window.hide()
    helper.menu.items.find((item) => item.label === 'Hızlı not').click()
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Geçmiş notlar").click()')
    await menuUntil('!![...document.querySelectorAll(".assistant-entry")].find(entry=>entry.textContent.includes("Dokunmatik kalıcı not."))')
    check('native assistant reads committed note history', true)
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Süreçler").click()')
    await menuUntil('document.querySelector(".assistant-process")?.textContent.includes("Onarımda") && document.body.textContent.includes("Tramer talebi yok.")')
    check('native assistant reads effective workflow and tracking state', true)
    for (const theme of ['light','dark']) {
      await menuEval(`document.querySelector('.theme-root').dataset.theme=${JSON.stringify(theme)}`)
      check(`assistant ${theme}: fits work area`, await menuEval('document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").scrollHeight <= innerHeight'))
      await screenshot(`standalone-assistant-${theme}`, helper.menuWindow.webContents)
    }
    helper.menuWindow.webContents.setZoomFactor(1.5)
    await menuUntil('innerWidth <= 280')
    await menuEval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    check('assistant at 150 percent: no horizontal overflow', await menuEval('document.documentElement.scrollWidth <= innerWidth'))
    await screenshot('standalone-assistant-zoom', helper.menuWindow.webContents)
    helper.menuWindow.webContents.setZoomFactor(1)
    await menuUntil('innerWidth === 420')
    await menuEval('document.querySelector("header button").click()')
    shell.window.show()
    shell.window.focus()
    await until('document.querySelector(".case-operations__notes")?.textContent.includes("Dokunmatik kalıcı not.")')
    check('saved note immediately visible in case details', true)
    await navigate('/bildirimler')
    await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Uyarılar").click()')
    await until('!![...document.querySelectorAll("button")].find(button=>button.textContent.includes("Tümünü Okundu İşaretle") && !button.disabled)')
    await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Tümünü Okundu İşaretle")).click()')
    await until('document.body.textContent.includes("0 okunmamış uyarı")')
    check('all warnings read through actual UI and API', true)
    await navigate('/dosyalar')
    await until('document.querySelectorAll(".case-table tbody tr").length === 2')
    await evaluate("[...document.querySelectorAll('.case-table tbody tr')].find(el => el.textContent.includes('34 TEST 02')).click()")
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 02")')
    check('main list row selection automatically updates Touch', true)
    await menuEval('[...document.querySelectorAll(".assistant-result")].find(button=>button.textContent.includes("34 TEST 01")).click()')
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 01")')
    await evaluate("[...document.querySelectorAll('.case-table tbody tr')].find(el => el.textContent.includes('34 TEST 02')).click()")
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 02")')
    check('reselecting the same main row overrides a manual Touch search selection', true)
    check('floating quick note is removed', await evaluate('document.querySelector(".touch-assistant-trigger") === null'))
    await evaluate("[...document.querySelectorAll('.quick-detail__footer button')].find(button => button.textContent.trim() === 'Hızlı Not').click()")
    check('list selection supplies the second case', await evaluate('document.querySelector(".touch-assistant").textContent.includes("34 TEST 02")'))
    await saveNote('Seçili dosyaya not.')
    await shell.close()
    await boot()
    helper.menu.items.find((item) => item.label === 'Hızlı not').click()
    await menuUntil('document.querySelector(".touch-assistant__target")?.textContent.includes("34 TEST 02")')
    await menuUntil('document.querySelector(".desktop-assistant-panel").style.getPropertyValue("--accent") === "#15803d"')
    check('account palette reloads after complete Electron restart', true)
    await menuEval('[...document.querySelectorAll(".assistant-tabs button")].find(button=>button.textContent==="Geçmiş notlar").click()')
    await menuUntil('!![...document.querySelectorAll(".assistant-entry")].find(entry=>entry.textContent.includes("Seçili dosyaya not."))')
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
    await writeFile(join(output, 'results.json'), JSON.stringify({ checks }, null, 2))
    if (checks.every(item => item.pass) && helper) helper.menu.items.find(item => item.label === 'HasarBotu’dan çık').click()
    else { helper?.dispose(); await shell?.close(); app.exit(1) }
  }
})
