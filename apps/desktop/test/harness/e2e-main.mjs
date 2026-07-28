import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'

/**
 * D2 e2e koşum aracı — GERÇEK Electron/Chromium içinde çalışır.
 *
 * Üretim kabuğunun ta kendisini (`startDesktopShell`) başlatır; test için
 * gevşetilmiş bir kopya KURMAZ. Ürün kodunda test kancası yoktur: bu dosya
 * yalnız kabuğu ayağa kaldırır, sayfanın kendi topladığı sonuçları okur ve
 * main process'ten gözlenebilen olguları JSON olarak diske yazar.
 *
 * Sonuçlar dosya üzerinden döner; stdout Chromium/GPU gürültüsü taşıdığı için
 * güvenilir bir kanal değildir.
 *
 * DİKKAT — ÜST DÜZEY `await` YOK: Electron, ESM giriş modülünün
 * değerlendirmesi bitmeden `ready` yaymaz; `await app.whenReady()` üst düzeyde
 * yazılırsa süreç kilitlenir (bkz. `src/main/main.ts` ve HB-2026-105).
 */

const resultPath = process.env.HB_E2E_RESULT
const mode = process.env.HB_E2E_MODE ?? 'probe'
const apiOrigin = process.env.HASARBOTU_API_ORIGIN
const assetRoot = process.env.HASARBOTU_ASSET_ROOT
const email = process.env.HB_E2E_EMAIL ?? ''
const password = process.env.HB_E2E_PASSWORD ?? ''
const downloadDir = process.env.HB_E2E_DOWNLOAD_DIR ?? ''
const foreignDownloadUrl = process.env.HB_E2E_FOREIGN_DOWNLOAD_URL ?? ''

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollUntil(read, isDone, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (isDone(last)) return last
    await delay(120)
  }
  return last
}

/** GPU/pencere yönetimi olmayan ortamlarda kararlı koşum. */
app.disableHardwareAcceleration()
app.enableSandbox()

const result = { mode, consoleMessages: [], loadFailures: [], openedExternally: [], downloads: [] }

/**
 * `shell.openExternal` yerine geçen kaydedici. Gerçek tarayıcı AÇILMAZ;
 * kabuğun KARARI ve işletim sistemine verdiği URL doğrudan gözlenir.
 * Politikanın kendisi (`external.ts`) ayrıca birim testlidir.
 */
async function recordExternalOpen(url) {
  result.openedExternally.push(url)
}

/**
 * Kabuğun `will-download` işleyicisinden SONRA kaydedilir; kabuk iptal
 * ettiyse bu dinleyici de aynı `item`i görür ve son durumu `done` olayından
 * okur. İzin verilen indirmeye kaydetme yolu burada verilir ki otomatik
 * koşumda kaydetme kutusu açılıp süreci kilitlemesin.
 */
function observeDownloads(session) {
  session.on('will-download', (_event, item) => {
    const record = { url: item.getURL(), filename: item.getFilename(), state: 'pending' }
    result.downloads.push(record)
    if (downloadDir !== '') item.setSavePath(join(downloadDir, `indirme-${result.downloads.length}.bin`))
    item.once('done', (__event, state) => { record.state = state })
  })
}

async function collectProbeMode(contents) {
  // Sayfanın KENDİ topladığı sonuçlar. `executeJavaScript` CSP'yi atladığı
  // için CSP ve preload kanıtları sayfanın İÇİNDE üretilir; burada yalnız
  // okunur.
  const raw = await pollUntil(
    () => contents.executeJavaScript('window.__hb && window.__hb.done ? JSON.stringify(window.__hb) : null'),
    (value) => typeof value === 'string',
  )
  result.probe = typeof raw === 'string' ? JSON.parse(raw) : null

  // İndirme sayfadan başlatılır — UI'ın rapor/Excel akışıyla aynı biçim:
  // `URL.createObjectURL` + `<a download>`. Tetikleme buradan yapılır ki
  // gözlemci dinleyicisi kesinlikle kurulmuş olsun.
  await contents.executeJavaScript(`(() => {
    const blob = new Blob(['D3-INDIRME-KANITI'], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '../../kotu ad.xlsx'
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  })()`)

  await pollUntil(
    async () => result.downloads,
    (downloads) => downloads.length > 0 && downloads.every((item) => item.state !== 'pending'),
    15_000,
  )

  // Kabuk origin'i DIŞINDAN indirme: gerçek bir yanıt üreten yabancı sunucu.
  if (foreignDownloadUrl !== '') {
    const before = result.downloads.length
    contents.downloadURL(foreignDownloadUrl)
    await pollUntil(
      async () => result.downloads,
      (downloads) => downloads.length > before && downloads[before].state !== 'pending',
      15_000,
    )
  }

  // Sayfa başlatmalı uzak gezinme denemesi: adres değişmemeli.
  await contents.executeJavaScript("window.location.href = 'https://ornek.gecersiz.example/'; true")
  await delay(1_500)
  result.urlAfterNavigationAttempt = contents.getURL()
  result.windowCountAfterOpenAttempt = BrowserWindow.getAllWindows().length
}

