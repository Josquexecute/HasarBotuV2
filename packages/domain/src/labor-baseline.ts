// Yalnız tip bağımlılığı: derleme sonrası çalışma zamanı döngüsü oluşmaz.
import type { LaborAllocationEvidenceLine } from './labor-allocation-ai.js'

/**
 * Paket 57 — eksper baseline eşleştirme ve karşılaştırma kuralları.
 *
 * Baseline, aynı dosyanın ÖNCEKİ immutable föy sürümüdür; yani kullanıcının
 * açıkça onaylayarak kaydettiği nihai dağılımdır. AI önerileri ayrı bir
 * aggregate'te durur ve hiçbir koşulda baseline sayılmaz — bu ayrım veri
 * kaynağında yapılır, burada değil.
 *
 * Baseline otomatik doğru DEĞİLDİR; yalnız kanıttır. Bu modül baseline ile
 * öneri arasındaki farkı ölçer, hangisinin haklı olduğuna karar vermez.
 */
export const LABOR_BASELINE_MATCH_VERSION = 'labor-baseline-match/1.0.0' as const
export const LABOR_BASELINE_COMPARISON_VERSION = 'labor-baseline-comparison/1.0.0' as const

/**
 * Parça payı oranındaki bu farkın üstü çelişki sayılır.
 *
 * Eşik sabit koda gömülmez; sürümlü karşılaştırma kuralının parçasıdır ve
 * `LABOR_BASELINE_COMPARISON_VERSION` ile birlikte önerinin üstünde saklanır.
 */
export const LABOR_BASELINE_PART_RATIO_TOLERANCE = 0.2

export type LaborBaselineMatchReason = 'matched' | 'no_candidate' | 'ambiguous'

export interface LaborBaselineLineMatch {
  /** Analiz edilen güncel föy satırının sırası (1 tabanlı). */
  readonly ordinal: number
  readonly baseline: LaborAllocationEvidenceLine | null
  readonly reason: LaborBaselineMatchReason
}

/**
 * Eşleştirme için metin normalizasyonu.
 *
 * Türkçe kaynaklı iki metin karşılaştırıldığı için `tr` yerelinde katlama
 * yapılır: `I`/`ı` ve `İ`/`i` ayrımı korunur.
 */
export function normalizeBaselineMatchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
}

/** İki opsiyonel alan yalnız İKİSİ de doluyken ayırt edici sayılır. */
function compatible(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return true
  return normalizeBaselineMatchText(left) === normalizeBaselineMatchText(right)
}

function isCandidate(
  current: LaborAllocationEvidenceLine,
  baseline: LaborAllocationEvidenceLine,
): boolean {
  return normalizeBaselineMatchText(current.description) === normalizeBaselineMatchText(baseline.description)
    && normalizeBaselineMatchText(current.action) === normalizeBaselineMatchText(baseline.action)
    && compatible(current.partCode, baseline.partCode)
    && compatible(current.damageRegion, baseline.damageRegion)
}

/**
 * Güncel satırları baseline satırlarıyla eşleştirir.
 *
 * Eşleştirme yalnız açıklamaya dayanmaz: açıklama ve işlem her satırda zorunlu
 * olduğu için birlikte aday kümesini kurar, parça kodu ve hasar bölgesi ise
 * yalnız iki tarafta da doluysa ayırt edici olarak kullanılır.
 *
 * Eşleşme yalnız KARŞILIKLI TEK olduğunda kabul edilir: bir güncel satırın tek
 * adayı varsa ve o baseline satırının da tek adayı o güncel satırsa. Aksi
 * durumda satır `ambiguous` sayılır ve baseline yokmuş gibi davranılır —
 * belirsiz eşleşme sessizce "en yakın" satıra bağlanmaz.
 */
export function matchBaselineLines(
  currentLines: readonly LaborAllocationEvidenceLine[],
  baselineLines: readonly LaborAllocationEvidenceLine[],
): readonly LaborBaselineLineMatch[] {
  const forward = currentLines.map((current) => (
    baselineLines.filter((baseline) => isCandidate(current, baseline))
  ))
  return currentLines.map((current, index) => {
    const candidates = forward[index] as LaborAllocationEvidenceLine[]
    if (candidates.length === 0) {
      return { ordinal: current.ordinal, baseline: null, reason: 'no_candidate' }
    }
    if (candidates.length > 1) {
      return { ordinal: current.ordinal, baseline: null, reason: 'ambiguous' }
    }
    const only = candidates[0] as LaborAllocationEvidenceLine
    const claimants = forward.filter((set) => set.includes(only)).length
    if (claimants !== 1) {
      return { ordinal: current.ordinal, baseline: null, reason: 'ambiguous' }
    }
    return { ordinal: current.ordinal, baseline: only, reason: 'matched' }
  })
}

/**
 * Baseline kanıtı yalnız HER satır belirsizlik olmadan eşleştiğinde tam sayılır.
 *
 * Eksik kanıt kodları satır bazlı değil plan bazlıdır ve bütün satırlara
 * taşınır; bir satırın baseline'ı yokken kodu kaldırmak, o satır için baseline
 * varmış gibi davranmak olurdu.
 */
export function hasCompleteBaselineMatch(matches: readonly LaborBaselineLineMatch[]): boolean {
  return matches.length > 0 && matches.every((match) => match.reason === 'matched')
}

export interface LaborBaselineComparison {
  readonly comparisonVersion: typeof LABOR_BASELINE_COMPARISON_VERSION
  readonly baselinePartRatio: number
  readonly suggestedPartRatio: number
  readonly deltaRatio: number
  readonly conflicts: boolean
}

function ratio(partLike: number, laborLike: number): number {
  const total = partLike + laborLike
  if (total <= 0) return 0
  return partLike / total
}

/**
 * Baseline ile öneriyi ekonomik ŞEKİL üzerinden karşılaştırır.
 *
 * Karşılaştırma tutar büyüklüğüne değil parça payı oranına bakar: kullanıcı
 * föyü revize ettiğinde tutarlar meşru biçimde değişebilir, ama eksperin
 * onayladığı parça/işçilik dengesinden belirgin sapma kontrol gerektirir.
 *
 * Bu bir doğruluk iddiası değildir; hangi tarafın haklı olduğunu söylemez,
 * yalnız farkı ölçer ve insana taşır.
 */
export function compareBaselineAllocation(
  baseline: LaborAllocationEvidenceLine,
  suggested: { readonly partLikeMinor: number; readonly laborLikeMinor: number },
): LaborBaselineComparison {
  const baselinePartRatio = ratio(baseline.partAmountMinor, baseline.laborAmountMinor)
  const suggestedPartRatio = ratio(suggested.partLikeMinor, suggested.laborLikeMinor)
  const deltaRatio = Math.abs(baselinePartRatio - suggestedPartRatio)
  return {
    comparisonVersion: LABOR_BASELINE_COMPARISON_VERSION,
    baselinePartRatio,
    suggestedPartRatio,
    deltaRatio,
    conflicts: deltaRatio > LABOR_BASELINE_PART_RATIO_TOLERANCE,
  }
}
