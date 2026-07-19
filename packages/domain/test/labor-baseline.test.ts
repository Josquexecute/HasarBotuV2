import { describe, expect, it } from 'vitest'
import {
  LABOR_BASELINE_PART_RATIO_TOLERANCE,
  compareBaselineAllocation,
  hasCompleteBaselineMatch,
  matchBaselineLines,
  normalizeBaselineMatchText,
  type LaborAllocationEvidenceLine,
} from '../src/index.js'

function line(
  ordinal: number,
  description: string,
  action: string,
  overrides: Partial<LaborAllocationEvidenceLine> = {},
): LaborAllocationEvidenceLine {
  return {
    ordinal,
    description,
    action,
    partAmountMinor: 1_000_00,
    laborAmountMinor: 1_000_00,
    partCode: null,
    damageRegion: null,
    ...overrides,
  }
}

describe('normalizeBaselineMatchText', () => {
  it('boşluk ve büyük/küçük harf farkını yok sayar', () => {
    expect(normalizeBaselineMatchText('  Ön   Tampon ')).toBe('ön tampon')
  })

  it('Türkçe I/İ ayrımını korur', () => {
    // tr yerelinde 'I' → 'ı', 'İ' → 'i'. Bu ayrım kaybolursa farklı kalemler
    // yanlışlıkla eşleşebilir.
    expect(normalizeBaselineMatchText('IŞIK')).toBe('ışık')
    expect(normalizeBaselineMatchText('İŞÇİLİK')).toBe('işçilik')
    expect(normalizeBaselineMatchText('IŞIK')).not.toBe(normalizeBaselineMatchText('İŞİK'))
  })
})

describe('matchBaselineLines', () => {
  it('açıklama ve işlem birlikte eşleşince satırı bağlar', () => {
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim')],
      [line(1, 'ön  TAMPON', 'değişim', { partAmountMinor: 500_00 })],
    )
    expect(matches[0]?.reason).toBe('matched')
    expect(matches[0]?.baseline?.partAmountMinor).toBe(500_00)
    expect(hasCompleteBaselineMatch(matches)).toBe(true)
  })

  it('yalnız açıklama eşleşmesi yetmez; işlem farklıysa bağlamaz', () => {
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim')],
      [line(1, 'Ön tampon', 'Onarım')],
    )
    expect(matches[0]?.reason).toBe('no_candidate')
    expect(hasCompleteBaselineMatch(matches)).toBe(false)
  })

  it('parça kodu iki tarafta da doluysa ayırt edicidir', () => {
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim', { partCode: 'TMP-1' })],
      [
        line(1, 'Ön tampon', 'Değişim', { partCode: 'TMP-2' }),
        line(2, 'Ön tampon', 'Değişim', { partCode: 'TMP-1', laborAmountMinor: 7_00 }),
      ],
    )
    expect(matches[0]?.reason).toBe('matched')
    expect(matches[0]?.baseline?.laborAmountMinor).toBe(7_00)
  })

  it('parça kodu yalnız bir tarafta doluysa ayırt edici sayılmaz', () => {
    // Eski föy sürümlerinde kod null'dır; tek taraflı kod eşleşmeyi bozmamalı.
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim', { partCode: 'TMP-1' })],
      [line(1, 'Ön tampon', 'Değişim', { partCode: null })],
    )
    expect(matches[0]?.reason).toBe('matched')
  })

  it('hasar bölgesi de ayırt edici alandır', () => {
    const matches = matchBaselineLines(
      [line(1, 'Kapı', 'Onarım', { damageRegion: 'Sol ön' })],
      [
        line(1, 'Kapı', 'Onarım', { damageRegion: 'Sağ arka' }),
        line(2, 'Kapı', 'Onarım', { damageRegion: 'Sol ön', partAmountMinor: 42_00 }),
      ],
    )
    expect(matches[0]?.baseline?.partAmountMinor).toBe(42_00)
  })

  it('birden çok aday kalırsa baseline varmış gibi davranmaz', () => {
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim')],
      [line(1, 'Ön tampon', 'Değişim'), line(2, 'Ön tampon', 'Değişim')],
    )
    expect(matches[0]?.reason).toBe('ambiguous')
    expect(matches[0]?.baseline).toBeNull()
    expect(hasCompleteBaselineMatch(matches)).toBe(false)
  })

  it('iki güncel satır aynı baseline satırını talep ederse ikisi de reddedilir', () => {
    // Karşılıklı teklik: tek yönlü tek adaylık yeterli değildir.
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim'), line(2, 'Ön tampon', 'Değişim')],
      [line(1, 'Ön tampon', 'Değişim')],
    )
    expect(matches.map((match) => match.reason)).toEqual(['ambiguous', 'ambiguous'])
  })

  it('bir satır bile eşleşmezse kanıt tam sayılmaz', () => {
    const matches = matchBaselineLines(
      [line(1, 'Ön tampon', 'Değişim'), line(2, 'Yeni kalem', 'Onarım')],
      [line(1, 'Ön tampon', 'Değişim')],
    )
    expect(matches[0]?.reason).toBe('matched')
    expect(matches[1]?.reason).toBe('no_candidate')
    expect(hasCompleteBaselineMatch(matches)).toBe(false)
  })

  it('boş föyde kanıt tam sayılmaz', () => {
    expect(hasCompleteBaselineMatch([])).toBe(false)
  })
})

