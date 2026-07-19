import { describe, expect, it } from 'vitest'
import {
  deriveApprovedHistory,
  mergeAppliedLinesIntoSheet,
  validateLaborAllocationApply,
  type LaborAllocationAppliedLineInput,
  type LaborAllocationApprovedRecord,
  type LaborAllocationEvidenceLine,
  type LaborAllocationSuggestedLine,
  type NormalizedLaborItem,
} from '../src/index.js'

function suggested(
  ordinal: number,
  overrides: Partial<LaborAllocationSuggestedLine> = {},
): LaborAllocationSuggestedLine {
  return {
    lineOrdinal: ordinal,
    description: 'Ön tampon',
    action: 'Değişim',
    partAmountMinor: 900_000,
    laborAmountMinor: 100_000,
    operationTypes: ['replace'],
    controlRequired: false,
    ...overrides,
  }
}

function applied(
  ordinal: number,
  overrides: Partial<LaborAllocationAppliedLineInput> = {},
): LaborAllocationAppliedLineInput {
  return {
    lineOrdinal: ordinal,
    description: 'Ön tampon',
    action: 'Değişim',
    partAmountMinor: 900_000,
    laborAmountMinor: 100_000,
    ...overrides,
  }
}

describe('validateLaborAllocationApply', () => {
  it('değiştirilmemiş satırı modified saymaz', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(1)])
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.lines[0]?.modified).toBe(false)
    expect(result.modifiedCount).toBe(0)
  })

  it('tutar değişince satırı modified işaretler', () => {
    const result = validateLaborAllocationApply(
      [suggested(1)],
      [applied(1, { partAmountMinor: 800_000, laborAmountMinor: 200_000 })],
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.lines[0]?.modified).toBe(true)
    // Öneri kaydı korunur: öğrenme örneği uygulanan değerdir, öneri değil.
    expect(result.lines[0]?.suggested.partAmountMinor).toBe(900_000)
    expect(result.lines[0]?.applied.partAmountMinor).toBe(800_000)
  })

  it('yalnız boşluk farkı değişiklik sayılmaz', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(1, { description: ' Ön tampon ' })])
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.lines[0]?.modified).toBe(false)
  })

  it('boş seçim reddedilir', () => {
    const result = validateLaborAllocationApply([suggested(1)], [])
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_SELECTION_EMPTY' })
  })

  it('run dışındaki satır uygulanamaz', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(2)])
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_NOT_IN_RUN' })
  })

  it('aynı satır iki kez uygulanamaz', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(1), applied(1)])
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_DUPLICATED' })
  })

  it('her iki tutarı sıfır satır reddedilir', () => {
    const result = validateLaborAllocationApply(
      [suggested(1)],
      [applied(1, { partAmountMinor: 0, laborAmountMinor: 0 })],
    )
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_AMOUNT_INVALID' })
  })

  it('negatif tutar reddedilir', () => {
    const result = validateLaborAllocationApply(
      [suggested(1)],
      [applied(1, { partAmountMinor: -1 })],
    )
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_AMOUNT_INVALID' })
  })

  it('boş kalem metni reddedilir', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(1, { action: '   ' })])
    expect(result).toEqual({ allowed: false, code: 'APPLY_LINE_TEXT_INVALID' })
  })

  it('kontrol gerekli satır sayısını raporlar', () => {
    const result = validateLaborAllocationApply(
      [suggested(1, { controlRequired: true }), suggested(2)],
      [applied(1), applied(2)],
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.controlRequiredCount).toBe(1)
  })
})

