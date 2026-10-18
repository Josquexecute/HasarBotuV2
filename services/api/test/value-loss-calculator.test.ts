import { describe, expect, it } from 'vitest'
import { valueLossCalculatorRequestSchema } from '@hasarbotu/contracts'
import { evaluateRealMarketValueLoss, parseLocalDate } from '@hasarbotu/domain'
import { calculateValueLoss } from '../src/traffic-value-loss/calculator.js'
import { realMarketValueLossRuleSnapshot as snapshot } from '../src/traffic-value-loss/rule-source.js'

const part = snapshot.partRules.find(part => part.vehicleGroupCode === 'A' && part.coefficients.replacement !== null)!
const input = valueLossCalculatorRequestSchema.parse({ accidentDate: '2026-10-01', vehicleType: 'OTOMOBİL', modelYear: 2024, usageValue: 50000, marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', postRepairMarketValueMinor: null, faultRateBasisPoints: 10000, parts: [{ stableRuleId: part.stableId, operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }] })

describe('value loss calculator reuses established arithmetic', () => {
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