describe('compareBaselineAllocation', () => {
  const baseline = line(1, 'Ön tampon', 'Değişim', {
    partAmountMinor: 9_000_00,
    laborAmountMinor: 1_000_00,
  })

  it('aynı ekonomik şekilde çelişki üretmez', () => {
    const result = compareBaselineAllocation(baseline, {
      partLikeMinor: 9_000_00,
      laborLikeMinor: 1_000_00,
    })
    expect(result.baselinePartRatio).toBeCloseTo(0.9)
    expect(result.suggestedPartRatio).toBeCloseTo(0.9)
    expect(result.conflicts).toBe(false)
  })

  it('tutarlar değişse de oran korunuyorsa çelişki üretmez', () => {
    // Kullanıcı föyü meşru biçimde revize edebilir; karşılaştırma büyüklüğe
    // değil şekle bakar.
    const result = compareBaselineAllocation(baseline, {
      partLikeMinor: 18_000_00,
      laborLikeMinor: 2_000_00,
    })
    expect(result.conflicts).toBe(false)
  })

  it('parça payı belirgin saparsa çelişki üretir', () => {
    const result = compareBaselineAllocation(baseline, {
      partLikeMinor: 1_000_00,
      laborLikeMinor: 9_000_00,
    })
    expect(result.deltaRatio).toBeCloseTo(0.8)
    expect(result.conflicts).toBe(true)
  })

  it('eşiğin tam üstünde çelişki, tam altında sessizlik', () => {
    const under = compareBaselineAllocation(
      line(1, 'x', 'y', { partAmountMinor: 100, laborAmountMinor: 0 }),
      { partLikeMinor: 100 - Math.round(LABOR_BASELINE_PART_RATIO_TOLERANCE * 100), laborLikeMinor: Math.round(LABOR_BASELINE_PART_RATIO_TOLERANCE * 100) },
    )
    expect(under.deltaRatio).toBeCloseTo(LABOR_BASELINE_PART_RATIO_TOLERANCE)
    expect(under.conflicts).toBe(false)

    const over = compareBaselineAllocation(
      line(1, 'x', 'y', { partAmountMinor: 100, laborAmountMinor: 0 }),
      { partLikeMinor: 50, laborLikeMinor: 50 },
    )
    expect(over.conflicts).toBe(true)
  })

  it('sıfır toplamda bölme hatası üretmez', () => {
    const result = compareBaselineAllocation(
      line(1, 'x', 'y', { partAmountMinor: 0, laborAmountMinor: 0 }),
      { partLikeMinor: 0, laborLikeMinor: 0 },
    )
    expect(result.baselinePartRatio).toBe(0)
    expect(result.suggestedPartRatio).toBe(0)
    expect(result.conflicts).toBe(false)
  })
})
