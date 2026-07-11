import { describe, expect, it } from 'vitest'
import { getSearchTokens, matchesSearchQuery, normalizeSearchText } from './search'

describe('normalize edilmiş dosya araması', () => {
  it.each([
    ['34 MPA 764', '34mpa764'],
    ['F-2026-0977', 'f20260977'],
    ['2026/17', '202617'],
    ['Ömer', 'omer'],
    ['Akşam Otomotiv', 'aksamotomotiv'],
  ])('%s değerini %s olarak normalize eder', (value, expected) => {
    expect(normalizeSearchText(value)).toBe(expected)
  })

  it('birden fazla kelimeyi farklı alanlarda eşleştirir', () => {
    expect(matchesSearchQuery('ahmet akşam', ['Ahmet Yılmaz', 'Akşam Otomotiv'])).toBe(true)
    expect(matchesSearchQuery('ahmet başkent', ['Ahmet Yılmaz', 'Akşam Otomotiv'])).toBe(false)
  })

  it('boş veya yalnız ayraç içeren sorguyu filtre olarak değerlendirmez', () => {
    expect(getSearchTokens('  - / .  ')).toEqual([])
    expect(matchesSearchQuery('  - / .  ', ['34 MPA 764'])).toBe(true)
  })
})
