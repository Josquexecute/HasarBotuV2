import { BrowserWindow, type Session } from 'electron'
import { fileURLToPath } from 'node:url'
import { startDesktopBridge, type DesktopBridge } from '@hasarbotu/desktop-bridge'
import {
  CONTENT_SECURITY_POLICY,
  SECURE_WEB_PREFERENCES,
  isAllowedNavigationUrl,
  isAllowedPermission,
  isAllowedWindowOpen,
  withSecurityHeaders,
} from './security.js'

/**
 * İnce Electron kabuğu (ADR-Q06, Paket 21 / D2).
 *
 * Kabuk YALNIZ üç şey yapar:
 *   1. Loopback aynı-origin köprüsünü başlatır (`@hasarbotu/desktop-bridge`).
 *   2. Güvenli bir `BrowserWindow` açar ve o TEK origin'i yükler.
 *   3. `security.ts`teki kararları Electron API'lerine bağlar.
 *
 * Kabukta İŞ MANTIĞI YOKTUR. Bu kural Paket 21'in geri alma stratejisinin
 * ("desktop paketini kaldır, web dağıtımını kullan") geçerli kalmasının tek
 * şartıdır: kabukta iş mantığı biriktiği anda strateji geçersizleşir.
 *
 * Kabuk ayrıca `ipcMain` handler'ı KAYDETMEZ. Renderer'ın ayrıcalıklı hiçbir
 * çağrı yüzeyi yoktur; UI verisini bugün olduğu gibi göreli `/api/...`
 * üzerinden alır. Preload yalnız veri taşıyan, işlevsiz bir tanıtıcı sunar.
 */

export interface DesktopShellOptions {
  /** Köprünün `/api/*` isteklerini ileteceği API kökü. */
  readonly apiOrigin: string
  /** Renderer'a sunulacak UI build çıktısı dizini. */
  readonly assetRoot: string
  /** Köprünün dinleyeceği loopback portu; `0` boş port seçtirir. */
  readonly bridgePort?: number
  /** Pencere görünür açılsın mı? Otomatik doğrulamada `false` kullanılır. */
  readonly show?: boolean
}

export interface DesktopShell {
  /** Renderer'ın yüklediği TEK origin. */
  readonly origin: string
  readonly window: BrowserWindow
  close(): Promise<void>
}

/** Kabul edilmiş masaüstü yönü: 1366×768 alt sınırında çalışabilir olmalı. */
const MINIMUM_WIDTH = 1_280
const MINIMUM_HEIGHT = 720
const DEFAULT_WIDTH = 1_600
const DEFAULT_HEIGHT = 900

function preloadPath(): string {
  return fileURLToPath(new URL('../preload/preload.cjs', import.meta.url))
}

/**
 * Oturum (session) sertleştirmesi. Pencere YÜKLENMEDEN ÖNCE uygulanır ki
 * ilk doküman isteği bile politikasız kalmasın.
 */
function hardenSession(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = withSecurityHeaders(details.responseHeaders, details.resourceType)
    // `undefined` = bu yanıt bizim ilgi alanımızda değil; başlıklar aynen kalır.
    callback(responseHeaders === undefined ? {} : { responseHeaders })
  })

  // Kamera/mikrofon/konum/bildirim/pano gibi hiçbir yetenek açılmaz.
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  session.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler(() => {
    // Ekran paylaşımı isteği karşılıksız bırakılır; kaynak seçilmez.
  })
}

/**
 * Bir `webContents` üzerindeki navigasyon ve pencere açma kapıları.
 * Ana pencere ve (yine de oluşursa) türev içerikler için aynı kural geçerlidir.
 */
export function guardWebContents(contents: Electron.WebContents, shellOrigin: string): void {
  contents.setWindowOpenHandler(({ url }) => (
    isAllowedWindowOpen(url) ? { action: 'allow' } : { action: 'deny' }
  ))

  const blockNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedNavigationUrl(url, shellOrigin)) event.preventDefault()
  }
  contents.on('will-navigate', blockNavigation)
  contents.on('will-frame-navigate', (event) => {
    if (!isAllowedNavigationUrl(event.url, shellOrigin)) event.preventDefault()
  })
  contents.on('will-redirect', blockNavigation)
  // `webviewTag: false` zaten kapalı tutar; attach denemesi yine de reddedilir.
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
}

/**
 * Köprüyü başlatır, güvenli pencereyi açar ve TEK origin'i yükler.
 *
 * Pencere yüklenmeden önce oturum sertleştirmesi ve navigasyon kapıları
 * kurulur. Herhangi bir adım başarısız olursa köprü kapatılır; yarım bir
 * kabuk açık bırakılmaz.
 */
export async function startDesktopShell(options: DesktopShellOptions): Promise<DesktopShell> {
  const bridge: DesktopBridge = await startDesktopBridge({
    apiOrigin: options.apiOrigin,
    assetRoot: options.assetRoot,
    ...(options.bridgePort === undefined ? {} : { port: options.bridgePort }),
  })

  let window: BrowserWindow
  try {
    window = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MINIMUM_WIDTH,
      minHeight: MINIMUM_HEIGHT,
      show: options.show ?? true,
      backgroundColor: '#111111',
      title: 'HasarBotu V2',
      autoHideMenuBar: true,
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        preload: preloadPath(),
      },
    })

    hardenSession(window.webContents.session)
    guardWebContents(window.webContents, bridge.origin)

    await window.loadURL(bridge.origin)
  } catch (error) {
    await bridge.close()
    throw error
  }

  return {
    origin: bridge.origin,
    window,
    async close() {
      if (!window.isDestroyed()) window.destroy()
      await bridge.close()
    },
  }
}

export { CONTENT_SECURITY_POLICY }
