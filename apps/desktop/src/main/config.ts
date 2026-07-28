/**
 * Masaüstü kabuğunun SAF yapılandırma sınırı (D2).
 *
 * `services/api/src/config.ts` ile aynı sözleşmeyi izler: açık parser, sessiz
 * coercion yok, geçersiz yapılandırmada BAŞLATMA YOK ve hata mesajında ortam
 * DEĞERİ taşınmaz — yalnız alan adı ve beklenen kural.
 */

export const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3100'

export const MIN_PORT = 0
export const MAX_PORT = 65_535

const INTEGER_PATTERN = /^\d+$/

const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]', '::1']

export interface DesktopConfig {
  /** Köprünün `/api/*` isteklerini ileteceği API kökü. */
  readonly apiOrigin: string
  /** Renderer'a sunulacak UI build çıktısı dizini. */
  readonly assetRoot: string
  /** Köprünün dinleyeceği loopback portu; `0` boş port seçtirir (önerilen). */
  readonly bridgePort: number
}

/** Yapılandırma hatası: alan adı + kural taşır, değer taşımaz. */
export class DesktopConfigError extends Error {
  readonly field: string

  constructor(field: string, requirement: string) {
    super(`Invalid ${field}: ${requirement}`)
    this.name = 'DesktopConfigError'
    this.field = field
  }
}

/**
 * API origin'i doğrular.
 *
 * `http` YALNIZ loopback için kabul edilir. Ofis LAN'ında (Paket 22) API
 * başka bir makinede olacaktır; oturum çerezi ağda düz metin geçemeyeceği
 * için orada `https` ZORUNLUDUR. Bu kural kabukta uygulanır ki yanlış
 * yapılandırma sessizce üretime sızmasın.
 *
 * Ayrıca kullanıcı bilgisi, yol, sorgu ve fragment içeren değerler
 * reddedilir: burada beklenen bir ORIGIN'dir, bir URL değil.
 */
function parseApiOrigin(raw: string | undefined): string {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_API_ORIGIN
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new DesktopConfigError('HASARBOTU_API_ORIGIN', 'expected an absolute http(s) origin.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DesktopConfigError('HASARBOTU_API_ORIGIN', 'expected an absolute http(s) origin.')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new DesktopConfigError('HASARBOTU_API_ORIGIN', 'must not carry credentials.')
  }
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
    throw new DesktopConfigError('HASARBOTU_API_ORIGIN', 'expected an origin without path, query or fragment.')
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTNAMES.includes(url.hostname.toLowerCase())) {
    throw new DesktopConfigError('HASARBOTU_API_ORIGIN', 'plain http is allowed only for loopback; use https for a remote API.')
  }
  return url.origin
}

function parseBridgePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) return 0
  if (!INTEGER_PATTERN.test(raw)) {
    throw new DesktopConfigError('HASARBOTU_BRIDGE_PORT', `expected an integer between ${MIN_PORT} and ${MAX_PORT}.`)
  }
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new DesktopConfigError('HASARBOTU_BRIDGE_PORT', `expected an integer between ${MIN_PORT} and ${MAX_PORT}.`)
  }
  return port
}

function parseAssetRoot(raw: string | undefined, fallback: string): string {
  const value = raw === undefined || raw.trim().length === 0 ? fallback : raw.trim()
  if (value.length === 0) {
    throw new DesktopConfigError('HASARBOTU_ASSET_ROOT', 'expected a non-empty directory path.')
  }
  return value
}

/**
 * Ortam nesnesinden kabuk yapılandırmasını üretir. Saf fonksiyondur: testler
 * gerçek süreç ortamına bağlı olmadan açık nesnelerle çalışır.
 */
export function parseDesktopConfig(
  env: Readonly<Record<string, string | undefined>>,
  defaults: { readonly assetRoot: string },
): DesktopConfig {
  return {
    apiOrigin: parseApiOrigin(env.HASARBOTU_API_ORIGIN),
    assetRoot: parseAssetRoot(env.HASARBOTU_ASSET_ROOT, defaults.assetRoot),
    bridgePort: parseBridgePort(env.HASARBOTU_BRIDGE_PORT),
  }
}
