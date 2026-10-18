import { evaluateRealMarketValueLoss, evaluateTrafficValueLoss, parseLocalDate, selectTrafficValueLossRule } from '@hasarbotu/domain'
import type { ValueLossCalculatorRequest, ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { realMarketValueLossRuleSnapshot as snapshot } from './rule-source.js'

/** Calculation uses the existing rules; it never creates an approved assessment or report. */
export function calculateValueLoss(input: ValueLossCalculatorRequest): ValueLossCalculatorResponse {
  const date = parseLocalDate(input.accidentDate)
  if (!date.ok) throw new Error('Calculator received an invalid date')
  const selected = selectTrafficValueLossRule(date.value)
  if (selected.status !== 'selected') throw new Error('Calculator rule selection failed')
  const conditionIssue = input.vehicleCondition === 'normal' ? null
    : input.vehicleCondition === 'prior_heavy_damage' ? 'Önceki ağır hasar nedeniyle bu araç için değer kaybı hesaplanamaz.'
    : input.vehicleCondition === 'current_heavy_damage' ? 'Mevcut ağır / pert hasar nedeniyle değer kaybı hesaplanamaz.'
    : input.vehicleCondition === 'antique' ? 'Antika / koleksiyon araç için bu hesap yöntemi uygulanmaz.'
    : 'Yabancı plakalı araç için ilgili ülkenin piyasa değerlendirmesi gerekir.'
  if (conditionIssue !== null) return { amountMinor: null, ruleVersion: selected.ruleVersion, calculationMethod: selected.kind === 'real_market' ? 'real_market_analysis' : 'market_value_difference', issues: [{ field: 'vehicleCondition', message: conditionIssue }] }

  if (selected.kind === 'legacy') {
    const result = evaluateTrafficValueLoss({
      caseType: 'traffic', lossDate: selected.effectiveFrom, evaluatedOn: date.value,
      heavyOrTotalDamage: false,
      vehicle: { make: null, model: null, variant: null, modelYear: input.modelYear, mileage: input.usageValue, usageType: null },
      preAccidentMarketValueMinor: input.marketValueMinor, postRepairMarketValueMinor: input.postRepairMarketValueMinor,
      faultRateBasisPoints: input.faultRateBasisPoints, damageParts: [], comparables: [], evidence: [],
    })
    return { amountMinor: result.faultAdjustedValueLossMinor, ruleVersion: result.ruleVersion, calculationMethod: result.calculationMethod, issues: [] }
  }
  const group = snapshot.vehicleMappings.find(mapping => mapping.vehicleType === input.vehicleType)?.vehicleGroupCode
  if (!group) throw new Error('Calculator vehicle mapping is missing')
  const result = evaluateRealMarketValueLoss(snapshot, {
    caseType: 'traffic', accidentDate: date.value, evaluatedOn: date.value,
    vehicleType: input.vehicleType, vehicleGroupCode: group, modelYear: input.modelYear,
    usageMetric: group === 'D' ? 'working_hours' : 'mileage', usageValue: input.usageValue,
    marketValueMinor: input.marketValueMinor, damageAmountMinor: input.damageAmountMinor,
    previousDamageCount: input.previousDamageCount, commercialOrRental: input.commercialOrRental,
    parts: input.parts, eligibilityFacts: { antiqueOrCollector: false, priorHeavyDamage: false, currentHeavyOrTotalDamage: false, foreignPlate: false, foreignMarketEvidenceVerified: false },
    comparables: [], evidence: [],
  })
  // Documentary checks belong to formal reporting, not arithmetic. Input and part errors still block a result.
  const issues = result.reasons.filter(item => item.code !== 'REQUIRED_EVIDENCE_MISSING' && item.code !== 'INSUFFICIENT_COMPARABLES').map(item => ({ field: item.field, message: item.message }))
  return { amountMinor: issues.length ? null : result.finalResultMinor, ruleVersion: result.ruleVersion, calculationMethod: result.calculationMethod, issues }
}
