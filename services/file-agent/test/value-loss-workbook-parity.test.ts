import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME,
  VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
  buildValueLossRuleSnapshot,
  evaluateRealMarketValueLoss,
  parseLocalDate,
  type RealMarketValueLossInput,
  type RealMarketValueLossPartInput,
  type ValueLossProductDecisionOverlay,
  type ValueLossRuleSnapshot,
} from '@hasarbotu/domain'
import snapshotJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json' with { type: 'json' }
import decisionsJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/product-decisions.json' with { type: 'json' }
import { assertWorkbookSha256, extractOoxmlWorkbook } from '../src/ooxml-readonly-extractor.js'
import { workbookFormulas } from './helpers/value-loss-workbook-formulas.js'

const bytes = readFileSync(new URL(`../../../${VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME}`, import.meta.url))
const workbook = extractOoxmlWorkbook(bytes)
const snapshot = snapshotJson as unknown as ValueLossRuleSnapshot
const lossDate = parseLocalDate('2026-07-01')
if (!lossDate.ok) throw new Error('TEST_DATE')
const date = lossDate.value

function scenario(mapping: ValueLossRuleSnapshot['vehicleMappings'][number], usageValue: number, age = 5) {
  const rule = snapshot.partRules.find((part) => part.vehicleGroupCode === mapping.vehicleGroupCode && part.coefficients.replacement !== null)!
  const source = workbookFormulas(workbook, {})
  const coefficient = Number(source(`Tablolar!C${rule.sourceRow}`))
  const ageRow = age <= 2 ? 26 : age <= 4 ? 25 : age <= 7 ? 24 : age <= 10 ? 23 : age <= 13 ? 22 : age <= 16 ? 21 : age <= 19 ? 20 : 19
  const input: RealMarketValueLossInput = {
    caseType: 'traffic', accidentDate: date, evaluatedOn: date,
    vehicleType: mapping.vehicleType as RealMarketValueLossInput['vehicleType'],
    vehicleGroupCode: mapping.vehicleGroupCode, modelYear: 2026 - age,
    usageMetric: mapping.vehicleGroupCode === 'D' ? 'working_hours' : 'mileage',
    usageValue, commercialOrRental: true, previousDamageCount: 2,
    marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000,
    parts: [{ stableRuleId: rule.stableId, operation: 'replacement', paintMode: null,
      newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable',
      priorPartState: 'none', treatment: 'standard' }],
    eligibilityFacts: { antiqueOrCollector: false, priorHeavyDamage: false,
      currentHeavyOrTotalDamage: false, foreignPlate: false, foreignMarketEvidenceVerified: false },
    comparables: [], evidence: [],
  }
  const excel = workbookFormulas(workbook, {
    'Hesaplama!B3': mapping.vehicleType, 'Hesaplama!C3': mapping.vehicleGroupCode,
    'Hesaplama!C5': input.marketValueMinor! / 100, 'Hesaplama!F3': input.damageAmountMinor! / 100,
    'Hesaplama!C7': Number(source(`Tablolar!C${ageRow}`)), 'Hesaplama!C9': usageValue,
    'Hesaplama!F5': 'EVET', 'Hesaplama!F7': 2,
    'Hesaplama!C64': coefficient, 'Hesaplama!H64': 0, 'Hesaplama!K64': 0,
  })
  return { input, excel }
}

