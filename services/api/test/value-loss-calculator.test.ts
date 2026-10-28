import { describe, expect, it } from 'vitest'
import { valueLossCalculatorRequestSchema } from '@hasarbotu/contracts'
import { evaluateRealMarketValueLoss, parseLocalDate, valueLossCalculatorAdditionalRules } from '@hasarbotu/domain'
import { calculateValueLoss } from '../src/traffic-value-loss/calculator.js'
import { realMarketValueLossRuleSnapshot as snapshot } from '../src/traffic-value-loss/rule-source.js'

const part = snapshot.partRules.find(part => part.vehicleGroupCode === 'A' && part.coefficients.replacement !== null)!
const input = valueLossCalculatorRequestSchema.parse({ accidentDate: '2026-10-01', vehicleType: 'OTOMOBİL', modelYear: 2024, usageValue: 50000, marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', postRepairMarketValueMinor: null, faultRateBasisPoints: 10000, parts: [{ stableRuleId: part.stableId, operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }] })

describe('value loss calculator reuses established arithmetic', () => {
  it('blocks an unknown history count instead of applying a zero modifier', () => {
    expect(calculateValueLoss({ ...input, previousDamageCount: null })).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'previousDamageCount' })] })
  })
  it('blocks unknown part history even on the explicit market path', () => {
    const partSelections = [{ ...input.parts[0]!, entryId: 'one', partName: part.sourceLabel, position: '', quantity: 1, material: 'unspecified' as const, priorPartState: 'unknown' as const }]
    for (const calculationBasis of ['reference', 'market_difference'] as const) {
      const result = calculateValueLoss({ ...input, parts: [], partSelections, calculationBasis, postRepairMarketValueMinor: 90_000_000 })
      expect(result.amountMinor).toBeNull()
      expect(result.issues[0]?.message).toContain('önceki parça hasarı bilinmiyor')
    }
  })
  it.each([0,50000,100000])('matches the existing real market engine at %s km without inventing verified evidence', usageValue => {
    const value = { ...input, usageValue }
    const date = parseLocalDate(value.accidentDate)
    if (!date.ok) throw new Error('Invalid fixture date')
    const original = evaluateRealMarketValueLoss(snapshot, { ...value, vehicleGroupCode: 'A', caseType: 'traffic', accidentDate: date.value, evaluatedOn: date.value, usageMetric: 'mileage', parts: value.parts, comparables: [], evidence: [], eligibilityFacts: { antiqueOrCollector: false, priorHeavyDamage: false, currentHeavyOrTotalDamage: false, foreignPlate: false, foreignMarketEvidenceVerified: false } })
    expect(calculateValueLoss(value)).toMatchObject({ amountMinor: original.finalResultMinor, issues: [] })
    expect(original.canSubmitForApproval).toBe(false)
  })
  it.each(['prior_heavy_damage','current_heavy_damage','antique','foreign_plate'] as const)('blocks %s instead of displaying a misleading number', vehicleCondition => expect(calculateValueLoss({ ...input, vehicleCondition })).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'vehicleCondition' })] }))
  it('rejects a forged part even when the engine could produce a partial amount', () => expect(calculateValueLoss({ ...input, parts: [{ ...input.parts[0]!, stableRuleId: 'forged' }] })).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'parts.stableRuleId' })] }))
  it('keeps the previous period market difference and counterparty fault calculation', () => expect(calculateValueLoss(valueLossCalculatorRequestSchema.parse({ ...input, accidentDate: '2026-06-01', postRepairMarketValueMinor: 90_000_000, faultRateBasisPoints: 7500, parts: [] }))).toMatchObject({ amountMinor: 7_500_000, calculationMethod: 'market_value_difference' }))
})

const physicalPart = { entryId: 'physical-1', stableRuleId: part.stableId, partName: part.sourceLabel, position: '', quantity: 1, material: 'unspecified', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }
function physical(patch: Record<string, unknown> = {}) { return valueLossCalculatorRequestSchema.parse({ ...input, bodyType: 'unspecified', calculationBasis: 'reference', parts: [], partSelections: [physicalPart], ...patch }) }

