import {
  selectConsistentCategoryHistory,
  type LaborCategoryAmount,
} from './labor-allocation-categories.js'
import type { LaborOperationType } from './labor-allocation-ai.js'
import type { LaborAllocationEvidenceLine } from './labor-allocation-ai.js'
import type { NormalizedLaborItem } from './labor-sheet.js'
import { normalizeBaselineMatchText } from './labor-baseline.js'

/**
 * Paket 58 — onaylı AI dağıtımının föye uygulanması (HB-2026-065).
 *
 * Bu modül saf sınırdır: neyin uygulanabilir olduğunu, kullanıcının öneriyi
 * gerçekten değiştirip değiştirmediğini ve hangi geçmiş kayıtlarının öğrenme
 * örneği sayılabileceğini belirler. Yazma işlemini yapmaz.
 *
 * Temel ilke: AI önerisi kendiliğinden föyü değiştirmez. Uygulanan değer
 * kullanıcının açıkça onayladığı değerdir; AI'nin ilk değeri yalnız kanıt
 * olarak saklanır.
 */
export const LABOR_ALLOCATION_APPLY_SCHEMA_VERSION = 'labor-allocation-apply/1.0.0' as const

export const LABOR_ALLOCATION_APPLICATION_STATUSES = ['running', 'completed', 'failed'] as const
export type LaborAllocationApplicationStatus =
  (typeof LABOR_ALLOCATION_APPLICATION_STATUSES)[number]

/** Kullanıcının uygulamak üzere onayladığı tek satır. */
export interface LaborAllocationAppliedLineInput {
  readonly lineOrdinal: number
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
}

/** Kaynak öneri satırının uygulama anındaki hali. */
export interface LaborAllocationSuggestedLine {
  readonly lineOrdinal: number
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  readonly operationTypes: readonly LaborOperationType[]
  readonly controlRequired: boolean
}

export interface LaborAllocationAppliedLine {
  readonly lineOrdinal: number
  readonly suggested: LaborAllocationSuggestedLine
  readonly applied: LaborAllocationAppliedLineInput
  /** Kullanıcı öneriyi değiştirdiyse true; öğrenme örneği uygulanan değerdir. */
  readonly modified: boolean
}

export type LaborAllocationApplyRejection =
  | 'APPLY_LINE_SELECTION_EMPTY'
  | 'APPLY_LINE_NOT_IN_RUN'
  | 'APPLY_LINE_DUPLICATED'
  | 'APPLY_LINE_AMOUNT_INVALID'
  | 'APPLY_LINE_TEXT_INVALID'

export type LaborAllocationApplyValidation =
  | { readonly allowed: false; readonly code: LaborAllocationApplyRejection }
  | {
    readonly allowed: true
    readonly lines: readonly LaborAllocationAppliedLine[]
    readonly modifiedCount: number
    readonly controlRequiredCount: number
  }

function sameText(left: string, right: string): boolean {
  return left.trim() === right.trim()
}

/**
 * Kullanıcının onayladığı satırları kaynak öneriye karşı doğrular.
 *
 * Seçilmeyen satırlar burada görünmez; onlar föyde mevcut hallerini korur ve
 * uygulanmış SAYILMAZ. Reddedilen satır öğrenme örneği üretmez.
 */
