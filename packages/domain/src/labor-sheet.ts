/**
 * Paket 43 — kullanıcı kontrollü İşçilik (parça ve işçilik) çekirdeği.
 *
 * Saf ve deterministik doğrulama/hesap katmanı. AI veya dış servis çağırmaz,
 * Excel'e veya dosyaya yazmaz. Her satır kalemi bir onarım işleminin parça ve
 * işçilik bedelini minor birimde (kuruş) taşır; tutar dağıtımı, taksonomi ve
 * öğrenme sözlüğü sonraki dilimlere bırakılmıştır.
 */
export const LABOR_SHEET_SCHEMA_VERSION = 'labor-sheet/1.0.0' as const
export const LABOR_SHEET_CURRENCY = 'TRY' as const

export const LABOR_SHEET_SOURCE_TYPES = ['user_entered', 'ai_assisted', 'manual_revision'] as const
export type LaborSheetSourceType = (typeof LABOR_SHEET_SOURCE_TYPES)[number]

export const MAX_LABOR_SHEET_ITEMS = 200
export const MAX_LABOR_ITEM_DESCRIPTION_LENGTH = 160
export const MAX_LABOR_ITEM_ACTION_LENGTH = 80
/** Alan başına üst sınır: ₺100.000.000 (kuruş). İş kuralı değil, taşma/abuse sınırıdır. */
export const MAX_LABOR_AMOUNT_MINOR = 100_000_000_00
/** Föy geneli üst sınır: ₺100.000.000 (kuruş). */
export const MAX_LABOR_SHEET_TOTAL_MINOR = 100_000_000_00
export const MAX_LABOR_REVISION_REASON_LENGTH = 500

export interface LaborItemInput {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  /** Paket 56 kanıt alanları; verilmezse null kabul edilir. */
  readonly partCode?: string | null
  readonly partCodeSource?: LaborPartCodeSource | null
  readonly damageRegion?: string | null
}

export interface NormalizedLaborItem {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  /** Paket 56: parça/malzeme kodu. Saf işçilik satırında null kalabilir. */
  readonly partCode?: string | null
  /** Paket 56: normalize edilmiş hasar bölgesi. Şirket kolonlarına bağlı değildir. */
  readonly damageRegion?: string | null
  /**
   * Paket 56: parça kodunun kaynağı. Kullanıcı girdisi ile sözlük önerisi
   * birbirinden ayrılır; öneri tek başına kullanıcı doğrulaması sayılmaz.
   */
  readonly partCodeSource?: LaborPartCodeSource | null
}

/** Parça kodu kaynağı: kullanıcı girdisi mi, öğrenme sözlüğü önerisi mi. */
export const LABOR_PART_CODE_SOURCES = ['user_entered', 'dictionary_suggested'] as const
export type LaborPartCodeSource = (typeof LABOR_PART_CODE_SOURCES)[number]

export const MAX_LABOR_PART_CODE_LENGTH = 40
export const MAX_LABOR_DAMAGE_REGION_LENGTH = 80

/**
 * Parça/malzeme kodu: büyük harf, rakam ve sınırlı ayraç. Serbest açıklama
 * değildir; boşluklar kaldırılır ve kanonik büyük harfe çevrilir.
 */
export function normalizeLaborPartCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/gu, '')
  if (normalized.length === 0 || normalized.length > MAX_LABOR_PART_CODE_LENGTH) return null
  if (!/^[A-Z0-9._/-]+$/u.test(normalized)) return null
  return normalized
}

/**
 * Hasar bölgesi: sınırlandırılmış ve normalize edilmiş SERBEST metin.
 * Uydurma geniş bir enum kurulmaz; ofis kendi terimini yazabilir.
 */
export function normalizeLaborDamageRegion(value: string): string | null {
  return normalizeLaborText(value.replace(/\s+/gu, ' '), MAX_LABOR_DAMAGE_REGION_LENGTH)
}

export interface LaborSheetTotals {
  readonly partTotalMinor: number
  readonly laborTotalMinor: number
  readonly grandTotalMinor: number
}

export type LaborSheetInvalidReason =
  | 'items_required'
  | 'too_many_items'
  | 'invalid_description'
  | 'invalid_action'
  | 'invalid_amount'
  | 'amount_required'
  | 'total_exceeds_limit'
  | 'invalid_part_code'
  | 'invalid_damage_region'

export type LaborSheetValidation =
  | { readonly valid: true; readonly items: readonly NormalizedLaborItem[]; readonly totals: LaborSheetTotals }
  | { readonly valid: false; readonly reasonCode: LaborSheetInvalidReason; readonly itemOrdinal: number | null }

