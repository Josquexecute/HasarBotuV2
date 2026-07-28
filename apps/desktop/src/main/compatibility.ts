/**
 * Kabuk ↔ API sürüm uyum kapısı — SAF politika (D3).
 *
 * Masaüstü kabuğu ile API AYRI dağıtılır: kabuk kullanıcının makinesinde,
 * API ofis sunucusundadır (Paket 22). Yani ikisinin sürümü kaçınılmaz olarak
 * ayrışabilir. Uyumsuz bir çiftin sessizce çalışması, hatanın kullanıcıya
 * "veri yanlış" olarak görünmesi demektir; bu yüzden kabuk pencereyi AÇMADAN
 * ÖNCE uyumu doğrular.
 *
 * Kapı mevcut `/health` sözleşmesini kullanır; API'ye, contracts'a veya
 * migration'a hiçbir ekleme yapılmaz.
 */

/** `/health` yanıtındaki servis kimliği. Farklıysa yanlış sunucuya bakılıyordur. */
export const EXPECTED_API_SERVICE = 'hasarbotu-api'

/** Kabuğun desteklediği API ana sürümü. */
export const SUPPORTED_API_MAJOR = 0

/** Kabuğun gerektirdiği en düşük ikincil sürüm. */
export const MINIMUM_API_MINOR = 0

export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string | undefined
}

const VERSION_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/

/**
 * `major.minor.patch[-prerelease][+build]` biçimini açıkça çözümler.
 * Sessiz coercion yoktur; biçime uymayan değer `null` döner.
 */
export function parseSemanticVersion(raw: string): SemanticVersion | null {
  const match = VERSION_PATTERN.exec(raw.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

export type CompatibilityOutcome =
  | 'compatible'
  | 'unknown_service'
  | 'unparseable_version'
  | 'incompatible_major'
  | 'incompatible_minor'

/**
 * Ayrık birlik (discriminated union): `compatible` bayrağı sonucu daraltır,
 * böylece çağıran taraf "uyumsuz" dalında `compatible` sonucunu ele almak
 * zorunda kalmaz.
 */
export type CompatibilityResult =
  | { readonly outcome: 'compatible'; readonly compatible: true }
  | { readonly outcome: Exclude<CompatibilityOutcome, 'compatible'>; readonly compatible: false }

/**
 * Uyum kuralı:
 *
 * - `service` beklenen servis kimliği olmalıdır.
 * - Sürüm çözümlenebilmelidir.
 * - Ana sürüm kabuğun desteklediğiyle BİREBİR eşleşmelidir.
 * - Ana sürüm `0` iken ikincil sürüm de BİREBİR eşleşmelidir: semver'de `0.x`
 *   serisinde kırıcı değişiklik ikincil sürümle taşınır, yani `0.1` ile `0.2`
 *   uyumlu SAYILMAZ.
 * - Ana sürüm `0`dan büyükken ikincil sürüm en düşük gereksinimden küçük
 *   olmamalıdır (ileri uyumluluk: daha yeni bir API kabul edilir).
 *
 * Ön sürüm (`-rc.1`) etiketi uyumu ETKİLEMEZ; sürüm numarası belirleyicidir.
 */
export function checkApiCompatibility(service: string, version: string): CompatibilityResult {
  if (service !== EXPECTED_API_SERVICE) return { outcome: 'unknown_service', compatible: false }
  const parsed = parseSemanticVersion(version)
  if (parsed === null) return { outcome: 'unparseable_version', compatible: false }
  if (parsed.major !== SUPPORTED_API_MAJOR) return { outcome: 'incompatible_major', compatible: false }
  if (SUPPORTED_API_MAJOR === 0) {
    return parsed.minor === MINIMUM_API_MINOR
      ? { outcome: 'compatible', compatible: true }
      : { outcome: 'incompatible_minor', compatible: false }
  }
  return parsed.minor >= MINIMUM_API_MINOR
    ? { outcome: 'compatible', compatible: true }
    : { outcome: 'incompatible_minor', compatible: false }
}
