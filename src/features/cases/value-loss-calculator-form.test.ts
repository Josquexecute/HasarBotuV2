import { describe, expect, it } from 'vitest'
import { calculatorOperations, calculatorRequest, consolidateCalculatorParts, initialCalculatorDraft, moneyMinor, type CalculatorPartDraft } from './value-loss-calculator-form'
import type { CaseRecord } from '../../types/case'

describe('calculator TL input', () => {
  it.each([['1.000.000,50',100000050], ['1000000.50',100000050], ['1 000 000,5',100000050], ['1.234',123400], ['1234',123400], ['0',0]])('parses %s without floating point rounding', (input, expected) => expect(moneyMinor(input)).toBe(expected))
  it.each(['', '-1', '1,234', 'abc', '1.2.3', '9007199254740992'])('rejects invalid or unsafe %s', input => expect(moneyMinor(input)).toBeNull())
})

const part: CalculatorPartDraft = { id: '1', stableRuleId: 'part-1', label: 'SOL ÇAMURLUK', operation: 'repair', paintMode: 'full', price: '10.000', labor: '2.000', priceUnknown: false, priorPartState: 'none', treatment: 'standard', position: '', quantity: '1', material: 'unspecified' }
function request(parts: CalculatorPartDraft[]) {
  return calculatorRequest({ ...initialCalculatorDraft({ lossDate: '2026-10-01' } as CaseRecord), modelYear: '2024', usageValue: '50000', marketValue: '1.000.000', damageAmount: '100.000', parts })
}

describe('calculator combined operations', () => {
  it('keeps manufacturer information without requiring the unknown post-repair value for a reference estimate', () => {
    const draft = { ...initialCalculatorDraft({ lossDate: '2026-10-01' } as CaseRecord), manufacturer: 'Tesla', model: 'Model 3', modelYear: '2023', usageValue: '50000', damageAmount: '100.000', marketValue: '1.000.000', faultPercent: '75', parts: [part] }
    expect(calculatorRequest(draft)).toMatchObject({ vehicleIdentity: { manufacturer: 'Tesla', model: 'Model 3' }, calculationBasis: 'reference', postRepairMarketValueMinor: null, faultRateBasisPoints: 7500 })
    expect(() => calculatorRequest({ ...draft, model: '' })).toThrow('marka ve modeli')
  })
  it.each(['repair_paint', 'replacement_paint'] as const)('sends %s as one physical part without duplicating its descriptive metadata', operation => {
    const value = request([{ ...part, operation, paintMode: 'local' }])
    expect(value.parts).toEqual([])
    expect(value.partSelections).toEqual([expect.objectContaining({ stableRuleId: part.stableRuleId, operation, paintMode: 'local', quantity: 1, position: '' })])
  })
  it('still requires valid repair prices for repair and paint', () => {
    expect(() => request([{ ...part, operation: 'repair_paint', price: '' }])).toThrow('yeni parça bedelini')
    expect(request([{ ...part, operation: 'repair_paint', priceUnknown: true, price: '', labor: '' }]).partSelections).toHaveLength(1)
  })
  it('sends paintless repair without an additional paint coefficient', () => {
    expect(request([{ ...part, material: 'steel', operation: 'paintless_repair' }]).partSelections).toEqual([expect.objectContaining({ operation: 'paintless_repair', treatment: 'paintless_repair', paintMode: null })])
  })
  it('only offers combinations supported by the selected catalog part', () => {
    expect(calculatorOperations(['replacement'])).toEqual(['replacement'])
    expect(calculatorOperations(['repair'])).toEqual(['repair', 'paintless_repair'])
    expect(calculatorOperations(['paint'])).toEqual(['paint'])
    expect(calculatorOperations(['repair', 'paint'])).toEqual(['repair', 'repair_paint', 'paint', 'paintless_repair'])
  })
  it.each(['repair', 'replacement'] as const)('preserves the old %s and separate paint request while merging its presentation', operation => {
    const rows = [{ ...part, operation }, { ...part, id: '2', operation: 'paint' as const, paintMode: 'local' as const }]
    const merged = consolidateCalculatorParts(rows)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ operation: operation === 'repair' ? 'repair_paint' : 'replacement_paint', paintMode: 'local', price: part.price, labor: part.labor })
    expect(request(merged)).toEqual(request(rows))
  })
  it('does not merge inconsistent old rows or silently drop duplicated operations', () => {
    const paint = { ...part, id: '2', operation: 'paint' as const }
    expect(consolidateCalculatorParts([part, { ...paint, treatment: 'accessory' }])).toHaveLength(2)
    expect(consolidateCalculatorParts([part, paint, { ...paint, id: '3' }])).toHaveLength(3)
    expect(consolidateCalculatorParts([{ ...part, treatment: 'paintless_repair' }])[0]?.operation).toBe('paintless_repair')
  })
  it('requires market values for custom metal parts and does not drop them from the request', () => {
    const draft = { ...initialCalculatorDraft({ lossDate: '2026-10-01' } as CaseRecord), calculationBasis: 'market_difference' as const, marketValue: '1.000.000', postRepairMarketValue: '900.000', faultPercent: '75', parts: [{ ...part, stableRuleId: '', label: 'Ön amortisör', material: 'mechanical' as const, position: 'sol ön', quantity: '2' }] }
    const input = calculatorRequest(draft)
    expect(input).toMatchObject({ calculationBasis: 'market_difference', postRepairMarketValueMinor: 90_000_000, faultRateBasisPoints: 7500, partSelections: [expect.objectContaining({ partName: 'Ön amortisör', stableRuleId: null, quantity: 2, position: 'sol ön' })] })
    expect(() => calculatorRequest({ ...draft, postRepairMarketValue: '' })).toThrow('Onarım sonrası piyasa değerini')
    expect(() => calculatorRequest({ ...draft, postRepairMarketValue: '1.100.000' })).toThrow('aşamaz')
  })
  it('rejects missing names, invalid quantities and missing positions for multiple panels', () => {
    expect(() => request([{ ...part, stableRuleId: '', label: ' ' }])).toThrow('adını')
    expect(() => request([{ ...part, quantity: '0' }])).toThrow('1 ile 20')
    expect(() => request([{ ...part, quantity: '21' }])).toThrow('1 ile 20')
    expect(() => request([{ ...part, quantity: '2' }])).toThrow('konumlarını')
  })
  it('does not merge two unrelated custom parts with empty reference IDs', () => {
    expect(consolidateCalculatorParts([{ ...part, stableRuleId: '', operation: 'repair' }, { ...part, stableRuleId: '', id: '2', label: 'ÖN GRENAJ', operation: 'paint' }])).toHaveLength(2)
  })
})
