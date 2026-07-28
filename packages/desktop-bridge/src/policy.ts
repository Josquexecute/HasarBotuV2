/**
 * Loopback aynı-origin köprüsünün SAF politika katmanı (D1).
 *
 * Köprünün tek amacı, masaüstü kabuğunda renderer'ın gördüğü origin sayısını
 * BİRE indirmektir. Renderer `http://127.0.0.1:{bridgePort}` dokümanını yükler
 * ve mevcut adapter'lar göreli `/api/...` çağırmaya DEVAM eder; köprü bu
 * istekleri API origin'ine sunucu-sunucu iletir. Böylece:
 *
 * - Tarayıcı için istek AYNI ORIGIN'dir; `SameSite=Strict` oturum çerezi
 *   taşınır ve CORS gerekmez.
 * - API'de CORS, CSRF token veya static dosya sunumu AÇILMAZ.
 * - 28 HTTP adapter'ın `baseUrl` sözleşmesi değişmez.
 *
 * Bu modül ağ G/Ç yapmaz ve Electron'a bağımlı değildir; yalnız kararları
 * verir. Gerçek sunucu `bridge.ts`tedir.
 */

/** Köprünün API'ye ileteceği yol öneki. Adapter'lar zaten bu öneki kullanır. */
export const API_PATH_PREFIX = '/api'

const BACKSLASH = String.fromCharCode(92)

/** `C:`, `c:` gibi Windows sürücü öneki. Segment bazında uygulanır. */
const DRIVE_PREFIX = /^[a-zA-Z]:/

/** Kontrol karakteri (C0 0-31, DEL 127, C1 128-159) ve null byte. */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

/**
 * RFC 9110 hop-by-hop başlıkları: bir bağlantıya aittir, iletilmez. `host`
 * ayrıca yeniden yazılır (upstream origin'in kendi host'u kullanılır).
 */
export const HOP_BY_HOP_HEADERS: readonly string[] = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

const HOP_BY_HOP = new Set(HOP_BY_HOP_HEADERS)

/** İstek `/api` altında mı? `/apiX` gibi komşu yollar API sayılmaz. */
export function isApiPath(pathname: string): boolean {
  return pathname === API_PATH_PREFIX || pathname.startsWith(`${API_PATH_PREFIX}/`)
}

/**
 * Yerel HTTP sunucusu için DNS rebinding koruması. Tarayıcı dışı bir sayfa
 * `http://kotu.example` üzerinden 127.0.0.1'e istek atarsa `Host` başlığı
 * loopback OLMAZ; bu istek reddedilir. Port verildiyse ayrıca eşleşmelidir.
 */
export function isAllowedBridgeHost(hostHeader: string | undefined, expectedPort: number): boolean {
  if (hostHeader === undefined) return false
  const trimmed = hostHeader.trim().toLowerCase()
  // IPv6 literal biçimi: `[::1]:port`
  const match = trimmed.startsWith('[')
    ? /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed)
    : /^([^:]+)(?::(\d+))?$/.exec(trimmed)
  if (match === null) return false
  const host = match[1] as string
  const port = match[2]
  if (port !== undefined && Number(port) !== expectedPort) return false
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/**
 * Upstream'e gidecek başlıkları üretir. `cookie` KORUNUR — oturum çerezinin
 * API'ye ulaşması köprünün varlık sebebidir. `host` upstream authority ile
 * değiştirilir; hop-by-hop başlıklar düşürülür.
 *
 * `origin`/`referer` OLDUĞU GİBİ iletilir: köprü şeffaf bir vekildir, kimlik
 * uydurmaz. API bugün origin denetimi yapmaz (CORS/CSRF yok); ileride bir
 * origin denetimi eklenirse köprü origin'i açıkça allowlist'e alınmalıdır.
 */
export function buildUpstreamHeaders(
  incoming: Readonly<Record<string, string | string[] | undefined>>,
  upstreamHost: string,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [rawName, value] of Object.entries(incoming)) {
    if (value === undefined) continue
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP.has(name) || name === 'host') continue
    headers[name] = value
  }
  headers.host = upstreamHost
  return headers
}

/**
 * İstemciye dönecek başlıkları üretir. `set-cookie` DİZİ olarak, HİÇ
 * DEĞİŞTİRİLMEDEN aktarılır — `SameSite=Strict`, `HttpOnly`, `Path`, `Secure`
 * ve `Max-Age` nitelikleri korunur. Köprü hiçbir CORS başlığı EKLEMEZ.
 */
export function buildDownstreamHeaders(
  upstream: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [rawName, value] of Object.entries(upstream)) {
    if (value === undefined) continue
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP.has(name)) continue
    headers[name] = value
  }
  return headers
}

export type AssetPathRejection =
  | 'not_decodable'
  | 'control_character'
  | 'backslash'
  | 'absolute_or_drive'
  | 'traversal'

export type AssetPathResult =
  | { readonly ok: true; readonly segments: readonly string[] }
  | { readonly ok: false; readonly reason: AssetPathRejection }

/**
 * URL yolunu güvenli göreli segmentlere çevirir. Depolama kökü yolları için
 * kullanılan `parseRelativePath` ile KARIŞTIRILMAMALIDIR; burada kaynak bir
 * URL yoludur ve hedef, uygulamanın KENDİ build çıktısıdır (müşteri deposu
 * değil).
 *
 * Reddedilenler: yüzde-kodlaması bozuk girdi, kontrol karakteri/null byte,
 * ters bölü, sürücü öneki ve kod çözümünden SONRA kalan `..` segmenti (çift
 * kodlanmış `%2e%2e` dahil — kontrol daima kod çözmeden SONRA yapılır).
 */
export function resolveAssetPath(urlPathname: string): AssetPathResult {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPathname)
  } catch {
    return { ok: false, reason: 'not_decodable' }
  }
  if (hasControlChar(decoded)) return { ok: false, reason: 'control_character' }
  if (decoded.includes(BACKSLASH)) return { ok: false, reason: 'backslash' }

  const segments: string[] = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return { ok: false, reason: 'traversal' }
    // Sürücü öneki HER segmentte denetlenir. URL yolu daima `/` ile başladığı
    // için tüm dizgeye bakan bir kontrol `/C:/Windows`'u KAÇIRIR; `path.resolve`
    // ise `C:` segmentini sürücüye göreli sayıp kökten çıkabilirdi.
    if (DRIVE_PREFIX.test(segment)) return { ok: false, reason: 'absolute_or_drive' }
    segments.push(segment)
  }
  return { ok: true, segments }
}

/**
 * SPA geri düşüşü: dosya bulunamadığında `index.html` sunulmalı mı?
 *
 * UI `BrowserRouter` kullanır (`src/app/App.tsx`), yani `/dosyalar/{id}` gibi
 * derin yollar diskte dosya olarak YOKTUR. Uzantısı olan istekler (ör.
 * `/assets/index-abc.js`) geri düşmez — eksik bir varlık 404 kalmalıdır ki
 * bozuk bir build sessizce HTML dönüp hatayı gizlemesin.
 */
export function shouldFallbackToIndex(segments: readonly string[]): boolean {
  if (segments.length === 0) return true
  const last = segments[segments.length - 1] as string
  return !last.includes('.')
}