async function collectRealUiMode(contents) {
  // GERÇEK üretim UI build'i: kabuğun CSP'si altında açılıyor mu ve gerçek
  // login formu gerçek oturumu açıyor mu?
  const mounted = await pollUntil(
    () => contents.executeJavaScript(
      'JSON.stringify({ root: document.querySelector("#root") ? document.querySelector("#root").childElementCount : 0,'
      + ' login: !!document.querySelector(".login-card"), shell: !!document.querySelector(".app-shell") })',
    ),
    (value) => typeof value === 'string' && (JSON.parse(value).login === true || JSON.parse(value).shell === true),
  )
  result.beforeLogin = typeof mounted === 'string' ? JSON.parse(mounted) : null
  result.cookieVisibleToPage = await contents.executeJavaScript('document.cookie')

  // React kontrollü input'lara yazmak için yerel `value` setter'ı + `input`
  // olayı gerekir; doğrudan `element.value = ...` React state'ini güncellemez.
  result.loginFormAction = await contents.executeJavaScript(`(() => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const emailInput = document.querySelector('.login-card input[name="email"]')
    const passwordInput = document.querySelector('.login-card input[name="password"]')
    const submit = document.querySelector('.login-card button[type="submit"]')
    if (!emailInput || !passwordInput || !submit) return 'form-missing'
    setValue(emailInput, ${JSON.stringify(email)})
    setValue(passwordInput, ${JSON.stringify(password)})
    submit.click()
    return 'submitted'
  })()`)

  const afterLogin = await pollUntil(
    () => contents.executeJavaScript(
      'JSON.stringify({ shell: !!document.querySelector(".app-shell"), login: !!document.querySelector(".login-card"),'
      + ' error: (document.querySelector(".login-card__error") || {}).textContent || null })',
    ),
    (value) => typeof value === 'string'
      && (JSON.parse(value).shell === true || typeof JSON.parse(value).error === 'string'),
  )
  result.afterLogin = typeof afterLogin === 'string' ? JSON.parse(afterLogin) : null
  result.cookieVisibleToPageAfterLogin = await contents.executeJavaScript('document.cookie')

  // Tarayıcının KENDİ çerez kaydı: HttpOnly + SameSite=Strict gerçekten
  // Chromium tarafından mı uygulanıyor?
  const cookies = await contents.session.cookies.get({ name: 'hb_session' })
  result.browserCookies = cookies.map((cookie) => ({
    name: cookie.name,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
    secure: cookie.secure === true,
    path: cookie.path,
    domain: cookie.domain,
    hasValue: typeof cookie.value === 'string' && cookie.value.length > 0,
  }))
}

async function run() {
  let shell
  try {
    shell = await startDesktopShell({
      apiOrigin,
      assetRoot,
      show: false,
      openExternal: recordExternalOpen,
    })
    result.shellOrigin = shell.origin

    const contents = shell.window.webContents
    observeDownloads(contents.session)
    contents.on('console-message', (...args) => {
      // Electron 36+ tek olay nesnesi verir; eski imza (event, level, message).
      const event = args[0]
      const message = typeof event === 'object' && event !== null && 'message' in event
        ? event.message
        : args[2]
      if (typeof message === 'string') result.consoleMessages.push(message)
    })
    contents.on('did-fail-load', (_event, code, description, url) => {
      result.loadFailures.push({ code, description, url })
    })

    // `startDesktopShell` içindeki `loadURL` zaten `did-finish-load` ile
    // çözülür; burada o olayı BEKLEMEK sonsuza kadar asılı kalmak demektir
    // (olay çoktan yayılmıştır). Alt kaynakların yüklenmesi aşağıdaki
    // `pollUntil` ile beklenir.

    // Main process'ten DOĞRUDAN gözlenen kabuk olguları.
    const preferences = contents.getLastWebPreferences() ?? {}
    result.webPreferences = {
      nodeIntegration: preferences.nodeIntegration === true,
      contextIsolation: preferences.contextIsolation !== false,
      sandbox: preferences.sandbox !== false,
      webSecurity: preferences.webSecurity !== false,
      webviewTag: preferences.webviewTag === true,
    }
    result.loadedUrl = contents.getURL()
    result.windowCountAfterLoad = BrowserWindow.getAllWindows().length

    if (mode === 'probe') await collectProbeMode(contents)
    else await collectRealUiMode(contents)
  } catch (error) {
    result.fatalError = error instanceof Error ? error.message : String(error)
  }

  try {
    if (shell !== undefined) await shell.close()
  } catch {
    // Kapanış hatası sonucu geçersiz kılmaz; sonuç zaten toplandı.
  }

  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8')
  app.exit(result.fatalError === undefined ? 0 : 1)
}

app.whenReady().then(run).catch(async (error) => {
  result.fatalError = error instanceof Error ? error.message : String(error)
  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8')
  app.exit(1)
})