export function validateLaborAllocationApply(
  suggestedLines: readonly LaborAllocationSuggestedLine[],
  appliedLines: readonly LaborAllocationAppliedLineInput[],
): LaborAllocationApplyValidation {
  if (appliedLines.length === 0) return { allowed: false, code: 'APPLY_LINE_SELECTION_EMPTY' }
  const byOrdinal = new Map(suggestedLines.map((line) => [line.lineOrdinal, line]))
  const seen = new Set<number>()
  const lines: LaborAllocationAppliedLine[] = []

  for (const applied of appliedLines) {
    const suggested = byOrdinal.get(applied.lineOrdinal)
    if (suggested === undefined) return { allowed: false, code: 'APPLY_LINE_NOT_IN_RUN' }
    if (seen.has(applied.lineOrdinal)) return { allowed: false, code: 'APPLY_LINE_DUPLICATED' }
    seen.add(applied.lineOrdinal)

    if (!Number.isSafeInteger(applied.partAmountMinor) || applied.partAmountMinor < 0
      || !Number.isSafeInteger(applied.laborAmountMinor) || applied.laborAmountMinor < 0
      || applied.partAmountMinor + applied.laborAmountMinor <= 0) {
      return { allowed: false, code: 'APPLY_LINE_AMOUNT_INVALID' }
    }
    if (applied.description.trim() === '' || applied.action.trim() === '') {
      return { allowed: false, code: 'APPLY_LINE_TEXT_INVALID' }
    }

    const modified = applied.partAmountMinor !== suggested.partAmountMinor
      || applied.laborAmountMinor !== suggested.laborAmountMinor
      || !sameText(applied.description, suggested.description)
      || !sameText(applied.action, suggested.action)
    lines.push({ lineOrdinal: applied.lineOrdinal, suggested, applied, modified })
  }

  lines.sort((left, right) => left.lineOrdinal - right.lineOrdinal)
  return {
    allowed: true,
    lines,
    modifiedCount: lines.filter((line) => line.modified).length,
    controlRequiredCount: lines.filter((line) => line.suggested.controlRequired).length,
  }
}

/**
 * Uygulanan satırları mevcut föy satırlarının üzerine yazar.
 *
 * Seçilmeyen satırlar OLDUĞU GİBİ korunur: kısmi seçim, seçilmeyen kalemleri
 * föyden düşürmez. Sıra korunur; kanıt alanları (parça kodu, hasar bölgesi)
 * kullanıcının föydeki girdisidir ve AI tarafından değiştirilmez.
 */
export function mergeAppliedLinesIntoSheet(
  sheetLines: readonly NormalizedLaborItem[],
  appliedLines: readonly LaborAllocationAppliedLine[],
): readonly NormalizedLaborItem[] {
  const byOrdinal = new Map(appliedLines.map((line) => [line.lineOrdinal, line.applied]))
  return sheetLines.map((line, index) => {
    const applied = byOrdinal.get(index + 1)
    if (applied === undefined) return line
    return {
      ...line,
      description: applied.description.trim(),
      action: applied.action.trim(),
      partAmountMinor: applied.partAmountMinor,
      laborAmountMinor: applied.laborAmountMinor,
    }
  })
}

/** Föye gerçekten uygulanmış, tamamlanmış bir dağıtım satırı. */
export interface LaborAllocationApprovedRecord {
  readonly runId: string
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  readonly partCode: string | null
  readonly damageRegion: string | null
  readonly operationTypes: readonly LaborOperationType[]
  /**
   * P64 — uygulanan kategori dağılımı. Provenance yoksa `null` gelir ve o
   * satır kategori geçmişi SAYILMAZ; eksikliği sıfır dağılım gibi okumak
   * uydurma olurdu.
   */
  readonly categoryAmounts?: readonly LaborCategoryAmount[] | null
}

export interface LaborAllocationApprovedHistoryEntry {
  readonly description: string
  readonly action: string
  readonly operationTypes: readonly LaborOperationType[]
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  /**
   * P64 — bu satır için tutarlı onaylanmış kategori dağılımı. Çelişen ya da
   * provenance'ı olmayan geçmişte `null` kalır.
   */
  readonly categoryAmounts: readonly LaborCategoryAmount[] | null
}

function operationSignature(types: readonly LaborOperationType[]): string {
  return [...new Set(types)].sort().join('|')
}

function matchesRecord(
  line: LaborAllocationEvidenceLine,
  record: LaborAllocationApprovedRecord,
): boolean {
  if (normalizeBaselineMatchText(line.description) !== normalizeBaselineMatchText(record.description)) {
    return false
  }
  if (normalizeBaselineMatchText(line.action) !== normalizeBaselineMatchText(record.action)) return false
  // Ayırt edici alanlar yalnız iki tarafta da doluysa uygulanır.
  if (line.partCode !== null && record.partCode !== null
    && normalizeBaselineMatchText(line.partCode) !== normalizeBaselineMatchText(record.partCode)) {
    return false
  }
  if (line.damageRegion !== null && record.damageRegion !== null
    && normalizeBaselineMatchText(line.damageRegion) !== normalizeBaselineMatchText(record.damageRegion)) {
    return false
  }
  return true
}

