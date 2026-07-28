/**
 * Masaüstü kabuğunun SAF güvenlik politikası katmanı (D2).
 *
 * Bu modül Electron'u import ETMEZ ve G/Ç yapmaz; yalnız kararları verir.
 * Kararları uygulayan yer `shell.ts`tir. Ayrım kasıtlıdır: politika gerçek
 * Chromium olmadan da doğrudan test edilebilir, `shell.ts` ise yalnız bu
 * kararları Electron API'lerine bağlar.
 *
 * Politikanın dayandığı mimari kilit (HB-2026-103): renderer TEK origin
 * görür — loopback köprüsünün origin'i. Dolayısıyla "izinli" tanımı
 * basittir: köprü origin'i dışındaki her şey reddedilir.
 */

/**
 * Renderer için zorunlu kılınan güvenli `webPreferences`.
 *
 * `sandbox: true` preload'un CommonJS olmasını gerektirir; bu yüzden preload
 * kaynağı `.cts` olarak yazılır ve `.cjs` olarak derlenir.
 */
export const SECURE_WEB_PREFERENCES = {
  /** Renderer'da Node yoktur. */
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  /** Preload ve sayfa ayrı JS dünyalarındadır. */
  contextIsolation: true,
  /** Renderer OS sandbox'ında çalışır. */
  sandbox: true,
  /** Same-origin politikası kapatılmaz. */
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  /** `<webview>` tamamen kapalı; ayrıca `shell.ts` attach'i de engeller. */
  webviewTag: false,
  spellcheck: false,
} as const

/**
 * Renderer'a uygulanan Content-Security-Policy.
 *
 * `default-src 'none'` ile başlar; her yetenek tek tek açılır. Kaynakların
 * tamamı köprü origin'inden ('self') gelir — uygulama zaten harici CDN, uzak
 * font veya zorunlu internet bağımlılığı kullanmaz (AGENTS.md §8).
 *
 * - `connect-src 'self'`: renderer'dan dışarıya ağ çıkışı yoktur. Bir XSS
 *   bulunsa bile veri dışarı sızdırılamaz.
 * - `img-src` içinde `data:`: ikon/gömülü küçük görseller için; `blob:` UI'ın
 *   indirme akışında `URL.createObjectURL` kullandığı için gerekir.
 * - `style-src 'self'`: `<style>` etiketi ve `style` NİTELİĞİ yasaktır.
 *   React'ın `style={{...}}` prop'u CSSOM üzerinden yazdığı için etkilenmez.
 * - `base-uri`/`form-action`/`object-src`/`frame-src` kapalıdır: base tag
 *   enjeksiyonu, form ile veri sızdırma ve gömülü içerik yolları kapatılır.
 * - `frame-ancestors 'none'`: kabuk penceresi hiçbir çerçeveye gömülemez.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
].join('; ')

/** CSP'nin uygulandığı istek türleri: yalnız doküman yanıtları. */
const DOCUMENT_RESOURCE_TYPES: readonly string[] = ['mainFrame', 'subFrame']

/**
 * `webRequest.onHeadersReceived` için saf başlık dönüşümü.
 *
 * CSP yalnız doküman yanıtlarına yazılır; `/api/*` JSON yanıtları
 * DEĞİŞTİRİLMEZ (köprünün şeffaflığı ve `set-cookie` aktarımı bozulmasın).
 * Upstream'den gelen herhangi bir CSP başlığı, büyük/küçük harf farkı olsa
 * bile silinir: kabuğun politikası tek ve kesin olmalıdır.
 */
export function withSecurityHeaders(
  responseHeaders: Readonly<Record<string, string | string[]>> | undefined,
  resourceType: string,
): Record<string, string | string[]> | undefined {
  if (!DOCUMENT_RESOURCE_TYPES.includes(resourceType)) return undefined
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(responseHeaders ?? {})) {
    const lowered = name.toLowerCase()
    if (lowered === 'content-security-policy') continue
    if (lowered === 'content-security-policy-report-only') continue
    if (lowered === 'x-content-type-options') continue
    headers[name] = value
  }
  headers['content-security-policy'] = [CONTENT_SECURITY_POLICY]
  headers['x-content-type-options'] = ['nosniff']
  return headers
}

/**
 * Navigasyon izni. YALNIZ köprü origin'i içinde kalan `http` navigasyonuna
 * izin verilir.
 *
 * Reddedilenler arasında `about:blank`, `file:`, `data:`, `javascript:`,
 * `devtools:` ve her türlü uzak origin vardır. Çözümlenemeyen bir URL de
 * reddedilir (belirsizlik izin anlamına gelmez).
 *
 * NOT: `<a download>` ile başlatılan `blob:` indirmeleri Chromium'da
 * navigasyon değil indirmedir ve bu kapıya HİÇ uğramaz; UI'ın rapor/Excel
 * indirme akışı etkilenmez.
 */
export function isAllowedNavigationUrl(targetUrl: string, shellOrigin: string): boolean {
  let target: URL
  let shell: URL
  try {
    target = new URL(targetUrl)
    shell = new URL(shellOrigin)
  } catch {
    return false
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  return target.origin === shell.origin
}

/**
 * İzin (permission) allowlist'i — KASITLI OLARAK BOŞ.
 *
 * Kamera, mikrofon, konum, bildirim, pano okuma, dosya sistemi erişimi ve
 * benzerleri kapalıdır. Bir ihtiyaç doğarsa buraya açık bir giriş ve gerekçe
 * eklenir; liste sessizce genişlemez.
 */
export const ALLOWED_PERMISSIONS: readonly string[] = []

export function isAllowedPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.includes(permission)
}

/**
 * Yeni pencere açmasına izin verilen origin'ler — KASITLI OLARAK BOŞ.
 *
 * `window.open`, `target="_blank"` ve benzerleri reddedilir. Kabuk tek
 * pencerelidir; harici bağlantıyı varsayılan tarayıcıya devretme davranışı da
 * bu pakette KURULMAZ (kapsam dışı) — böylece kabuk hiçbir URL'i dışarıya
 * açmaz.
 */
export const ALLOWED_WINDOW_OPEN_ORIGINS: readonly string[] = []

export function isAllowedWindowOpen(targetUrl: string): boolean {
  try {
    return ALLOWED_WINDOW_OPEN_ORIGINS.includes(new URL(targetUrl).origin)
  } catch {
    return false
  }
}
