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