/**
 * Onaylı geçmişi yalnız GERÇEKTEN uygulanmış kayıtlardan türetir.
 *
 * Geçmiş, baseline'dan farklı olarak tek bir föy değil bir HAVUZDUR. Bu yüzden
 * baseline'ın karşılıklı-tek kuralı buraya uymaz: aynı kalemin birden çok kez
 * onaylanmış olması belirsizlik değil, tutarlı kanıttır.
 *
 * Belirsizlik, eşleşen kayıtların BİRBİRİYLE ÇELİŞMESİDİR: aynı kalem/işlem
 * için farklı operasyon türü kümeleri onaylanmışsa tek bir doğru cevap yoktur
 * ve geçmiş kullanılmaz.
 *
 * Diğer kurallar:
 *  - Mevcut run kendi girdisine geçmiş olarak dahil edilmez; aksi halde model
 *    kendi çıktısını kanıt olarak görürdü.
 *  - Öğrenme örneği UYGULANAN değerdir; AI'nin ilk önerisi değil (çağıran zaten
 *    uygulanan snapshot'ı geçirir).
 *  - Organization sınırı çağıranın sorgusunda uygulanır.
 */
export function deriveApprovedHistory(
  currentLines: readonly LaborAllocationEvidenceLine[],
  approvedRecords: readonly LaborAllocationApprovedRecord[],
  currentRunId: string | null,
): {
  readonly entries: readonly LaborAllocationApprovedHistoryEntry[]
  /** Satır sırasına göre eşleşen geçmiş; çelişkili veya yoksa yer almaz. */
  readonly byOrdinal: ReadonlyMap<number, LaborAllocationApprovedHistoryEntry>
  /**
   * P64 — kategori geçmişi AYRI eksendir ve operasyon türü kapısına
   * bağlanmaz. Operasyon türleri çelişse bile branş dağılımı tutarlı
   * olabilir; tersi de mümkündür. İki ekseni tek kapıya bağlamak, birinin
   * belirsizliğini diğerinin kanıtını silmek için kullanmak olurdu.
   */
  readonly categoryByOrdinal: ReadonlyMap<number, readonly LaborCategoryAmount[]>
  readonly complete: boolean
} {
  const usable = approvedRecords.filter((record) => record.runId !== currentRunId)
  const byOrdinal = new Map<number, LaborAllocationApprovedHistoryEntry>()
  const categoryByOrdinal = new Map<number, readonly LaborCategoryAmount[]>()
  const entries: LaborAllocationApprovedHistoryEntry[] = []

  for (const line of currentLines) {
    const candidates = usable.filter((record) => matchesRecord(line, record))
    if (candidates.length === 0) continue

    /*
     * Kategori havuzu: YALNIZ provenance'ı dolu kayıtlar. Kullanıcının
     * işçilik tutarını değiştirip dağılımı bilinmiyor bıraktığı satırlar
     * havuza girmez; eksikliği kanıt saymak uydurma olurdu. Tutarlılık
     * paylar üzerinden ölçülür, çünkü fiyat revizyonu meşrudur.
     */
    const categorySamples = candidates
      .map((record) => record.categoryAmounts)
      .filter((amounts): amounts is readonly LaborCategoryAmount[] =>
        amounts !== undefined && amounts !== null)
    const consistentCategories = selectConsistentCategoryHistory(categorySamples)
    if (consistentCategories !== null) {
      categoryByOrdinal.set(line.ordinal, consistentCategories)
    }

    const signatures = new Set(candidates.map((record) => operationSignature(record.operationTypes)))
    // Çelişkili geçmiş kanıt sayılmaz: tek bir onaylanmış cevap yoktur.
    if (signatures.size !== 1) continue
    const newest = candidates[0] as LaborAllocationApprovedRecord
    const entry: LaborAllocationApprovedHistoryEntry = {
      description: newest.description,
      action: newest.action,
      operationTypes: newest.operationTypes,
      partAmountMinor: newest.partAmountMinor,
      laborAmountMinor: newest.laborAmountMinor,
      categoryAmounts: consistentCategories,
    }
    byOrdinal.set(line.ordinal, entry)
    entries.push(entry)
  }

  return {
    entries,
    byOrdinal,
    categoryByOrdinal,
    complete: currentLines.length > 0 && byOrdinal.size === currentLines.length,
  }
}
