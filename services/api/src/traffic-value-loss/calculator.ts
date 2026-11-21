import { calculateTrafficValueLossMarketDifference, evaluateRealMarketValueLoss, evaluateTrafficValueLoss, parseLocalDate, resolveValueLossCalculatorParts, selectTrafficValueLossRule, TRAFFIC_VALUE_LOSS_RULE_VERSION, VALUE_LOSS_CALCULATOR_REFERENCE_VERSION, VALUE_LOSS_CALCULATOR_WORKBOOK_FILE_NAME, VALUE_LOSS_CALCULATOR_WORKBOOK_SHA256, valueLossCalculatorAdditionalRules, valueLossCalculatorVehicleContext } from '@hasarbotu/domain'
import type { ValueLossCalculatorRequest, ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { realMarketValueLossRuleSnapshot as snapshot } from './rule-source.js'

/** Calculation uses the existing rules; it never creates an approved assessment or report. */
export function calculateValueLoss(input: ValueLossCalculatorRequest): ValueLossCalculatorResponse {
  const date = parseLocalDate(input.accidentDate)
  if (!date.ok) throw new Error('Calculator received an invalid date')
  const selected = selectTrafficValueLossRule(date.value)
  if (selected.status !== 'selected') throw new Error('Calculator rule selection failed')
  const market = selected.kind === 'legacy' || input.calculationBasis === 'market_difference'
  const ruleVersion = market ? selected.ruleVersion : VALUE_LOSS_CALCULATOR_REFERENCE_VERSION
  if (!market && input.previousDamageCount === null) return { amountMinor: null, ruleVersion: VALUE_LOSS_CALCULATOR_REFERENCE_VERSION, calculationMethod: 'real_market_analysis', issues: [{ field: 'previousDamageCount', message: 'Önceki hasar sayısı bilinmiyor. SBM / geçmiş kayıt ile doğrulayın.' }] }
  const conditionIssue = input.vehicleCondition === 'normal' ? null
    : input.vehicleCondition === 'prior_heavy_damage' ? 'Önceki ağır hasar nedeniyle bu araç için değer kaybı hesaplanamaz.'
    : input.vehicleCondition === 'current_heavy_damage' ? 'Mevcut ağır / pert hasar nedeniyle değer kaybı hesaplanamaz.'
    : input.vehicleCondition === 'antique' ? 'Antika / koleksiyon araç için bu hesap yöntemi uygulanmaz.'
    : 'Yabancı plakalı araç için ilgili ülkenin piyasa değerlendirmesi gerekir.'
  if (conditionIssue !== null) return { amountMinor: null, ruleVersion, calculationMethod: market ? 'market_value_difference' : 'real_market_analysis', issues: [{ field: 'vehicleCondition', message: conditionIssue }] }

  const context = valueLossCalculatorVehicleContext(input.vehicleType, input.bodyType ?? 'unspecified')
  const group = context.group
  const sourceParts = snapshot.partRules.filter(rule => rule.vehicleGroupCode === group).map(rule => ({ stableRuleId: rule.stableId, label: rule.sourceLabel, supportedOperations: rule.operationCapabilities, coefficients: rule.coefficients }))
  const resolved = input.partSelections === undefined ? null : resolveValueLossCalculatorParts(input.vehicleType, input.bodyType ?? 'unspecified', sourceParts, input.partSelections, input.vehicleIdentity === undefined ? undefined : { identity: input.vehicleIdentity, modelYear: input.modelYear })
  if (resolved?.issues.length) return { amountMinor: null, ruleVersion, calculationMethod: market ? 'market_value_difference' : 'real_market_analysis', issues: resolved.issues }
  if (resolved?.requiresMarketDifference) {
    if (!market) return { amountMinor: null, ruleVersion: VALUE_LOSS_CALCULATOR_REFERENCE_VERSION, calculationMethod: 'real_market_analysis', issues: [{ field: 'partSelections', message: 'Seçilen parça veya işlem için referans katsayısı bulunamadı. Parça, işlem, adet ve malzeme bilgilerini kontrol edin; bu seçimle tahmini tutar hesaplanamaz.' }] }
    if (input.postRepairMarketValueMinor === null) return { amountMinor: null, ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION, calculationMethod: 'market_value_difference', issues: [{ field: 'postRepairMarketValueMinor', message: 'Piyasa değer farkı için onarım sonrası piyasa değerini girin.' }] }
    if (input.postRepairMarketValueMinor > input.marketValueMinor) return { amountMinor: null, ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION, calculationMethod: 'market_value_difference', issues: [{ field: 'postRepairMarketValueMinor', message: 'Onarım sonrası piyasa değeri kaza öncesi değeri aşamaz.' }] }
  }

  if ((market && selected.kind !== 'legacy') || input.calculationBasis === 'market_difference') {
    const result = calculateTrafficValueLossMarketDifference(input.marketValueMinor, input.postRepairMarketValueMinor, input.faultRateBasisPoints)
    return { amountMinor: result.faultAdjustedValueLossMinor, ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION, calculationMethod: 'market_value_difference', issues: result.faultAdjustedValueLossMinor === null ? [{ field: 'postRepairMarketValueMinor', message: 'Geçerli kaza öncesi ve onarım sonrası piyasa değerlerini girin.' }] : [] }
  }

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
  const additionalRules = input.partSelections === undefined ? [] : valueLossCalculatorAdditionalRules(input.vehicleType, input.bodyType ?? 'unspecified')
  const calculatorSnapshot = additionalRules.length ? { ...snapshot, partRules: [...snapshot.partRules, ...additionalRules] } : snapshot
  const result = evaluateRealMarketValueLoss(calculatorSnapshot, {
    caseType: 'traffic', accidentDate: date.value, evaluatedOn: date.value,
    vehicleType: context.vehicleType, vehicleGroupCode: group, modelYear: input.modelYear,
    usageMetric: group === 'D' ? 'working_hours' : 'mileage', usageValue: input.usageValue,
    marketValueMinor: input.marketValueMinor, damageAmountMinor: input.damageAmountMinor,
    previousDamageCount: input.previousDamageCount, commercialOrRental: input.commercialOrRental || context.commercialRequired,
    parts: resolved?.referenceParts ?? input.parts, eligibilityFacts: { antiqueOrCollector: false, priorHeavyDamage: false, currentHeavyOrTotalDamage: false, foreignPlate: false, foreignMarketEvidenceVerified: false },
    comparables: [], evidence: [],
  }, { documentedBaseOnlyPartCount: resolved?.baseOnlyParts.length ?? 0 })
  // Documentary checks belong to formal reporting, not arithmetic. Input and part errors still block a result.
  const issues = result.reasons.filter(item => (item.code !== 'REQUIRED_EVIDENCE_MISSING' || item.field === 'damageAmountMinor') && item.code !== 'INSUFFICIENT_COMPARABLES').map(item => ({ field: item.field, message: item.message }))
  const gross = issues.length ? null : result.finalResultMinor
  const amountMinor = gross === null ? null : calculateTrafficValueLossMarketDifference(gross, 0, input.faultRateBasisPoints).faultAdjustedValueLossMinor
  return { amountMinor, ruleVersion: VALUE_LOSS_CALCULATOR_REFERENCE_VERSION, calculationMethod: result.calculationMethod, issues,
    ...(gross === null ? {} : { breakdown: {
      sourceFileName: VALUE_LOSS_CALCULATOR_WORKBOOK_FILE_NAME, sourceSha256: VALUE_LOSS_CALCULATOR_WORKBOOK_SHA256,
      vehicleAge: Number(input.accidentDate.slice(0, 4)) - input.modelYear!, vehicleGroup: group,
      ageCoefficient: result.ageCoefficient!.decimal, usageCoefficient: result.usageCoefficient!.decimal,
      commercialModifier: result.generalModifiers.commercialOrRental.decimal, previousDamageModifier: result.generalModifiers.previousDamage.decimal,
      mileageModifier: result.generalModifiers.lowerBandProximity.decimal, generalMultiplier: result.generalModifiers.multiplier.decimal,
      partCoefficient: result.partCoefficientPercentagePoints!.decimal, damageContribution: result.damageAmountContribution!.decimal,
      damageCoefficient: result.damageCoefficient!.decimal, vehicleMultiplier: result.vehicleMultiplier!.decimal,
      rawAmountMinor: result.rawResultMinor!.decimal, capMinor: result.capMinor!.decimal, cappedAmountMinor: result.cappedResultMinor!.decimal, capApplied: result.capApplied,
      roundingUnitMinor: result.roundingUnitMinor, grossAmountMinor: gross, faultRateBasisPoints: input.faultRateBasisPoints,
      parts: result.partBreakdown.map(part => ({ label: part.sourceLabel, operation: part.operation, repairClass: part.repairClass, coefficient: part.coefficient.decimal, included: part.included, exclusionReason: part.exclusionReason, sourceRow: part.sourceRow })),
      baseOnlyParts: (resolved?.baseOnlyParts ?? []).map(part => ({ label: input.partSelections!.find(entry => entry.entryId === part.entryId)!.partName, principle: part.principle })),
    } }),
  }
}
