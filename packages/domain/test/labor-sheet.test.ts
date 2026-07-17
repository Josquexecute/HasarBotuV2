import { describe, expect, it } from 'vitest'
import {
  LABOR_SHEET_CURRENCY,
  LABOR_SHEET_SCHEMA_VERSION,
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  MAX_LABOR_SHEET_ITEMS,
  MAX_LABOR_SHEET_TOTAL_MINOR,
  computeLaborSheetTotals,
  isValidLaborAmountMinor,
  normalizeLaborText,
  validateLaborSheetItems,
  type LaborItemInput,
} from '../src/index.js'

const item = (over: Partial<LaborItemInput> = {}): LaborItemInput => ({
  description: 'Ön tampon kaplama',
  action: 'Değişim',
  partAmountMinor: 18_400_00,
  laborAmountMinor: 2_200_00,
  ...over,
})

describe('labor-sheet sabitleri', () => {
  it('sürüm ve para birimi kararlıdır', () => {
    expect(LABOR_SHEET_SCHEMA_VERSION).toBe('labor-sheet/1.0.0')
    expect(LABOR_SHEET_CURRENCY).toBe('TRY')
  })
})

describe('normalizeLaborText', () => {
  it('baş/son boşluğu temizler', () => {
    expect(normalizeLaborText('  Sol ön çamurluk  ', MAX_LABOR_ITEM_DESCRIPTION_LENGTH)).toBe('Sol ön çamurluk')
  })

  it('boş, yalnız boşluk, kontrol karakteri ve aşırı uzunluğu reddeder', () => {
    expect(normalizeLaborText('', 160)).toBeNull()
    expect(normalizeLaborText('   ', 160)).toBeNull()
    expect(normalizeLaborText('Önpanel', 160)).toBeNull()
    expect(normalizeLaborText('a'.repeat(161), 160)).toBeNull()
    expect(normalizeLaborText('a'.repeat(160), 160)).toBe('a'.repeat(160))
  })
})

describe('isValidLaborAmountMinor', () => {
  it('yalnız 0..MAX arası güvenli tamsayıyı kabul eder', () => {
    expect(isValidLaborAmountMinor(0)).toBe(true)
    expect(isValidLaborAmountMinor(MAX_LABOR_AMOUNT_MINOR)).toBe(true)
    expect(isValidLaborAmountMinor(-1)).toBe(false)
    expect(isValidLaborAmountMinor(1.5)).toBe(false)
    expect(isValidLaborAmountMinor(Number.NaN)).toBe(false)
    expect(isValidLaborAmountMinor(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidLaborAmountMinor(MAX_LABOR_AMOUNT_MINOR + 1)).toBe(false)
  })
})

describe('computeLaborSheetTotals', () => {
  it('parça ve işçilik toplamlarını deterministik hesaplar', () => {
    const totals = computeLaborSheetTotals([
      { description: 'a', action: 'x', partAmountMinor: 100, laborAmountMinor: 50 },
      { description: 'b', action: 'y', partAmountMinor: 0, laborAmountMinor: 75 },
    ])
    expect(totals).toEqual({ partTotalMinor: 100, laborTotalMinor: 125, grandTotalMinor: 225 })
  })
})

describe('validateLaborSheetItems', () => {
  it('geçerli çok satırlı föyü normalize eder ve toplamı döner', () => {
    const result = validateLaborSheetItems([
      item(),
      item({ description: '  Sol ön çamurluk ', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 6_750_00 }),
    ])
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.items[1].description).toBe('Sol ön çamurluk')
    expect(result.totals).toEqual({
      partTotalMinor: 18_400_00,
      laborTotalMinor: 8_950_00,
      grandTotalMinor: 27_350_00,
    })
  })

  it('yalnız parça veya yalnız işçilik satırına izin verir', () => {
    expect(validateLaborSheetItems([item({ laborAmountMinor: 0 })]).valid).toBe(true)
    expect(validateLaborSheetItems([item({ partAmountMinor: 0 })]).valid).toBe(true)
  })

  it('en az bir kalem zorunludur', () => {
    expect(validateLaborSheetItems([])).toEqual({ valid: false, reasonCode: 'items_required', itemOrdinal: null })
  })

  it('kalem üst sınırını aşan föyü reddeder', () => {
    const many = Array.from({ length: MAX_LABOR_SHEET_ITEMS + 1 }, () => item())
    expect(validateLaborSheetItems(many)).toEqual({ valid: false, reasonCode: 'too_many_items', itemOrdinal: null })
  })

  it('geçersiz açıklama/işlem/tutar için kusurlu kalemin sırasını döner', () => {
    expect(validateLaborSheetItems([item(), item({ description: '  ' })])).toEqual({
      valid: false, reasonCode: 'invalid_description', itemOrdinal: 2,
    })
    expect(validateLaborSheetItems([item({ action: 'a'.repeat(MAX_LABOR_ITEM_ACTION_LENGTH + 1) })])).toEqual({
      valid: false, reasonCode: 'invalid_action', itemOrdinal: 1,
    })
    expect(validateLaborSheetItems([item({ partAmountMinor: -5 })])).toEqual({
      valid: false, reasonCode: 'invalid_amount', itemOrdinal: 1,
    })
    expect(validateLaborSheetItems([item({ laborAmountMinor: 1.2 })])).toEqual({
      valid: false, reasonCode: 'invalid_amount', itemOrdinal: 1,
    })
  })

  it('her iki tutarı sıfır olan kalemi reddeder', () => {
    expect(validateLaborSheetItems([item({ partAmountMinor: 0, laborAmountMinor: 0 })])).toEqual({
      valid: false, reasonCode: 'amount_required', itemOrdinal: 1,
    })
  })

  it('föy geneli üst sınırı aşan toplamı reddeder', () => {
    const half = Math.floor(MAX_LABOR_SHEET_TOTAL_MINOR / 2) + 1
    const result = validateLaborSheetItems([
      item({ partAmountMinor: half, laborAmountMinor: 0 }),
      item({ partAmountMinor: half, laborAmountMinor: 0 }),
    ])
    expect(result).toEqual({ valid: false, reasonCode: 'total_exceeds_limit', itemOrdinal: null })
  })
})
