/**
 * Paket 64 — fiziksel vaka klasörü yolu çözümleme (HB-2026-071).
 *
 * Kök yol BU MODÜLE GÖMÜLMEZ; deployment yapılandırmasından gelir ve
 * çözümleyiciye parametre olarak verilir.
 *
 * Gerçek sürücü keşfi (2026-07-20) beklenen düzenden iki noktada ayrıldı:
 *
 * 1. Ay klasörü büyük/küçük harf tutarlı DEĞİL: aynı ay için bir şirkette
 *    `TEMMUZ 2026`, diğerinde `Temmuz 2026` kullanılıyor. Bu yüzden ay
 *    klasörü adı ÜRETİLMEZ; mevcut dizinler arasında harf duyarsız eşleşme
 *    aranır. Böylece iki yazım da desteklenir ve eski düzene sessiz fallback
 *    yapılmaz.
 * 2. Kapanan dosyalar ay klasörünün altında ek bir `KAPALI <AY> <YIL>`
 *    seviyesinde duruyor. Plaka klasörü hem doğrudan hem bu seviyede aranır.
 *
 * Bu modül SAF'tır: dosya sistemine kendisi bakmaz, aday adları üretir ve
 * güvenlik kurallarını uygular. Gerçek dizin listeleme File Agent'ta yapılır.
 */

import { TURKISH_MONTH_NAMES } from './case-workspace.js'

export const CASE_FOLDER_PATH_VERSION = 'case-folder-path/1.0.0' as const

export type CaseFolderPathFailure =
  | 'invalid_year'
  | 'invalid_month'
  | 'invalid_plate'
  | 'invalid_insurer_folder'
  | 'insurer_folder_escapes_root'

export interface CaseFolderPathCandidates {
  readonly year: string
  readonly insurerFolderName: string
  /** Ay klasörü için kabul edilebilir adlar; harf duyarsız eşleştirilir. */
  readonly monthFolderNames: readonly string[]
  /** Kapanan dosya alt seviyesi adayları. */
  readonly closedFolderNames: readonly string[]
  readonly plateFolderName: string
}

export type CaseFolderPathResolution =
  | { readonly ok: false; readonly reason: CaseFolderPathFailure }
  | { readonly ok: true; readonly candidates: CaseFolderPathCandidates }

/** Plaka klasörü: boşluksuz, büyük harf, yalnız harf ve rakam. */
export function normalizePlateFolderName(plate: string): string | null {
  const normalized = plate.replace(/\s+/g, '').toLocaleUpperCase('tr')
  if (normalized.length < 4 || normalized.length > 16) return null
  if (!/^[0-9A-ZÇĞİÖŞÜ]+$/.test(normalized)) return null
  return normalized
}

/**
 * Sigorta şirketi klasör adı doğrulaması.
 *
 * Ekrandaki şirket adı ile fiziksel klasör adı AYNI KABUL EDİLMEZ; bu değer
 * ayrı ve doğrulanan bir eşlemeden gelir. Buradaki kontrol, o eşlemenin
 * kökün dışına çıkacak bir değer taşımasını engeller.
 */
export function validateInsurerFolderName(value: string): CaseFolderPathFailure | null {
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 120) return 'invalid_insurer_folder'
  // Yol ayırıcı, sürücü harfi, UNC ön eki ve üst dizin kaçışı yasaktır.
  if (/[\\/]/.test(trimmed)) return 'insurer_folder_escapes_root'
  if (/^[A-Za-z]:/.test(trimmed)) return 'insurer_folder_escapes_root'
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
    return 'insurer_folder_escapes_root'
  }
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return 'invalid_insurer_folder'
  }
  // Windows'ta ada gömülü olamayacak karakterler.
  if (/[<>:"|?*]/.test(trimmed)) return 'invalid_insurer_folder'
  return null
}

/**
 * Vaka klasörü için aday yol parçalarını üretir.
 *
 * Yıl ve ay ÇAĞIRANDAN gelir; bu modül tarih uydurmaz. Çağıran, mevcut iş
 * kuralındaki dosya tarihini (ihbar/açılış) çözmüş olmalıdır.
 */
export function resolveCaseFolderCandidates(input: {
  readonly year: number
  /** 1-12. */
  readonly month: number
  readonly plate: string
  readonly insurerFolderName: string
}): CaseFolderPathResolution {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { ok: false, reason: 'invalid_year' }
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { ok: false, reason: 'invalid_month' }
  }
  const insurerFailure = validateInsurerFolderName(input.insurerFolderName)
  if (insurerFailure !== null) return { ok: false, reason: insurerFailure }

  const plateFolderName = normalizePlateFolderName(input.plate)
  if (plateFolderName === null) return { ok: false, reason: 'invalid_plate' }

  const year = String(input.year)
  // Mevcut ay adı listesi baş harfi büyük tutar; büyük harf yazım ondan
  // TÜRKÇE kurallarıyla türetilir (i → İ).
  const titleMonth = TURKISH_MONTH_NAMES[input.month - 1] as string
  const upperMonth = titleMonth.toLocaleUpperCase('tr')

  return {
    ok: true,
    candidates: {
      year,
      insurerFolderName: input.insurerFolderName.trim(),
      monthFolderNames: [`${upperMonth} ${year}`, `${titleMonth} ${year}`],
      closedFolderNames: [`KAPALI ${upperMonth} ${year}`],
      plateFolderName,
    },
  }
}

/** Harf duyarsız (Türkçe) klasör adı eşleştirme. */
export function matchFolderName(
  candidates: readonly string[],
  existingNames: readonly string[],
): string | null {
  for (const candidate of candidates) {
    const target = candidate.toLocaleLowerCase('tr')
    const found = existingNames.find((name) => name.toLocaleLowerCase('tr') === target)
    if (found !== undefined) return found
  }
  return null
}
