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

export const LABOR_SHEET_SOURCE_TYPES = ['user_entered', 'manual_revision'] as const
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
}

export interface NormalizedLaborItem {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
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
    normalized.push({
      description,
      action,
      partAmountMinor: item.partAmountMinor,
      laborAmountMinor: item.laborAmountMinor,
    })
  }
  const totals = computeLaborSheetTotals(normalized)
  if (totals.grandTotalMinor > MAX_LABOR_SHEET_TOTAL_MINOR) {
    return { valid: false, reasonCode: 'total_exceeds_limit', itemOrdinal: null }
  }
  return { valid: true, items: normalized, totals }
}