/** C0/C1 kontrol karakteri tespiti; domain konvansiyonu (charCodeAt). */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

/**
 * Kullanıcı metnini normalize eder: baş/son boşluk temizlenir. Boş, yalnız
 * boşluk, kontrol karakteri içeren veya sınırı aşan metin reddedilir (null).
 */
export function normalizeLaborText(value: string, maxLength: number): string | null {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) return null
  if (hasControlCharacter(normalized)) return null
  return normalized
}

export function isValidLaborAmountMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_LABOR_AMOUNT_MINOR
}

export function computeLaborSheetTotals(
  items: readonly NormalizedLaborItem[],
): LaborSheetTotals {
  let partTotalMinor = 0
  let laborTotalMinor = 0
  for (const item of items) {
    partTotalMinor += item.partAmountMinor
    laborTotalMinor += item.laborAmountMinor
  }
  return { partTotalMinor, laborTotalMinor, grandTotalMinor: partTotalMinor + laborTotalMinor }
}

/**
 * İşçilik föyü satır kalemlerini doğrular ve normalize eder. En az bir kalem
 * zorunludur; her kalemin geçerli açıklama/işlem metni ve negatif olmayan
 * tutarları olmalı, en az bir tutar pozitif olmalıdır. Föy geneli tutar üst
 * sınırı aşamaz. Hatalarda kusurlu kalemin 1 tabanlı sırası döner.
 */
export function validateLaborSheetItems(
  items: readonly LaborItemInput[],
): LaborSheetValidation {
  if (items.length === 0) {
    return { valid: false, reasonCode: 'items_required', itemOrdinal: null }
  }
  if (items.length > MAX_LABOR_SHEET_ITEMS) {
    return { valid: false, reasonCode: 'too_many_items', itemOrdinal: null }
  }
  const normalized: NormalizedLaborItem[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const ordinal = index + 1
    const description = normalizeLaborText(item.description, MAX_LABOR_ITEM_DESCRIPTION_LENGTH)
    if (description === null) {
      return { valid: false, reasonCode: 'invalid_description', itemOrdinal: ordinal }
    }
    const action = normalizeLaborText(item.action, MAX_LABOR_ITEM_ACTION_LENGTH)
    if (action === null) {
      return { valid: false, reasonCode: 'invalid_action', itemOrdinal: ordinal }
    }
    if (!isValidLaborAmountMinor(item.partAmountMinor) || !isValidLaborAmountMinor(item.laborAmountMinor)) {
      return { valid: false, reasonCode: 'invalid_amount', itemOrdinal: ordinal }
    }
    if (item.partAmountMinor + item.laborAmountMinor === 0) {
      return { valid: false, reasonCode: 'amount_required', itemOrdinal: ordinal }
    }
    // Paket 56 kanıt alanları: verilmişse normalize edilir, yoksa null kalır.
    let partCode: string | null = null
    if (item.partCode !== undefined && item.partCode !== null) {
      partCode = normalizeLaborPartCode(item.partCode)
      if (partCode === null) {
        return { valid: false, reasonCode: 'invalid_part_code', itemOrdinal: ordinal }
      }
    }
    const partCodeSource = item.partCodeSource ?? null
    // Kaynak yalnız kod varken anlamlıdır ve tersi de geçerlidir.
    if ((partCode === null) !== (partCodeSource === null)) {
      return { valid: false, reasonCode: 'invalid_part_code', itemOrdinal: ordinal }
    }
    if (partCodeSource !== null && !(LABOR_PART_CODE_SOURCES as readonly string[]).includes(partCodeSource)) {
      return { valid: false, reasonCode: 'invalid_part_code', itemOrdinal: ordinal }
    }
    let damageRegion: string | null = null
    if (item.damageRegion !== undefined && item.damageRegion !== null) {
      damageRegion = normalizeLaborDamageRegion(item.damageRegion)
      if (damageRegion === null) {
        return { valid: false, reasonCode: 'invalid_damage_region', itemOrdinal: ordinal }
      }
    }
    normalized.push({
      description,
      action,
      partAmountMinor: item.partAmountMinor,
      laborAmountMinor: item.laborAmountMinor,
      partCode,
      partCodeSource,
      damageRegion,
    })
  }
  const totals = computeLaborSheetTotals(normalized)
  if (totals.grandTotalMinor > MAX_LABOR_SHEET_TOTAL_MINOR) {
    return { valid: false, reasonCode: 'total_exceeds_limit', itemOrdinal: null }
  }
  return { valid: true, items: normalized, totals }
}
