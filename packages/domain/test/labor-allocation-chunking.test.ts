import { describe, expect, it } from 'vitest'
import {
  LABOR_ALLOCATION_CHUNK_SIZE,
  mergeLaborAllocationChunks,
  planLaborAllocationChunks,
  type LaborAllocationLineSuggestion,
} from '../src/index.js'

function line(lineOrdinal: number): LaborAllocationLineSuggestion {
  return {
    lineOrdinal,
    allocations: [{ operationType: 'repair', amountMinor: 1_000 }],
    repairReplaceOpinion: 'repair_indicated',
    economicComparison: {
      buckets: {
        repair_labor: 1_000,
        new_part_or_ownership: 0,
        remove_install: 0,
        paint_and_consumable: 0,
        calibration: 0,
        related_operations: 0,
      },
      repairTotalMinor: 1_000,
      replaceTotalMinor: 0,
      note: 'not',
    },
    reasoning: 'gerekce',
    evidenceRefs: [],
    confidence: 0.9,
    conflictCodes: [],
    missingEvidenceCodes: [],
    controlRequired: true,
  }
}

/** Grup içinde satırlar 1..k numaralanır. */
function chunkResult(count: number) {
  return Array.from({ length: count }, (_unused, index) => line(index + 1))
}

describe('planLaborAllocationChunks', () => {
  it('satırları çakışmasız ve boşluksuz böler', () => {
    const chunks = planLaborAllocationChunks(50, 20)
    expect(chunks).toEqual([
      { index: 0, startOrdinal: 1, lineCount: 20 },
      { index: 1, startOrdinal: 21, lineCount: 20 },
      { index: 2, startOrdinal: 41, lineCount: 10 },
    ])
    // Toplam kapsama tam.
    expect(chunks.reduce((sum, chunk) => sum + chunk.lineCount, 0)).toBe(50)
  })

  it('deterministiktir', () => {
    expect(planLaborAllocationChunks(37)).toEqual(planLaborAllocationChunks(37))
  })

  it('chunk boyutundan küçük föyü tek gruba koyar', () => {
    expect(planLaborAllocationChunks(5, 20)).toEqual([
      { index: 0, startOrdinal: 1, lineCount: 5 },
    ])
  })

  it('tam bölünen föyde artık grup üretmez', () => {
    const chunks = planLaborAllocationChunks(40, 20)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toEqual({ index: 1, startOrdinal: 21, lineCount: 20 })
  })

  it('geçersiz girdide boş döner', () => {
    expect(planLaborAllocationChunks(0)).toEqual([])
    expect(planLaborAllocationChunks(-3)).toEqual([])
  })

  it('varsayılan boyut ölçüme dayalı sabittir', () => {
    expect(LABOR_ALLOCATION_CHUNK_SIZE).toBe(20)
    expect(planLaborAllocationChunks(21)).toHaveLength(2)
  })
})

describe('mergeLaborAllocationChunks', () => {
  it('grup sonuçlarını global sıraya deterministik eşler', () => {
    const chunks = planLaborAllocationChunks(30, 20)
    const result = mergeLaborAllocationChunks(
      chunks,
      [chunkResult(20), chunkResult(10)],
      30,
    )
    expect(result.merged).toBe(true)
    if (!result.merged) return
    expect(result.lines).toHaveLength(30)
    expect(result.lines.map((item) => item.lineOrdinal))
      .toEqual(Array.from({ length: 30 }, (_unused, index) => index + 1))
  })

  it('eksik grup sonucunda TÜM birleştirme başarısız olur', () => {
    const chunks = planLaborAllocationChunks(30, 20)
    const result = mergeLaborAllocationChunks(chunks, [chunkResult(20), null], 30)
    expect(result).toEqual({ merged: false, code: 'CHUNK_RESULT_MISSING' })
  })

  it('grup satır sayısı tutmuyorsa reddeder', () => {
    const chunks = planLaborAllocationChunks(30, 20)
    const result = mergeLaborAllocationChunks(chunks, [chunkResult(19), chunkResult(10)], 30)
    expect(result).toEqual({ merged: false, code: 'CHUNK_LINE_COUNT_MISMATCH' })
  })

  it('grup dışı satır sırası reddedilir', () => {
    // Satır sayısı doğru ama sıra grubun dışında: sessizce kaydırılmaz.
    const chunks = planLaborAllocationChunks(1, 20)
    const result = mergeLaborAllocationChunks(chunks, [[line(2)]], 1)
    expect(result).toEqual({ merged: false, code: 'CHUNK_LINE_ORDINAL_INVALID' })
  })

  it('tekrarlı satır reddedilir', () => {
    const chunks = planLaborAllocationChunks(2, 20)
    const result = mergeLaborAllocationChunks(chunks, [[line(1), line(1)]], 2)
    expect(result).toEqual({ merged: false, code: 'MERGED_LINE_DUPLICATED' })
  })

  it('toplam kapsama tutmuyorsa reddeder', () => {
    const chunks = planLaborAllocationChunks(30, 20)
    const result = mergeLaborAllocationChunks(chunks, [chunkResult(20), chunkResult(10)], 31)
    expect(result).toEqual({ merged: false, code: 'MERGED_LINE_COVERAGE_INVALID' })
  })

  it('kısmi sonuç döndürmez', () => {
    const chunks = planLaborAllocationChunks(40, 20)
    const result = mergeLaborAllocationChunks(chunks, [chunkResult(20)], 40)
    expect(result.merged).toBe(false)
  })
})
