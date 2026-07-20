import { describe, expect, it } from 'vitest'
import {
  effectiveCategoryAmounts,
  parseCategoryMinor,
  sharePercent,
  type CategoryLine,
} from './laborCategoryRules'

/**
 * Paket 64 — kategori paneli kuralları.
 *
 * Buradaki iddiaların hepsi tek bir ilkeye dayanır: panel kullanıcının
 * girmediği hiçbir sayıyı üretmez. Geçersiz girdi sessizce düzeltilmez,
 * eksik provenance sıfır dağılıma çevrilmez, kalan fark dağıtılmaz.
 */
const CATEGORIES = [
  'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
  'glass', 'calibration', 'repair', 'paint',
] as const

function line(amounts: Partial<Record<string, number>> | null): CategoryLine {
  return {
    lineOrdinal: 1,
    sourceDescription: 'Ön tampon',
    sourceAction: 'Onarım',
    sourcePartAmountMinor: 0,
    sourceLaborAmountMinor: 100_000,
    allocations: [],
    repairReplaceOpinion: 'repair_indicated',
    economicComparison: {
      buckets: {} as never,
      repairTotalMinor: 0,
      replaceTotalMinor: 0,
      note: 'test',
    },
    reasoning: 'test',
    evidenceRefs: [],
    confidence: 0.9,
    conflictCodes: [],
    missingEvidenceCodes: [],
    controlRequired: false,
    baseline: null,
    categoryAllocation: amounts === null ? null : {
      schemaVersion: 'labor-category-allocation/1.0.0',
      amounts: CATEGORIES.map((category) => ({
        category,
        amountMinor: amounts[category] ?? 0,
      })),
      confidence: 0.8,
      conflictCodes: [],
      baselineAmounts: null,
      historyAmounts: null,
    },
  } as CategoryLine
}

describe('kategori girdisi doğrulaması', () => {
  it('negatif tutar reddedilir', () => {
    expect(parseCategoryMinor('-5')).toBeNull()
  })

  it('sayı olmayan girdi reddedilir', () => {
    expect(parseCategoryMinor('abc')).toBeNull()
    expect(parseCategoryMinor('12,5,7')).toBeNull()
  })

  it('tam kuruşa oturmayan küsurat reddedilir; sessizce yuvarlanmaz', () => {
    expect(parseCategoryMinor('10.567')).toBeNull()
  })

  it('geçerli tutar kuruşa çevrilir', () => {
    expect(parseCategoryMinor('1234.56')).toBe(123_456)
    expect(parseCategoryMinor('1234,56')).toBe(123_456)
  })

  it('boş alan sıfır sayılır', () => {
    expect(parseCategoryMinor('')).toBe(0)
  })
})

describe('yürürlükteki kategori dağılımı', () => {
  it('provenance yoksa null döner; sıfır dağılım UYDURULMAZ', () => {
    expect(effectiveCategoryAmounts(line(null), undefined)).toBeNull()
  })

  it('kullanıcı düzeltmesi yoksa AI önerisi geçerlidir', () => {
    const result = effectiveCategoryAmounts(line({ bodywork: 100_000 }), undefined)
    expect(result?.find((item) => item.category === 'bodywork')?.amountMinor).toBe(100_000)
  })

  it('tek geçersiz alan TÜM satırı geçersiz kılar', () => {
    // Kısmi kabul, kullanıcının görmediği bir dağılım üretirdi.
    const draft = Object.fromEntries(CATEGORIES.map((category) => [category, '0']))
    draft.paint = '-1'
    expect(effectiveCategoryAmounts(line({ bodywork: 100_000 }), draft)).toBeNull()
  })

  it('kullanıcı düzeltmesi AI önerisinin yerine geçer', () => {
    const draft = Object.fromEntries(CATEGORIES.map((category) => [category, '0']))
    draft.paint = '1000.00'
    const result = effectiveCategoryAmounts(line({ bodywork: 100_000 }), draft)
    expect(result?.find((item) => item.category === 'paint')?.amountMinor).toBe(100_000)
    expect(result?.find((item) => item.category === 'bodywork')?.amountMinor).toBe(0)
  })

  it('toplam eksik kalırsa fark hiçbir kategoriye eklenmez', () => {
    const draft = Object.fromEntries(CATEGORIES.map((category) => [category, '0']))
    draft.paint = '400.00'
    const result = effectiveCategoryAmounts(line({ bodywork: 100_000 }), draft)
    const total = (result ?? []).reduce((sum, item) => sum + item.amountMinor, 0)
    // Panel eksiği kapatmaz; toplam 40.000 kalır ve uygulama üst katmanda bloklanır.
    expect(total).toBe(40_000)
  })
})

describe('pay görünümü', () => {
  const amounts = CATEGORIES.map((category) => ({
    category,
    amountMinor: category === 'bodywork' ? 70_000 : category === 'paint' ? 30_000 : 0,
  }))

  it('payları yüzde olarak verir', () => {
    expect(sharePercent(amounts, 'bodywork')).toBeCloseTo(70)
    expect(sharePercent(amounts, 'paint')).toBeCloseTo(30)
  })

  it('toplam sıfırsa pay hesaplanamaz; sıfır gösterilmez', () => {
    const empty = CATEGORIES.map((category) => ({ category, amountMinor: 0 }))
    expect(sharePercent(empty, 'bodywork')).toBeNull()
  })
})
