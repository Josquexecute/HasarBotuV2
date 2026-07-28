import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { parseDesktopConfig, DesktopConfigError } from './config.js'
import { guardWebContents, startDesktopShell } from './shell.js'

/**
 * Masaüstü kabuğunun giriş noktası (D2).
 *
 * İnce tutulur: yapılandırmayı okur, kabuğu başlatır ve uygulama yaşam
 * döngüsünü bağlar. Karar veren kod `config.ts` ve `security.ts`tedir.
 *
 * Bu pakette code signing, installer ve otomatik güncelleme YOKTUR
 * (kullanıcı talimatı; Paket 21/22 dağıtım kararları).
 *
 * DİKKAT — ESM giriş noktasında ÜST DÜZEY `await` KULLANILMAZ. Electron,
 * giriş modülünün değerlendirmesi bitmeden `ready` olayını yaymaz; üst düzey
 * `await app.whenReady()` yazılırsa uygulama kilitlenir (gerçek Electron ile
 * gözlendi, bkz. DECISION_LOG HB-2026-105). Bu yüzden başlatma `then`
 * içindeki bir fonksiyona alınmıştır.
 */

/**
 * Paketlenmemiş çalıştırmada UI build çıktısı repo kökündeki `dist`tir
 * (`apps/desktop/dist/main` → repo kökü). Paketlenmiş dağıtımda bu yol
 * `HASARBOTU_ASSET_ROOT` ile açıkça verilir; varsayım yapılmaz.
 */
function defaultAssetRoot(): string {
  return fileURLToPath(new URL('../../../../dist/', import.meta.url))
}

/**
 * Ana pencere `startDesktopShell` içinde ayrıca korunur. Bu değer, kabuk
 * ayağa kalktıktan SONRA oluşabilecek türev webContents'ler için
 * karşılaştırma origin'ini taşır.
 */
let shellOrigin: string | undefined

async function bootstrap(): Promise<void> {
  try {
    const config = parseDesktopConfig(process.env, { assetRoot: defaultAssetRoot() })
    const shell = await startDesktopShell(config)
    shellOrigin = shell.origin
  } catch (error) {
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
    if (shellOrigin !== undefined) guardWebContents(contents, shellOrigin)
  })

  app.on('window-all-closed', () => { app.quit() })

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing === undefined) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })

  void app.whenReady().then(bootstrap)
}
