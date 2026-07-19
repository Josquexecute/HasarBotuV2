import type { LaborAllocationLineSuggestion } from './labor-allocation-ai.js'

/**
 * Paket 61 — büyük föyler için deterministik chunking (HB-2026-068).
 *
 * Paket 59'da gerçek Gemini ile yapılan yük ölçümü (2026-07-19) tek çağrının
 * büyük föylerde politika tavanına çarptığını gösterdi:
 *
 *   10 satır  →  9,7 sn   ✔
 *   25 satır  → 20,3 sn   ✔
 *   50 satır  → 30,0 sn   ✘ AI_PROVIDER_TIMEOUT
 *  100 satır  → 30,0 sn   ✘ AI_PROVIDER_TIMEOUT
 *
 * Ölçülen doğrusal davranış: satır başına ~0,81 sn ve ~307 çıktı token'ı.
 * 30 sn'lik politika tavanı YÜKSELTİLMEDİ; iş bölünüyor.
 *
 * `LABOR_ALLOCATION_CHUNK_SIZE = 20` seçimi ölçüme dayanır: 25 satır tavanın
 * %68'ini kullandı, 20 satır ~16 sn (%55) beklenir ve model yavaşladığında
 * bile marj bırakır. Sabit, sürümlü ve run kimliğinde saklanır.
 */
export const LABOR_ALLOCATION_CHUNK_STRATEGY_VERSION = 'labor-allocation-chunking/1.0.0' as const
export const LABOR_ALLOCATION_CHUNK_SIZE = 20

export interface LaborAllocationChunk {
  readonly index: number
  /** Föydeki ilk satırın 1 tabanlı sırası. */
  readonly startOrdinal: number
  readonly lineCount: number
}

/**
 * Satırları deterministik, çakışmasız ve boşluksuz gruplara ayırır.
 *
 * Aynı girdi her zaman aynı bölünmeyi üretir; grup sınırları satır sırasına
 * göredir, içerikten etkilenmez.
 */
export function planLaborAllocationChunks(
  lineCount: number,
  chunkSize: number = LABOR_ALLOCATION_CHUNK_SIZE,
): readonly LaborAllocationChunk[] {
  if (!Number.isSafeInteger(lineCount) || lineCount < 1) return []
  const size = Number.isSafeInteger(chunkSize) && chunkSize >= 1 ? chunkSize : LABOR_ALLOCATION_CHUNK_SIZE
  const chunks: LaborAllocationChunk[] = []
  for (let start = 0; start < lineCount; start += size) {
    chunks.push({
      index: chunks.length,
      startOrdinal: start + 1,
      lineCount: Math.min(size, lineCount - start),
    })
  }
  return chunks
}

export type LaborAllocationMergeFailure =
  | 'CHUNK_RESULT_MISSING'
  | 'CHUNK_LINE_COUNT_MISMATCH'
  | 'CHUNK_LINE_ORDINAL_INVALID'
  | 'MERGED_LINE_DUPLICATED'
  | 'MERGED_LINE_COVERAGE_INVALID'

export type LaborAllocationMergeResult =
  | { readonly merged: false; readonly code: LaborAllocationMergeFailure }
  | { readonly merged: true; readonly lines: readonly LaborAllocationLineSuggestion[] }

/**
 * Grup sonuçlarını sunucuda deterministik biçimde birleştirir.
 *
 * Her grup kendi içinde 1..k numaralanır; birleştirme sırasında global sıraya
 * yeniden eşlenir. Eksik, tekrarlı veya kapsama dışı tek bir satır bile TÜM
 * birleştirmeyi başarısız kılar — kısmi sonuç döndürülmez ve eksik satır
 * sessizce tamamlanmaz.
 */
export function mergeLaborAllocationChunks(
  chunks: readonly LaborAllocationChunk[],
  results: readonly (readonly LaborAllocationLineSuggestion[] | null)[],
  totalLineCount: number,
): LaborAllocationMergeResult {
  const merged: LaborAllocationLineSuggestion[] = []
  const seen = new Set<number>()

  for (const chunk of chunks) {
    const lines = results[chunk.index]
    if (lines === null || lines === undefined) return { merged: false, code: 'CHUNK_RESULT_MISSING' }
    if (lines.length !== chunk.lineCount) {
      return { merged: false, code: 'CHUNK_LINE_COUNT_MISMATCH' }
    }
    for (const line of lines) {
      if (!Number.isSafeInteger(line.lineOrdinal)
        || line.lineOrdinal < 1
        || line.lineOrdinal > chunk.lineCount) {
        return { merged: false, code: 'CHUNK_LINE_ORDINAL_INVALID' }
      }
      const globalOrdinal = chunk.startOrdinal + line.lineOrdinal - 1
      if (seen.has(globalOrdinal)) return { merged: false, code: 'MERGED_LINE_DUPLICATED' }
      seen.add(globalOrdinal)
      merged.push({ ...line, lineOrdinal: globalOrdinal })
    }
  }

  if (merged.length !== totalLineCount || seen.size !== totalLineCount) {
    return { merged: false, code: 'MERGED_LINE_COVERAGE_INVALID' }
  }
  for (let ordinal = 1; ordinal <= totalLineCount; ordinal += 1) {
    if (!seen.has(ordinal)) return { merged: false, code: 'MERGED_LINE_COVERAGE_INVALID' }
  }

  merged.sort((left, right) => left.lineOrdinal - right.lineOrdinal)
  return { merged: true, lines: merged }
}
