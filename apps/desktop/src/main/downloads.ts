/**
 * İndirme yönetimi — SAF politika (D3).
 *
 * UI iki gerçek indirme akışı kullanır: doğrulanmış Değer Kaybı PDF raporu ve
 * dosya envanteri Excel çıktısı. İkisi de yanıtı `Blob`a çevirip
 * `URL.createObjectURL` + `<a download>` ile indirir, yani indirme URL'i
 * `blob:` şemasındadır ve içinde kabuğun origin'ini taşır.
 *
 * İki karar verilir:
 *   1. İndirme KABUĞUN KENDİ origin'inden mi başladı? Değilse iptal edilir.
 *   2. Sunucudan gelen dosya adı işletim sistemi için güvenli hâle getirilir.
 *
 * Dosya SİSTEMİNE yazma kararı kullanıcıya bırakılır: kabuk kaydetme yolunu
 * kendisi seçmez, yalnız kaydetme iletişim kutusuna güvenli bir ön ad verir.
 * Sessiz yazma yoktur.
 */

/** `blob:` ve `data:` gibi iç içe şemalar için önek. */
const BLOB_PREFIX = 'blob:'

export type DownloadRejection = 'not_a_url' | 'foreign_origin' | 'unsupported_scheme'

export type DownloadDecision =
  | { readonly action: 'allow' }
  | { readonly action: 'cancel'; readonly reason: DownloadRejection }

/**
 * İndirmenin kabuk origin'inden başlayıp başlamadığına karar verir.
 *
 * `blob:http://127.0.0.1:{port}/{uuid}` biçimi açıkça çözümlenir: `blob:`
 * önekinin ARDINDAKİ origin kabuk origin'iyle birebir eşleşmelidir. Doğrudan
 * `http(s)` indirmeleri de aynı origin kuralına tabidir; başka hiçbir şema
 * (`file:`, `data:`, `ftp:`) kabul edilmez.
 */
export function resolveDownload(rawUrl: string, shellOrigin: string): DownloadDecision {
  let shell: URL
  try {
    shell = new URL(shellOrigin)
  } catch {
    return { action: 'cancel', reason: 'not_a_url' }
  }

  const inner = rawUrl.startsWith(BLOB_PREFIX) ? rawUrl.slice(BLOB_PREFIX.length) : rawUrl
  let url: URL
  try {
    url = new URL(inner)
  } catch {
    return { action: 'cancel', reason: 'not_a_url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { action: 'cancel', reason: 'unsupported_scheme' }
  }
  if (url.origin !== shell.origin) return { action: 'cancel', reason: 'foreign_origin' }
  return { action: 'allow' }
}

/** Ad üretilemediğinde kullanılan güvenli varsayılan. */
export const FALLBACK_DOWNLOAD_FILENAME = 'hasarbotu-indirme'

/** Windows'ta ayrılmış cihaz adları; uzantı eklense bile ayrılmış kalırlar. */
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** Windows dosya adında yasak karakterler. */
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*]/g

/**
 * Toplam uzunluk sınırı. Yol sınırını (MAX_PATH) tek başına doldurmayacak,
 * ama Türkçe rapor adlarını kesmeyecek bir değer.
 */
export const MAXIMUM_DOWNLOAD_FILENAME_LENGTH = 180

/**
 * Sunucudan gelen dosya adını işletim sistemi için güvenli hâle getirir.
 *
 * Ad `content-disposition` başlığından gelir; yani kabuğun DIŞINDAN gelen bir
 * değerdir ve doğrulanmadan kaydetme kutusuna verilmez. Yapılanlar:
 *
 * - Yol ayırıcıları ve yasak karakterler `_` ile değiştirilir (traversal ve
 *   sürücü öneki denemeleri ada indirgenir).
 * - Kontrol karakterleri düşürülür.
 * - Baştaki nokta ve boşluklar, sondaki nokta ve boşluklar temizlenir
 *   (Windows bunları sessizce kırpar ve ad beklenmedik hâle gelir).
 * - Windows ayrılmış cihaz adları `_` ile öneklenir.
 * - Uzantı KORUNARAK toplam uzunluk sınırlanır.
 *
 * Uzantı değiştirilmez veya eklenmez: kabuk dosyanın türü hakkında karar
 * vermez, yalnız adı güvenli kılar.
 */
export function sanitizeDownloadFilename(raw: string): string {
  let value = ''
  for (const character of raw) {
    const code = character.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) continue
    value += character
  }
  value = value.replace(ILLEGAL_CHARACTERS, '_')
  // Baş/son nokta ve boşluklar; `..` gibi adlar da böylece elenir.
  value = value.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (value.length === 0) return FALLBACK_DOWNLOAD_FILENAME

  const lastDot = value.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < value.length - 1
  const stem = hasExtension ? value.slice(0, lastDot) : value
  const extension = hasExtension ? value.slice(lastDot) : ''

  const safeStem = WINDOWS_RESERVED_NAMES.has(stem.toLowerCase()) ? `_${stem}` : stem
  if (safeStem.length + extension.length <= MAXIMUM_DOWNLOAD_FILENAME_LENGTH) {
    return `${safeStem}${extension}`
  }
  // Uzantı, gövdeden feda edilerek korunur; uzantısı kesilmiş bir dosya adı
  // kullanıcıyı yanıltır.
  const room = MAXIMUM_DOWNLOAD_FILENAME_LENGTH - extension.length
  if (room <= 0) return `${FALLBACK_DOWNLOAD_FILENAME}${extension.slice(0, MAXIMUM_DOWNLOAD_FILENAME_LENGTH)}`
  return `${safeStem.slice(0, room)}${extension}`
}
