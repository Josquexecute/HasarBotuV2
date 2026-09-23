import { BrowserWindow, shell as electronShell, type Session } from 'electron'
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
import { resolveExternalOpen } from './external.js'
import { resolveDownload, sanitizeDownloadFilename } from './downloads.js'

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

/**
 * URL'i işletim sistemi tarayıcısına devreden işlem. Varsayılanı Electron'un
 * `shell.openExternal`'ıdır; kabuğun bileşim (composition) dikişidir ve
 * doğrulamada gerçek tarayıcı açmadan gözlemlenebilmesi için enjekte
 * edilebilir. Politika kararı buraya GİRMEZ — o `external.ts`tedir.
 */
export type OpenExternalFn = (url: string) => Promise<void>

export interface DesktopShellOptions {
  /** Köprünün `/api/*` isteklerini ileteceği API kökü. */
  readonly apiOrigin: string
  /** Renderer'a sunulacak UI build çıktısı dizini. */
  readonly assetRoot: string
  /** Köprünün dinleyeceği loopback portu; `0` boş port seçtirir. */
  readonly bridgePort?: number
  /** Pencere görünür açılsın mı? Otomatik doğrulamada `false` kullanılır. */
  readonly show?: boolean
  /**
   * Köprü ayağa kalktıktan SONRA, pencere AÇILMADAN ÖNCE çalışan başlangıç
   * kapısı (D3: API hazırlığı ve sürüm uyumu). `abort` dönerse köprü kapatılır
   * ve pencere HİÇ açılmaz. Verilmezse kapı çalıştırılmaz.
   */
  readonly startupGate?: (bridgeOrigin: string) => Promise<'proceed' | 'abort'>
  /** Harici bağlantı devri; varsayılan Electron `shell.openExternal`. */
  readonly openExternal?: OpenExternalFn
}

/** Başlangıç kapısı pencereyi açmayı reddettiğinde atılır. */
export class DesktopStartupAbortedError extends Error {
  constructor() {
    super('desktop startup gate aborted')
    this.name = 'DesktopStartupAbortedError'
  }
}

export interface DesktopShell {
  /** Renderer'ın yüklediği TEK origin. */
  readonly origin: string
  readonly window: BrowserWindow
  close(): Promise<void>
}

/** Kabul edilmiş masaüstü yönü: 1366×768 alt sınırında çalışabilir olmalı. */
const MINIMUM_WIDTH = 360
const MINIMUM_HEIGHT = 480
const DEFAULT_WIDTH = 1_600
const DEFAULT_HEIGHT = 900

function preloadPath(): string {
  return fileURLToPath(new URL('../preload/preload.cjs', import.meta.url))
}

/**
 * Oturum (session) sertleştirmesi. Pencere YÜKLENMEDEN ÖNCE uygulanır ki
 * ilk doküman isteği bile politikasız kalmasın.
 */
export function hardenSession(session: Session): void {
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
 * İndirme yönetimi (D3).
 *
 * İki kural uygulanır:
 *   1. İndirme kabuğun KENDİ origin'inden başlamalıdır; aksi hâlde iptal.
 *      UI'ın rapor/Excel akışları `blob:` URL'i kabuk origin'i üzerinde
 *      oluşturur, yani meşru akışlar bu kapıdan geçer.
 *   2. Sunucudan gelen dosya adı işletim sistemi için güvenli hâle getirilir
 *      ve KAYDETME KUTUSUNA ön ad olarak verilir.
 *
 * Kabuk kaydetme yolunu KENDİSİ seçmez: `setSavePath` çağrılmaz, dolayısıyla
 * kullanıcı onayı olmadan diske hiçbir şey yazılmaz.
 */
function configureDownloads(session: Session, shellOrigin: string): void {
  session.on('will-download', (event, item) => {
    const decision = resolveDownload(item.getURL(), shellOrigin)
    if (decision.action === 'cancel') {
      event.preventDefault()
      return
    }
    item.setSaveDialogOptions({ defaultPath: sanitizeDownloadFilename(item.getFilename()) })
  })
}

/**
 * Bir `webContents` üzerindeki navigasyon ve pencere açma kapıları.
 * Ana pencere ve (yine de oluşursa) türev içerikler için aynı kural geçerlidir.
 *
 * D3: kabuk origin'i DIŞINDAKİ bir hedef artık koşulsuz reddedilmez; önce
 * `external.ts` allowlist'ine sorulur. İzin verilirse hedef İŞLETİM SİSTEMİ
 * tarayıcısına devredilir — Electron içinde HİÇBİR yeni pencere açılmaz, yani
 * uzak içerik kabuğun içine asla girmez.
 */
export function guardWebContents(
  contents: Electron.WebContents,
  shellOrigin: string,
  openExternal: OpenExternalFn,
): void {
  const handOff = (url: string): boolean => {
    const decision = resolveExternalOpen(url)
    if (decision.action === 'deny') return false
    // Hata yutulmaz ama kullanıcı akışını da kesmez: işletim sistemi
    // devretmeyi reddederse kabuk çalışmaya devam eder.
    void openExternal(decision.url).catch(() => {
      console.error('desktop shell could not hand the link to the operating system')
    })
    return true
  }

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWindowOpen(url)) return { action: 'allow' }
    handOff(url)
    // Devredilmiş olsun ya da olmasın, Electron penceresi AÇILMAZ.
    return { action: 'deny' }
  })

  const blockNavigation = (event: Electron.Event, url: string): void => {
    if (isAllowedNavigationUrl(url, shellOrigin)) return
    event.preventDefault()
    handOff(url)
  }
  contents.on('will-navigate', blockNavigation)
  contents.on('will-frame-navigate', (event) => {
    if (isAllowedNavigationUrl(event.url, shellOrigin)) return
    event.preventDefault()
    // Alt çerçeve navigasyonu işletim sistemine DEVREDİLMEZ: kullanıcının
    // tıkladığı üst düzey bir bağlantı değildir.
  })
  contents.on('will-redirect', blockNavigation)
  // `webviewTag: false` zaten kapalı tutar; attach denemesi yine de reddedilir.
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
}

/**
 * Köprüyü başlatır, başlangıç kapısını çalıştırır, güvenli pencereyi açar ve
 * TEK origin'i yükler.
 *
 * Pencere yüklenmeden önce oturum sertleştirmesi, indirme yönetimi ve
 * navigasyon kapıları kurulur. Herhangi bir adım başarısız olursa köprü
 * kapatılır; yarım bir kabuk açık bırakılmaz.
 */
export async function startDesktopShell(options: DesktopShellOptions): Promise<DesktopShell> {
  const openExternal: OpenExternalFn = options.openExternal
    ?? ((url) => electronShell.openExternal(url))

  const bridge: DesktopBridge = await startDesktopBridge({
    apiOrigin: options.apiOrigin,
    assetRoot: options.assetRoot,
    ...(options.bridgePort === undefined ? {} : { port: options.bridgePort }),
  })

  // Kapı pencereden ÖNCE çalışır: uyumsuz ya da erişilemez bir API'ye karşı
  // yarım çalışan bir pencere açılmaz.
  if (options.startupGate !== undefined) {
    let outcome: 'proceed' | 'abort'
    try {
      outcome = await options.startupGate(bridge.origin)
    } catch (error) {
      await bridge.close()
      throw error
    }
    if (outcome === 'abort') {
      await bridge.close()
      throw new DesktopStartupAbortedError()
    }
  }

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
    configureDownloads(window.webContents.session, bridge.origin)
    guardWebContents(window.webContents, bridge.origin, openExternal)

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
