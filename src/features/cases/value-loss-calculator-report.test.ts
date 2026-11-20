import { describe, expect, it } from 'vitest'
import { valueLossCalculatorRequestSchema, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { calculatorReportHtml } from './value-loss-calculator-report'

const input = valueLossCalculatorRequestSchema.parse({ accidentDate: '2026-10-01', vehicleType: 'OTOMOBİL', modelYear: 2024, usageValue: 50000, marketValueMinor: 100000000, damageAmountMinor: 10000000, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', parts: [{ stableRuleId: 'part-1', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }], postRepairMarketValueMinor: null, faultRateBasisPoints: 7500 })
const result: ValueLossCalculatorResponse = { amountMinor: 4275000, ruleVersion: 'calculator-reference/2026-07-01/1.3.0', calculationMethod: 'real_market_analysis', issues: [], breakdown: {
  sourceFileName: 'V1.xlsx', sourceSha256: 'a'.repeat(64), vehicleAge: 2, vehicleGroup: 'A', ageCoefficient: '1', usageCoefficient: '0.9', commercialModifier: '0', previousDamageModifier: '0', mileageModifier: '0.05', generalMultiplier: '1.05', partCoefficient: '5', damageContribution: '1', damageCoefficient: '0.06', vehicleMultiplier: '1', rawAmountMinor: '5670000', capMinor: '30000000', cappedAmountMinor: '5670000', capApplied: false, roundingUnitMinor: 50000, grossAmountMinor: 5700000, faultRateBasisPoints: 7500,
  parts: [{ label: 'TAVAN <script>alert(1)</script>', operation: 'replacement', repairClass: null, coefficient: '5', included: true, exclusionReason: null, sourceRow: 44 }], baseOnlyParts: [{ label: 'Plastik karoseri', principle: '3.9' }],
} }

describe('reference calculation report', () => {
  it('exports source, inputs, formula, part reasons, rounding and fault without executable user content', () => {
    const html = calculatorReportHtml('Dosya <img src=x onerror=alert(1)>', input, result)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('script, img, iframe')).toBeNull()
    for (const text of ['42.750,00', '57.000,00', '56.700,00', '75', 'TAVAN <script>alert(1)</script>', '3.9', 'V1.xlsx', 'a'.repeat(64), '500']) expect(doc.body.textContent).toContain(text)
    expect(doc.body.textContent?.toLocaleLowerCase('tr-TR')).toContain('piyasa')
    expect(doc.body.textContent).toContain('Eksper Kanaati katsayısı V1 Excel’de tanımlı değildir; bu referans tahmin o katsayıyı içermez.')
    expect(doc.documentElement.lang).toBe('tr')
    expect(doc.querySelector('style')?.textContent).toContain('@media print')
  })
  it('refuses an incomplete or old result instead of inventing a breakdown', () => {
    expect(() => calculatorReportHtml('Dosya', input, { ...result, amountMinor: null })).toThrow()
    expect(() => calculatorReportHtml('Dosya', input, { ...result, breakdown: undefined })).toThrow()
    expect(() => calculatorReportHtml('Dosya', input, { ...result, issues: [{ field: 'parts', message: 'Kontrol' }] })).toThrow()
  })
})
