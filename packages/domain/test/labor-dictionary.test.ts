import { describe, expect, it } from 'vitest'
import {
  LABOR_DICTIONARY_SCHEMA_VERSION,
  laborDictionaryMatchKey,
  normalizeLaborDictionaryEntry,
  searchLaborDictionary,
  sortLaborDictionary,
  type LaborDictionaryEntry,
  type LaborDictionaryEntryInput,
} from '../src/index.js'

const input = (over: Partial<LaborDictionaryEntryInput> = {}): LaborDictionaryEntryInput => ({
  description: 'Ön tampon kaplama',
  action: 'Değişim',
  usageCount: 3,
  lastPartAmountMinor: 18_400_00,
  lastLaborAmountMinor: 2_200_00,
  lastUsedAt: '2026-07-18T09:00:00.000Z',
  ...over,
})

const entry = (over: Partial<LaborDictionaryEntryInput> = {}): LaborDictionaryEntry => {
  const normalized = normalizeLaborDictionaryEntry(input(over))
  if (normalized === null) throw new Error('fixture_invalid')
  return normalized
}

describe('labor dictionary sabitleri ve anahtar', () => {
  it('şema sürümü kararlıdır', () => {
    expect(LABOR_DICTIONARY_SCHEMA_VERSION).toBe('labor-dictionary/1.0.0')
  })

  it('eşleştirme anahtarı Türkçe aksan ve büyük-küçük harf duyarsızdır', () => {
    expect(laborDictionaryMatchKey('  ÖN   Tampon  ')).toBe('on tampon')
    expect(laborDictionaryMatchKey('Sol Ön Çamurluk')).toBe('sol on camurluk')
    expect(laborDictionaryMatchKey('ÖN TAMPON')).toBe(laborDictionaryMatchKey('ön tampon'))
  })
})

describe('normalizeLaborDictionaryEntry', () => {
  it('metni normalize eder ve eşleştirme anahtarı üretir', () => {
    const normalized = normalizeLaborDictionaryEntry(input({ description: '  Ön tampon kaplama  ' }))
    expect(normalized?.description).toBe('Ön tampon kaplama')
    expect(normalized?.matchKey).toBe('on tampon kaplama degisim')
  })

  it('geçersiz metin, sayı ve tutarı eler', () => {
    expect(normalizeLaborDictionaryEntry(input({ description: '   ' }))).toBeNull()
    expect(normalizeLaborDictionaryEntry(input({ action: 'a'.repeat(81) }))).toBeNull()
    expect(normalizeLaborDictionaryEntry(input({ usageCount: 0 }))).toBeNull()
    expect(normalizeLaborDictionaryEntry(input({ usageCount: 1.5 }))).toBeNull()
    expect(normalizeLaborDictionaryEntry(input({ lastPartAmountMinor: -1 }))).toBeNull()
  })
})

describe('sortLaborDictionary', () => {
  it('kullanım sayısı, son kullanım ve Türkçe alfabeye göre deterministik sıralar', () => {
    const sorted = sortLaborDictionary([
      entry({ description: 'Zincir', usageCount: 1 }),
      entry({ description: 'Ampul', usageCount: 5 }),
      entry({ description: 'Bagaj', usageCount: 5, lastUsedAt: '2026-07-19T09:00:00.000Z' }),
    ])
    expect(sorted.map((item) => item.description)).toEqual(['Bagaj', 'Ampul', 'Zincir'])
  })
})

describe('searchLaborDictionary', () => {
  const entries = [
    entry({ description: 'Ön tampon kaplama', action: 'Değişim', usageCount: 5 }),
    entry({ description: 'Sol ön çamurluk', action: 'Onarım + boya', usageCount: 3 }),
    entry({ description: 'Far bağlantı ayağı', action: 'Onarım', usageCount: 1 }),
  ]

  it('boş sorguda tüm listeyi sıralı döner', () => {
    expect(searchLaborDictionary(entries, '   ').map((item) => item.description))
      .toEqual(['Ön tampon kaplama', 'Sol ön çamurluk', 'Far bağlantı ayağı'])
  })

  it('aksan/büyük-küçük duyarsız alt dize araması yapar', () => {
    expect(searchLaborDictionary(entries, 'CAMURLUK').map((item) => item.description))
      .toEqual(['Sol ön çamurluk'])
    expect(searchLaborDictionary(entries, 'onarım').map((item) => item.description))
      .toEqual(['Sol ön çamurluk', 'Far bağlantı ayağı'])
    expect(searchLaborDictionary(entries, 'bulunmayan kalem')).toEqual([])
  })

  it('limit uygular ve güvensiz limiti üst sınıra çeker', () => {
    expect(searchLaborDictionary(entries, '', 2)).toHaveLength(2)
    expect(searchLaborDictionary(entries, '', 0)).toHaveLength(3)
    expect(searchLaborDictionary(entries, '', Number.NaN)).toHaveLength(3)
  })
})