describe('calculator physical parts and market difference', () => {
  it('applies whole-vehicle market difference only when explicitly selected', () => {
    const value = physical({ calculationBasis: 'market_difference', partSelections: [physicalPart, { ...physicalPart, entryId: 'unlisted', stableRuleId: null, partName: 'Ön amortisör' }], postRepairMarketValueMinor: 90_000_000, faultRateBasisPoints: 7500 })
    expect(calculateValueLoss(value)).toMatchObject({ amountMinor: 7_500_000, calculationMethod: 'market_value_difference', issues: [] })
    expect(calculateValueLoss({ ...value, postRepairMarketValueMinor: 110_000_000 })).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'postRepairMarketValueMinor' })] })
  })
  it.each([{ manufacturer: 'Unknown', model: 'Unknown' }, { manufacturer: 'Tesla', model: 'Model 3' }])('calculates a generic reference estimate for %j without asking for the answer as input', vehicleIdentity => {
    const value = physical({ vehicleIdentity, postRepairMarketValueMinor: null })
    const estimate = calculateValueLoss(value)
    expect(estimate).toMatchObject({ amountMinor: calculateValueLoss(physical()).amountMinor, calculationMethod: 'real_market_analysis', ruleVersion: 'calculator-reference/2026-07-01/1.1.0', issues: [] })
    expect(estimate.amountMinor).toBeGreaterThan(0)
    expect(calculateValueLoss({ ...value, postRepairMarketValueMinor: 90_000_000 })).toEqual(estimate)
  })
  it('uses the automobile table and commercial factor for a registered passenger van', () => {
    const van = calculateValueLoss(physical({ vehicleType: 'KAMYONET', bodyType: 'passenger_van', commercialOrRental: false }))
    expect(van).toMatchObject({ amountMinor: calculateValueLoss(physical({ commercialOrRental: true })).amountMinor, issues: [] })
    expect(van.amountMinor).not.toBe(calculateValueLoss(physical()).amountMinor)
    expect(calculateValueLoss(physical({ vehicleType: 'KAMYONET', bodyType: 'panel_van' })).amountMinor).toBeNull()
  })
  it('preserves the old amount for an exactly matched physical part', () => expect(calculateValueLoss(physical()).amountMinor).toBe(calculateValueLoss(input).amountMinor))
  it('does not emit a partial amount for mixed mapped and unlisted physical parts', () => {
    const value = physical({ partSelections: [physicalPart, { ...physicalPart, entryId: 'custom-1', stableRuleId: null, partName: 'Ön amortisör', material: 'mechanical' }] })
    expect(calculateValueLoss(value)).toMatchObject({ amountMinor: null, calculationMethod: 'real_market_analysis', issues: [expect.objectContaining({ field: 'partSelections' })] })
    expect(calculateValueLoss({ ...value, calculationBasis: 'market_difference', postRepairMarketValueMinor: 90_000_000, faultRateBasisPoints: 7500 })).toMatchObject({ amountMinor: 7_500_000, calculationMethod: 'market_value_difference', issues: [] })
  })
  it('calculates a modern-period market difference without a fabricated part coefficient or repair price', () => {
    expect(calculateValueLoss(physical({ calculationBasis: 'market_difference', modelYear: null, usageValue: null, postRepairMarketValueMinor: 90_000_000, faultRateBasisPoints: 7500, partSelections: [{ ...physicalPart, stableRuleId: null, partName: 'Ön grenaj', operation: 'repair_paint', paintMode: 'full' }] }))).toMatchObject({ amountMinor: 7_500_000, calculationMethod: 'market_value_difference', issues: [] })
  })
  it('does not accept duplicate physical locations or an unrelated group ID in either calculation mode', () => {
    for (const calculationBasis of ['reference', 'market_difference']) {
      expect(calculateValueLoss(physical({ calculationBasis, postRepairMarketValueMinor: 90_000_000, partSelections: [physicalPart, { ...physicalPart, entryId: 'duplicate' }] }))).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'partSelections' })] })
      const foreign = snapshot.partRules.find(rule => rule.vehicleGroupCode === 'F')!
      expect(calculateValueLoss(physical({ calculationBasis, postRepairMarketValueMinor: 90_000_000, partSelections: [{ ...physicalPart, stableRuleId: foreign.stableId }] }))).toMatchObject({ amountMinor: null })
    }
  })
  it('does not silently reuse a coefficient for an edited name or repeated panels', () => {
    expect(calculateValueLoss(physical({ partSelections: [{ ...physicalPart, partName: 'Farklı parça' }] }))).toMatchObject({ amountMinor: null })
    expect(calculateValueLoss(physical({ partSelections: [{ ...physicalPart, quantity: 2, position: '1. ve 2. bölüm' }] }))).toMatchObject({ amountMinor: null })
  })
  it('applies the explicit plastic-bodywork base rule with a nonzero result and does not multiply it by quantity', () => {
    const plastic = { ...physicalPart, stableRuleId: null, partName: 'Ön grenaj', material: 'plastic_bodywork' }
    const first = calculateValueLoss(physical({ vehicleType: 'MOTORSİKLET', bodyType: 'scooter', partSelections: [plastic] }))
    expect(first.issues).toEqual([])
    expect(first.amountMinor).toBeGreaterThan(0)
    expect(calculateValueLoss(physical({ vehicleType: 'MOTORSİKLET', bodyType: 'scooter', partSelections: [{ ...plastic, quantity: 2, position: 'sağ ve sol' }] })).amountMinor).toBe(first.amountMinor)
    expect(calculateValueLoss(physical({ vehicleType: 'MOTORSİKLET', bodyType: 'scooter', partSelections: [{ ...plastic, material: 'plastic' }] })).amountMinor).toBeNull()
  })
  it('uses the additional cabrio side panel coefficient only in its documented body context', () => {
    const rule = valueLossCalculatorAdditionalRules('OTOMOBİL', 'cabriolet')[0]!
    const selection = { ...physicalPart, stableRuleId: rule.stableId, partName: rule.sourceLabel, operation: 'repair_paint', paintMode: 'local', newPartPriceMinor: 100_000, repairLaborMinor: 20_000, partPriceAvailability: 'available' }
    const result = calculateValueLoss(physical({ bodyType: 'cabriolet', partSelections: [selection] }))
    expect(result).toMatchObject({ ruleVersion: 'calculator-reference/2026-07-01/1.1.0', issues: [] })
    expect(result.amountMinor).toBeGreaterThan(0)
    expect(calculateValueLoss(physical({ bodyType: 'sedan', partSelections: [selection] })).amountMinor).toBeNull()
  })
})