describe('mergeAppliedLinesIntoSheet', () => {
  const sheet: readonly NormalizedLaborItem[] = [
    {
      description: 'Ön tampon', action: 'Değişim',
      partAmountMinor: 900_000, laborAmountMinor: 100_000,
      partCode: 'TMP-1', partCodeSource: 'user_entered', damageRegion: 'Ön orta',
    },
    {
      description: 'Sol kapı', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 500_000,
      partCode: null, partCodeSource: null, damageRegion: 'Sol',
    },
  ]

  it('kısmi seçimde seçilmeyen satır olduğu gibi kalır', () => {
    const result = validateLaborAllocationApply(
      [suggested(1), suggested(2, { description: 'Sol kapı', action: 'Onarım' })],
      [applied(1, { partAmountMinor: 700_000, laborAmountMinor: 300_000 })],
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    const merged = mergeAppliedLinesIntoSheet(sheet, result.lines)
    expect(merged).toHaveLength(2)
    expect(merged[0]?.partAmountMinor).toBe(700_000)
    // Seçilmeyen satır föyden düşmez ve değişmez.
    expect(merged[1]).toEqual(sheet[1])
  })

  it('kanıt alanları AI tarafından değiştirilmez', () => {
    const result = validateLaborAllocationApply([suggested(1)], [applied(1)])
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    const merged = mergeAppliedLinesIntoSheet(sheet, result.lines)
    expect(merged[0]?.partCode).toBe('TMP-1')
    expect(merged[0]?.damageRegion).toBe('Ön orta')
  })
})

describe('deriveApprovedHistory', () => {
  const current: readonly LaborAllocationEvidenceLine[] = [{
    ordinal: 1,
    description: 'Ön tampon',
    action: 'Değişim',
    partAmountMinor: 900_000,
    laborAmountMinor: 100_000,
    partCode: null,
    damageRegion: null,
  }]

  function record(overrides: Partial<LaborAllocationApprovedRecord> = {}): LaborAllocationApprovedRecord {
    return {
      runId: 'run-old',
      description: 'Ön tampon',
      action: 'Değişim',
      partAmountMinor: 800_000,
      laborAmountMinor: 200_000,
      partCode: null,
      damageRegion: null,
      operationTypes: ['replace'],
      ...overrides,
    }
  }

  it('uygulanan değeri öğrenme örneği yapar', () => {
    const result = deriveApprovedHistory(current, [record()], 'run-new')
    expect(result.complete).toBe(true)
    expect(result.entries).toHaveLength(1)
    // AI'nin ilk önerisi değil, gerçekte uygulanan tutar döner.
    expect(result.entries[0]?.partAmountMinor).toBe(800_000)
    expect(result.entries[0]?.operationTypes).toEqual(['replace'])
  })

  it('mevcut run kendi girdisine geçmiş olarak dahil edilmez', () => {
    const result = deriveApprovedHistory(current, [record({ runId: 'run-new' })], 'run-new')
    expect(result.entries).toHaveLength(0)
    expect(result.complete).toBe(false)
  })

  it('aynı cevabı veren birden çok kayıt belirsizlik değildir', () => {
    // Geçmiş bir havuzdur: aynı kalemin defalarca onaylanması tutarlı kanıttır.
    const result = deriveApprovedHistory(current, [record(), record()], 'run-new')
    expect(result.entries).toHaveLength(1)
    expect(result.complete).toBe(true)
  })

  it('çelişen geçmiş kullanılmaz', () => {
    // Aynı kalem için farklı operasyon türleri onaylanmışsa tek doğru yoktur.
    const result = deriveApprovedHistory(
      current,
      [record(), record({ operationTypes: ['repair'] })],
      'run-new',
    )
    expect(result.entries).toHaveLength(0)
    expect(result.complete).toBe(false)
  })

  it('eşleşmeyen geçmiş kanıt sayılmaz', () => {
    const result = deriveApprovedHistory(current, [record({ action: 'Onarım' })], 'run-new')
    expect(result.entries).toHaveLength(0)
    expect(result.complete).toBe(false)
  })

  it('geçmiş yoksa tam sayılmaz', () => {
    const result = deriveApprovedHistory(current, [], 'run-new')
    expect(result.complete).toBe(false)
  })
})
