import { app, dialog, shell as electronShell } from 'electron'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseDesktopConfig, DesktopConfigError } from './config.js'
import { runStartupGate, type GateChoice, type GateMessage } from './gate.js'
import { probeApiReadiness } from './readiness.js'
import { DesktopStartupAbortedError, guardWebContents, startDesktopShell } from './shell.js'
import { startDesktopAssistant } from './assistant.js'
import { startDesktopUpdates } from './updates.js'
import { startCaseFolders } from './case-folder.js'
import { hideToTrayOnClose } from './window-lifecycle.js'
import { initializeOfficeConnection, readOfficeConnection } from './office-connection.js'

/**
 * Masaüstü kabuğunun giriş noktası (D2, D3).
 *
 * İnce tutulur: yapılandırmayı okur, başlangıç kapısını Electron iletişim
 * kutusuna bağlar, kabuğu başlatır ve uygulama yaşam döngüsünü bağlar. Karar
 * veren kod `config.ts`, `security.ts`, `external.ts`, `downloads.ts`,
 * `compatibility.ts` ve `gate.ts`tedir.
 *
 * Windows NSIS installer'ı var (`apps/desktop/package.json`daki `build`
 * alanı, `electron-builder`). Kullanıcı başlatmalı güncelleme, kimlik
 * doğrulanan API yayını ve dosya bütünlük denetimiyle `updates.ts`tedir.
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
    const office = app.isPackaged ? readOfficeConnection(join(process.resourcesPath, 'office-connection.json')) : undefined
    const restartOrigin = app.commandLine.getSwitchValue('hasarbotu-api-origin')
    const config = parseDesktopConfig({ ...process.env, ...(restartOrigin ? { HASARBOTU_API_ORIGIN: restartOrigin } : {}) }, { assetRoot: defaultAssetRoot(), ...(office ? { apiOrigin: office.apiOrigin } : {}) })
    let connectionSetup: string | undefined
    if (office && config.apiOrigin === office.apiOrigin && !(await probeApiReadiness({ apiOrigin: config.apiOrigin })).ready) {
      const result = await initializeOfficeConnection(join(process.resourcesPath, 'initialize-office-connection.ps1'))
      connectionSetup = result.status
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(join(app.getPath('userData'), 'connection-setup-status.json'), JSON.stringify({ version: app.getVersion(), status: result.status, checkedAt: new Date().toISOString() }))
    }
    const shell = await startDesktopShell({
      ...config,
      userDataPath: app.getPath('userData'),
      // Kapı köprü origin'ini alır ama API'yi DOĞRUDAN sorgular: `/health`
      // sürümlü `/api/v1` tabanının dışındadır ve köprü yalnız `/api/*` iletir.
      startupGate: () => runStartupGate({
        probe: async () => {
          const result = await probeApiReadiness({ apiOrigin: config.apiOrigin })
          // Record only credential-free configuration and the classified outcome.
          // This makes startup/restart failures diagnosable without reading sessions.
          await writeFile(join(app.getPath('userData'), 'startup-status.json'), JSON.stringify({
            version: app.getVersion(), apiOrigin: config.apiOrigin, ...result, checkedAt: new Date().toISOString(),
          })).catch(() => { console.error('desktop startup status could not be recorded') })
          return result
        },
        prompt: (message, result) => promptGate(connectionSetup && result.outcome === 'unreachable' ? {
          ...message,
          detail: connectionSetup === 'approval_declined'
            ? 'Ofis bağlantısını tanımlamak için Windows izin ekranı onaylanmalı. Uygulamayı yeniden açıp izni onaylayın.'
            : connectionSetup === 'existing_dns_conflict'
              ? 'Bilgisayarda ofis bağlantısıyla çakışan bir adres kaydı var. Ağ yöneticinizin kontrol etmesi gerekiyor.'
              : 'Ofis ağına bağlanın. Ofis dışındaysanız Tailscale bağlantısını açıp yeniden deneyin.',
        } : message),
      }),
      openExternal: (url) => electronShell.openExternal(url),
    })
    shellOrigin = shell.origin
    mainWindow = shell.window
    hideToTrayOnClose(app, shell.window)
    startDesktopUpdates(shell, config.apiOrigin)
    const assistant = await startDesktopAssistant({ shell, assetRoot: config.assetRoot, userDataPath: app.getPath('userData'), quit: () => app.quit() })
    startCaseFolders(shell, app.getPath('userData'), app.isPackaged ? join(process.resourcesPath, 'folder-roots.json') : join(app.getAppPath(), 'build-resources', 'office-folder-roots.json'), config.apiOrigin, assistant.menuWindow)
    shell.window.once('closed', () => app.quit())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      dialog.showErrorBox('HasarBotu V2', 'Uygulamanın kayıtlı yerel portu başka bir işlem tarafından kullanılıyor. İlgili işlemi kapatıp yeniden deneyin. Taslakları korumak için port değiştirilmedi.')
    }
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
