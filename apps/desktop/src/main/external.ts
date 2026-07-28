/**
 * Harici bağlantı (openExternal) allowlist'i — SAF politika (D3).
 *
 * D2'de kabuk hiçbir URL'i dışarıya açmıyordu. UI'da ise gerçek ve meşru üç
 * hedef var:
 *   - Gmail web compose bağlantısı (`src/data/emailDraftPort.ts`),
 *   - Resmî Gazete ve SEDDK kaynak bağlantıları (Değer Kaybı kural kaynakları,
 *     `packages/domain/src/traffic-value-loss.ts`).
 *
 * Bu modül yalnız KARARI verir; `shell.openExternal` çağrısı `shell.ts`tedir.
 * Allowlist HOST bazlıdır ve yalnız `https` kabul eder: kullanıcı işletim
 * sistemine devredilen bir URL, kabuğun kendi CSP'sinin dışına çıkar; bu
 * yüzden kapı dar tutulur ve genişlemesi açık bir düzenleme gerektirir.
 */

/**
 * Dışarıya açılmasına izin verilen host'lar. Her giriş, repository'de GERÇEKTEN
 * kullanılan bir hedefe karşılık gelir; spekülatif giriş yoktur.
 */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  // E-posta hazırlama: Gmail web compose bağlantısı.
  'mail.google.com',
  // Değer Kaybı kural kaynakları (mevzuat).
  'resmigazete.gov.tr',
  'www.resmigazete.gov.tr',
  'seddk.gov.tr',
  'www.seddk.gov.tr',
]

/**
 * Üst sınır. Gmail compose bağlantısı konu ve gövdeyi URL-kodlu taşır; birkaç
 * KB'a çıkabilir. Sınır, işletim sistemine devredilen dizgenin sınırsız
 * büyümesini engeller. Aşan bağlantı KISALTILMAZ, reddedilir — yarım bir
 * e-posta taslağı açmak sessiz veri kaybıdır.
 */
export const MAXIMUM_EXTERNAL_URL_LENGTH = 16_384

export type ExternalOpenRejection =
  | 'not_a_url'
  | 'too_long'
  | 'control_character'
  | 'scheme_not_https'
  | 'credentials_present'
  | 'host_not_allowed'

export type ExternalOpenDecision =
  | { readonly action: 'open-external'; readonly url: string }
  | { readonly action: 'deny'; readonly reason: ExternalOpenRejection }

/** Kontrol karakteri (C0 0-31, DEL 127, C1 128-159) ve null byte. */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

/**
 * Bir URL'in işletim sistemi tarayıcısına devredilip devredilemeyeceğine karar
 * verir.
 *
 * Reddedilenler: çözümlenemeyen değer, uzunluk sınırını aşan değer, kontrol
 * karakteri/satır sonu taşıyan değer (kabuk/komut satırı enjeksiyonuna karşı),
 * `https` dışındaki her şema (`http`, `file`, `data`, `javascript`, `mailto`,
 * `smb` dâhil) ve allowlist dışındaki her host.
 *
 * Dönen `url`, WHATWG normalizasyonundan geçmiş biçimdir; işletim sistemine
 * ham istemci dizgesi değil, çözümlenmiş değer verilir.
 */
export function resolveExternalOpen(rawUrl: string): ExternalOpenDecision {
  if (rawUrl.length > MAXIMUM_EXTERNAL_URL_LENGTH) return { action: 'deny', reason: 'too_long' }
  if (hasControlChar(rawUrl)) return { action: 'deny', reason: 'control_character' }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { action: 'deny', reason: 'not_a_url' }
  }
  if (url.protocol !== 'https:') return { action: 'deny', reason: 'scheme_not_https' }
  if (url.username.length > 0 || url.password.length > 0) {
    return { action: 'deny', reason: 'credentials_present' }
  }
  if (!EXTERNAL_HOST_ALLOWLIST.includes(url.hostname.toLowerCase())) {
    return { action: 'deny', reason: 'host_not_allowed' }
  }
  // Normalizasyon sonrası uzunluk da sınırın altında kalmalıdır.
  if (url.href.length > MAXIMUM_EXTERNAL_URL_LENGTH) return { action: 'deny', reason: 'too_long' }
  return { action: 'open-external', url: url.href }
}
