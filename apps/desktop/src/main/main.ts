import { app, dialog, shell as electronShell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDesktopConfig, DesktopConfigError } from './config.js'
import { runStartupGate, type GateChoice, type GateMessage } from './gate.js'
import { probeApiReadiness } from './readiness.js'
import { DesktopStartupAbortedError, guardWebContents, startDesktopShell } from './shell.js'
import { startDesktopAssistant } from './assistant.js'

/**
 * Masaüstü kabuğunun giriş noktası (D2, D3).
 *
 * İnce tutulur: yapılandırmayı okur, başlangıç kapısını Electron iletişim
 * kutusuna bağlar, kabuğu başlatır ve uygulama yaşam döngüsünü bağlar. Karar
 * veren kod `config.ts`, `security.ts`, `external.ts`, `downloads.ts`,
 * `compatibility.ts` ve `gate.ts`tedir.
 *
 * Windows NSIS installer'ı var (`apps/desktop/package.json`daki `build`
 * alanı, `electron-builder`) ama code signing ve otomatik güncelleme
 * HÂLÂ YOKTUR (kullanıcı talimatı; imzasız ilk dahili sürüm, Paket 21/22
 * dağıtım kararlarının bir sonraki dilimi).
 *
 * DİKKAT — ESM giriş noktasında ÜST DÜZEY `await` KULLANILMAZ. Electron,
 * giriş modülünün değerlendirmesi bitmeden `ready` olayını yaymaz; üst düzey
 * `await app.whenReady()` yazılırsa uygulama kilitlenir (gerçek Electron ile
 * gözlendi, bkz. DECISION_LOG HB-2026-105). Bu yüzden başlatma `then`
 * içindeki bir fonksiyona alınmıştır.
 */

/**
 * Paketlenmemiş çalıştırmada UI build çıktısı repo kökündeki `dist`tir
 * (`apps/desktop/dist/main` → repo kökü). Paketlenmiş (NSIS) dağıtımda
 * `electron-builder`in `extraResources` kuralı aynı `dist/`i
 * `process.resourcesPath/dist`e kopyalar (bkz. `package.json`daki `build`
 * alanı) -- `app.isPackaged` burada sabit kod-yolu SEÇER, rastgele bir yol
 * kabul etmez. `HASARBOTU_ASSET_ROOT` ortam değişkeni her iki modda da
 * (`parseDesktopConfig` üzerinden) öncelik taşımaya devam eder.
 */
function defaultAssetRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'dist')
  return fileURLToPath(new URL('../../../../dist/', import.meta.url))
}

/**
 * Ana pencere `startDesktopShell` içinde ayrıca korunur. Bu değer, kabuk
 * ayağa kalktıktan SONRA oluşabilecek türev webContents'ler için
 * karşılaştırma origin'ini taşır.
 */
let shellOrigin: string | undefined
let mainWindow: Electron.BrowserWindow | undefined

/**
 * Kapının kullanıcıya sorusu. Modal pencere henüz YOKTUR (pencere kapıdan
 * sonra açılır), bu yüzden penceresiz `showMessageBox` kullanılır.
 */
async function promptGate(message: GateMessage): Promise<GateChoice> {
  const response = await dialog.showMessageBox({
    type: 'warning',
    // Ana pencere başlığından AYRI tutulur: kullanıcı (ve otomatik doğrulama)
    // görev çubuğunda kapıyı uygulama penceresinden ayırt edebilmelidir.
    title: 'HasarBotu V2 — Sunucu denetimi',
    message: message.title,
    detail: message.detail,
    buttons: ['Yeniden dene', 'Kapat'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  return response.response === 0 ? 'retry' : 'close'
}

async function bootstrap(): Promise<void> {
  try {
    const config = parseDesktopConfig(process.env, { assetRoot: defaultAssetRoot() })
    const shell = await startDesktopShell({
      ...config,
      // Kapı köprü origin'ini alır ama API'yi DOĞRUDAN sorgular: `/health`
      // sürümlü `/api/v1` tabanının dışındadır ve köprü yalnız `/api/*` iletir.
      startupGate: () => runStartupGate({
        probe: () => probeApiReadiness({ apiOrigin: config.apiOrigin }),
        prompt: promptGate,
      }),
      openExternal: (url) => electronShell.openExternal(url),
    })
    shellOrigin = shell.origin
    mainWindow = shell.window
    await startDesktopAssistant({ shell, assetRoot: config.assetRoot, userDataPath: app.getPath('userData'), quit: () => app.quit() })
    // Closing the main window still exits; minimizing leaves the assistant available.
    shell.window.once('closed', () => app.quit())
  } catch (error) {
    if (error instanceof DesktopStartupAbortedError) {
      // Kullanıcının kendi kararı; hata değil.
      app.exit(0)
      return
    }
    // Yapılandırma hatasında sessizce yarım bir kabuk açılmaz. Hata mesajı
    // yalnız alan adı ve kuralı taşır (bkz. `config.ts`).
    if (error instanceof DesktopConfigError) console.error(error.message)
    else console.error('desktop shell failed to start')
    app.exit(1)
  }
}

/** Tek örnek kilidi: ikinci bir kabuk ikinci bir köprü portu açmasın. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // OS sandbox'ı tüm renderer'lar için zorunlu kılınır.
  app.enableSandbox()

  // Kabuk içinde oluşan HER webContents aynı kapılardan geçer.
  app.on('web-contents-created', (_event, contents) => {
    if (shellOrigin !== undefined) {
      guardWebContents(contents, shellOrigin, (url) => electronShell.openExternal(url))
    }
  })

  app.on('window-all-closed', () => { app.quit() })

  app.on('second-instance', () => {
    const existing = mainWindow
    if (existing === undefined || existing.isDestroyed()) return
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
  })

  void app.whenReady().then(bootstrap)
}