describe('Kaynak Excel formülleri ile hesap motoru karşılaştırması', () => {
  it('kaynak dosyayı değiştirmeden tüm tablo ve katsayıları birebir yeniden üretir', () => {
    assertWorkbookSha256(bytes, VALUE_LOSS_SOURCE_WORKBOOK_SHA256)
    expect(buildValueLossRuleSnapshot({
      workbook, productDecisions: decisionsJson as unknown as ValueLossProductDecisionOverlay,
      workbookSha256: VALUE_LOSS_SOURCE_WORKBOOK_SHA256, workbookFileName: VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME,
    })).toEqual(snapshot)
  })

  it.each(snapshot.vehicleMappings)('$vehicleType: kaynak F9/J9/J3 ve ham/nihai tutarları eşleştirir', (mapping) => {
    const points = mapping.vehicleGroupCode === 'D'
      ? [0, 500, 501, 1_000, 1_001, 2_000, 2_001, 3_000, 3_001, 4_000, 4_001, 5_000]
      : [0, 1_000, 1_001, 19_999, 20_000, 21_000, 21_001, 49_999, 50_000, 51_000, 51_001,
        99_999, 100_000, 101_000, 101_001, 149_999, 150_000, 151_000, 151_001,
        199_999, 200_000, 201_000, 201_001, 299_999, 300_000, 301_000, 301_001,
        499_999, 500_000, 501_000, 501_001, 749_999, 750_000, 751_000, 751_001, 999_999, 1_000_000, 1_001_000, 1_001_001]
    for (const usage of points) {
      const { input, excel } = scenario(mapping, usage)
      const result = evaluateRealMarketValueLoss(snapshot, input)
      expect(Number(result.usageCoefficient!.decimal), `F9: ${usage}`).toBe(Number(excel('F9')))
      expect(Number(result.generalModifiers.lowerBandProximity.decimal), `J9: ${usage}`).toBe(Number(excel('J9')))
      expect(Number(result.damageCoefficient!.decimal)).toBeCloseTo(Number(excel('J3')), 12)
      const rawCell = mapping.vehicleGroupCode === 'F' ? 'Tablolar!U2' : mapping.vehicleType === 'OTOBÜS' ? 'Tablolar!U6' : 'Tablolar!U10'
      expect(Number(result.rawResultMinor!.decimal) / 100).toBeCloseTo(Number(excel(rawCell)), 6)
      const sourceResult = Number(excel('H1')) * 100
      // H1 returns zero for exact multiples of 1,000 TL; retain the guide's 500 TL ceiling.
      if (sourceResult > 0) expect(result.finalResultMinor).toBe(sourceResult)
    }
  })

  it.each([0, 2, 3, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 30])('araç yaşı %i için kaynak yaş tablosunu uygular', (age) => {
    const { input, excel } = scenario(snapshot.vehicleMappings[0]!, 51_001, age)
    expect(Number(evaluateRealMarketValueLoss(snapshot, input).ageCoefficient!.decimal)).toBe(Number(excel('C7')))
  })

  it.each(snapshot.partRules)('$vehicleGroupCode / $sourceRow / $sourceLabel: değişim, onarım ve boya katsayılarını eşleştirir', (rule) => {
    const mapping = snapshot.vehicleMappings.find((item) => item.vehicleGroupCode === rule.vehicleGroupCode)!
    const { input } = scenario(mapping, rule.vehicleGroupCode === 'D' ? 2_500 : 51_001)
    const source = workbookFormulas(workbook, {})
    const variants: { operation: RealMarketValueLossPartInput['operation']; column: string; labor?: number; paint?: 'full' | 'local' }[] = [
      { operation: 'replacement', column: 'C' },
      { operation: 'repair', column: 'F', labor: 1_499 },
      { operation: 'repair', column: 'G', labor: 1_500 },
      { operation: 'repair', column: 'G', labor: 2_999 },
      { operation: 'repair', column: 'H', labor: 3_000 },
      { operation: 'paint', column: 'K', paint: 'full' },
      { operation: 'paint', column: 'L', paint: 'local' },
    ]
    for (const variant of variants.filter((item) => rule.operationCapabilities.includes(item.operation))) {
      const result = evaluateRealMarketValueLoss(snapshot, { ...input, parts: [{ ...input.parts[0]!,
        stableRuleId: rule.stableId, operation: variant.operation, paintMode: variant.paint ?? null,
        partPriceAvailability: 'available', newPartPriceMinor: 10_000, repairLaborMinor: variant.labor ?? null,
      }] })
      expect(Number(result.partBreakdown[0]!.coefficient.decimal))
        .toBe(Number(source(`Tablolar!${variant.column}${rule.sourceRow}`)))
    }
  })

  it('tam 1.000 TL yuvarlama hatasını kopyalamaz; rehberdeki 500 TL tavan yuvarlamasını korur', () => {
    const { input } = scenario(snapshot.vehicleMappings[0]!, 51_001)
    const rounding = workbookFormulas(workbook, {
      'Hesaplama!C3': 'A', 'Hesaplama!B3': 'OTOMOBİL', 'Hesaplama!C7': 1,
      'Hesaplama!F9': 1, 'Hesaplama!J5': 0, 'Hesaplama!J7': 0, 'Hesaplama!J9': 0,
      'Hesaplama!J3': 0.01, 'Tablolar!U10': 1_000,
    })
    expect(rounding('H1')).toBe(0)
    const result = evaluateRealMarketValueLoss(snapshot, { ...input,
      modelYear: 2026, usageValue: 1_001, commercialOrRental: false, previousDamageCount: 0,
      marketValueMinor: 1_600_000, damageAmountMinor: 200_000,
    })
    expect(result.rawResultMinor?.decimal).toBe('100000')
    expect(result.finalResultMinor).toBe(100_000)
  })

  it('5.001 saat üzerindeki kaynak F9 metin hatasında tablonun 0,70 katsayısını korur', () => {
    const mapping = snapshot.vehicleMappings.find((item) => item.vehicleGroupCode === 'D')!
    const { input, excel } = scenario(mapping, 5_001)
    expect(excel('F9')).toBe('D')
    expect(evaluateRealMarketValueLoss(snapshot, input).usageCoefficient?.decimal).toBe('0.7')
  })
})
