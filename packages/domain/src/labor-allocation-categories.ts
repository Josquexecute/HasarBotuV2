import { LABOR_OPERATION_TYPES, type LaborOperationType } from './labor-allocation-ai.js'

/**
 * Paket 64 — işçilik DAĞITIM KATEGORİLERİ (HB-2026-072).
 *
 * Bu, `labor-operation-types` ile AYNI EKSEN DEĞİLDİR ve onun yerine geçmez:
 *
 * - Operasyon türü İŞLEMİN NE OLDUĞUNU söyler (onarım mı, değişim mi,
 *   sökme-takma mı). AI gerekçelendirmesi ve onarım/değişim karşılaştırması
 *   bu eksende yapılır.
 * - Dağıtım kategorisi İŞİ HANGİ BRANŞIN YAPTIĞINI söyler (kaporta, mekanik,
 *   elektrik...). Sigorta şirketinin Excel işçilik sütunları bu eksendedir.
 *
 * İki eksen birebir eşlenemez: `remove_install` hem kaporta hem mekanik
 * altında olabilir; `replace` bir işçilik sütunu değildir (parça bedelidir).
 * `calibration`, `repair` ve `paint` adlarının iki sette de geçmesi bu ayrımı
 * gizler — hata tam olarak buradan doğmuştu.
 *
 * Kodlar KARARLI ve DİL BAĞIMSIZDIR; Türkçe etiketler UI/profil katmanında
 * taşınır çünkü sütun başlığı şirketten şirkete değişir.
 */
export const LABOR_ALLOCATION_CATEGORIES_VERSION = 'labor-allocation-categories/1.0.0' as const

export const LABOR_ALLOCATION_CATEGORIES = [
  'bodywork',
  'mechanical',
  'electrical',
  'upholstery_lock',
  'glass',
  'calibration',
  'repair',
  'paint',
] as const

export type LaborAllocationCategory = (typeof LABOR_ALLOCATION_CATEGORIES)[number]

export function isLaborAllocationCategory(value: string): value is LaborAllocationCategory {
  return (LABOR_ALLOCATION_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Operasyon türünden dağıtım kategorisi TÜRETİLEBİLİYOR mu?
 *
 * Yalnız anlamı tek olan türler eşlenir. Belirsiz türler için `null` döner ve
 * kategori UYDURULMAZ: hangi branşın yaptığı bilgisi operasyon türünde yoktur.
 *
 * - `paint` → boya: tek anlamlı.
 * - `calibration` → kalibrasyon: tek anlamlı.
 * - `repair` → onarım: tek anlamlı (işçilik olarak onarım kalemi).
 * - `replace` → parça bedelidir, işçilik sütunu DEĞİLDİR.
 * - `remove_install`, `consumable`, `related_operation`, `other` → branş
 *   bilgisi taşımaz; insan veya kategori bazlı dağıtım gerekir.
 */
export function deriveCategoryFromOperation(
  operationType: LaborOperationType,
): LaborAllocationCategory | null {
  switch (operationType) {
    case 'paint': return 'paint'
    case 'calibration': return 'calibration'
    case 'repair': return 'repair'
    default: return null
  }
}

/** Kategorisi tek anlamlı türetilemeyen operasyon türleri. */
export const AMBIGUOUS_OPERATION_TYPES: readonly LaborOperationType[] = LABOR_OPERATION_TYPES
  .filter((type) => deriveCategoryFromOperation(type) === null)

export interface LaborCategoryAmount {
  readonly category: LaborAllocationCategory
  readonly amountMinor: number
}

export type CategoryDerivationFailure =
  /** Satırda branş bilgisi taşımayan tutar var; kategori uydurulamaz. */
  | 'category_ambiguous'
  /** Tutar bir işçilik sütununa değil parça bedeline aittir. */
  | 'not_labor_amount'

export type CategoryDerivation =
  | { readonly ok: false; readonly reason: CategoryDerivationFailure; readonly operationType: LaborOperationType }
  | { readonly ok: true; readonly amounts: readonly LaborCategoryAmount[] }

/**
 * Satırın operasyon bazlı dağılımını kategori bazlı dağılıma çevirmeyi DENER.
 *
 * Sıfır olmayan tek bir tutar bile belirsiz bir türe düşüyorsa TÜM satır
 * reddedilir; kısmi kategori dağılımı üretilmez. Çağıran bu satırı
 * `manual_entry_required` olarak işaretlemelidir.
 *
 * Sıfır tutarlar belirsizlik yaratmaz: yazılacak bir şey yoktur.
 */
export function deriveCategoryAmounts(
  allocations: readonly { readonly operationType: LaborOperationType; readonly amountMinor: number }[],
): CategoryDerivation {
  const totals = new Map<LaborAllocationCategory, number>()
  for (const allocation of allocations) {
    if (allocation.amountMinor === 0) continue
    if (allocation.operationType === 'replace') {
      return { ok: false, reason: 'not_labor_amount', operationType: 'replace' }
    }
    const category = deriveCategoryFromOperation(allocation.operationType)
    if (category === null) {
      return {
        ok: false,
        reason: 'category_ambiguous',
        operationType: allocation.operationType,
      }
    }
    totals.set(category, (totals.get(category) ?? 0) + allocation.amountMinor)
  }
  // Kategori sırası sabittir ki çıktı deterministik olsun.
  const amounts = LABOR_ALLOCATION_CATEGORIES
    .filter((category) => totals.has(category))
    .map((category) => ({ category, amountMinor: totals.get(category) as number }))
  return { ok: true, amounts }
}

/** Her kategori ya bir Excel sütununa eşlenir ya da açıkça eşlenmemiş bırakılır. */
export type LaborCategoryMapping = Readonly<Record<LaborAllocationCategory, string | null>>

/**
 * Paket 64 ara dilim — AI'nin ÜRETTİĞİ satır bazlı kategori dağılımı.
 *
 * Kategori tutarı operasyon türünden TÜRETİLMEZ; modelin kendi çıktısıdır.
 * `deriveCategoryAmounts` yalnız eski kayıtların okunmasına hizmet eder ve
 * yeni akışta kullanılmaz.
 */
export const LABOR_CATEGORY_ALLOCATION_SCHEMA_VERSION =
  'labor-category-allocation/1.0.0' as const

/** Kategori dağılımına özgü belirsizlik/çelişki kodları. */
export const LABOR_CATEGORY_CONFLICT_CODES = [
  'CATEGORY_EVIDENCE_INSUFFICIENT',
  'CATEGORY_DESCRIPTION_AMBIGUOUS',
  'CATEGORY_HISTORY_CONFLICT',
  'CATEGORY_BASELINE_CONFLICT',
  'CATEGORY_MULTI_TRADE_LINE',
] as const

export type LaborCategoryConflictCode = (typeof LABOR_CATEGORY_CONFLICT_CODES)[number]

export interface LaborCategoryAllocationInput {
  /** Sekiz kategorinin TAMAMI; kullanılmayan kategori 0 taşır. */
  readonly amounts: Readonly<Record<string, unknown>>
  readonly reasoning: string
  readonly confidence: number
  readonly evidenceRefs: readonly string[]
  readonly conflictCodes: readonly string[]
}

export type LaborCategoryAllocationFailure =
  | 'category_keys_incomplete'
  | 'category_keys_unknown'
  | 'category_amount_not_integer'
  | 'category_amount_negative'
  | 'category_total_mismatch'
  | 'category_reasoning_missing'
  | 'category_confidence_invalid'
  | 'category_conflict_code_unknown'

export type LaborCategoryAllocationValidation =
  | {
    readonly ok: false
    readonly reason: LaborCategoryAllocationFailure
    readonly detail: string | null
  }
  | {
    readonly ok: true
    readonly amounts: readonly LaborCategoryAmount[]
    readonly reasoning: string
    readonly confidence: number
    readonly evidenceRefs: readonly string[]
    readonly conflictCodes: readonly LaborCategoryConflictCode[]
    readonly totalMinor: number
  }

/**
 * Modelin ürettiği kategori dağılımını doğrular.
 *
 * Kurallar:
 * - Sekiz kategori EKSİKSİZ gelmeli; sessiz eksik anahtar kabul edilmez.
 * - Bilinmeyen anahtar reddedilir.
 * - Tutarlar tam sayı (minor birim) ve negatif olmayan olmalıdır; küsurat
 *   reddedilir çünkü kuruş altı birim yoktur.
 * - Toplam, satırın İŞÇİLİK tutarına TAM eşit olmalıdır. Parça tutarı bu
 *   toplama girmez.
 * - Toplam SUNUCUDA yeniden hesaplanır; sağlayıcının kendi toplamına
 *   güvenilmez (zaten wire'da böyle bir alan taşınmaz).
 */
export function validateLaborCategoryAllocation(
  input: LaborCategoryAllocationInput,
  laborAmountMinor: number,
): LaborCategoryAllocationValidation {
  const keys = Object.keys(input.amounts)
  for (const key of keys) {
    if (!isLaborAllocationCategory(key)) {
      return { ok: false, reason: 'category_keys_unknown', detail: key }
    }
  }
  for (const category of LABOR_ALLOCATION_CATEGORIES) {
    if (!keys.includes(category)) {
      return { ok: false, reason: 'category_keys_incomplete', detail: category }
    }
  }
  // Tekrarlı anahtar JS nesnesinde zaten imkânsızdır; sayı eşitliği fazladan
  // anahtar kalmadığını garantiler.
  if (keys.length !== LABOR_ALLOCATION_CATEGORIES.length) {
    return { ok: false, reason: 'category_keys_unknown', detail: null }
  }

  const amounts: LaborCategoryAmount[] = []
  let totalMinor = 0
  for (const category of LABOR_ALLOCATION_CATEGORIES) {
    const raw = input.amounts[category]
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      return { ok: false, reason: 'category_amount_not_integer', detail: category }
    }
    if (raw < 0) {
      return { ok: false, reason: 'category_amount_negative', detail: category }
    }
    totalMinor += raw
    amounts.push({ category, amountMinor: raw })
  }

  // Sunucu toplamı KENDİ hesaplar ve işçilik tutarıyla karşılaştırır.
  if (totalMinor !== laborAmountMinor) {
    return {
      ok: false,
      reason: 'category_total_mismatch',
      detail: `${totalMinor}!=${laborAmountMinor}`,
    }
  }

  const reasoning = input.reasoning.trim()
  if (reasoning.length === 0) {
    return { ok: false, reason: 'category_reasoning_missing', detail: null }
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return { ok: false, reason: 'category_confidence_invalid', detail: null }
  }
  for (const code of input.conflictCodes) {
    if (!(LABOR_CATEGORY_CONFLICT_CODES as readonly string[]).includes(code)) {
      return { ok: false, reason: 'category_conflict_code_unknown', detail: code }
    }
  }

  return {
    ok: true,
    amounts,
    reasoning,
    confidence: input.confidence,
    evidenceRefs: input.evidenceRefs,
    conflictCodes: input.conflictCodes as readonly LaborCategoryConflictCode[],
    totalMinor,
  }
}

/**
 * Kategori dağılımı insan kontrolü gerektiriyor mu?
 *
 * Modelin yüksek güven bildirmesi sunucu zorlamasını KALDIRAMAZ: çelişki kodu
 * varsa veya güven eşiğin altındaysa kontrol zorunludur.
 */
export const LABOR_CATEGORY_CONTROL_CONFIDENCE_THRESHOLD = 0.75

export function categoryControlRequired(validated: {
  readonly confidence: number
  readonly conflictCodes: readonly LaborCategoryConflictCode[]
}): boolean {
  if (validated.conflictCodes.length > 0) return true
  return validated.confidence < LABOR_CATEGORY_CONTROL_CONFIDENCE_THRESHOLD
}
