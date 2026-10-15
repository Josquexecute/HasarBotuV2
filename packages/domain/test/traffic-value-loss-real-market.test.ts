import { describe, expect, it } from 'vitest'
import snapshotJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json' with { type: 'json' }
import {
  REAL_MARKET_VALUE_LOSS_RULE_VERSION,
  REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256,
  evaluateRealMarketValueLoss,
  parseLocalDate,
  selectTrafficValueLossRule,
  type RealMarketValueLossInput,
  type RealMarketValueLossPartInput,
  type TrafficValueLossComparable,
  type TrafficValueLossEvidenceFact,
  type ValueLossRuleSnapshot,
} from '../src/index.js'

const snapshot = snapshotJson as unknown as ValueLossRuleSnapshot
const hash = 'a'.repeat(64)
const date = (value: string) => {
  const parsed = parseLocalDate(value)
  if (!parsed.ok) throw new Error(parsed.error.code)
  return parsed.value
}
const evidence: TrafficValueLossEvidenceFact[] = [
  {
    evidenceKey: 'vehicle',
    sourceType: 'document_version',
    sourceHash: hash,
    supports: ['vehicle_identity', 'mileage', 'usage_type', 'heavy_damage_status'],
    verificationStatus: 'verified',
    conflict: false,
  },
  {
    evidenceKey: 'damage',
    sourceType: 'expert_observation',
    sourceHash: hash,
    supports: ['damage_parts', 'prior_damage'],
    verificationStatus: 'verified',
    conflict: false,
  },
  {
    evidenceKey: 'market',
    sourceType: 'market_comparable',
    sourceHash: hash,
    supports: ['pre_accident_market_value'],
    verificationStatus: 'verified',
    conflict: false,
  },
]
const comparables: TrafficValueLossComparable[] = Array.from({ length: 3 }, (_, index) => ({
  comparableKey: `pre-${index}`,
  side: 'pre_accident',
  amountMinor: 2_000_000 + index,
  mileage: 1_001,
  observedAt: date('2026-07-09'),
  evidenceKey: 'market',
  excluded: false,
  exclusionReason: null,
}))
const firstPart = snapshot.partRules.find((item) =>
  item.vehicleGroupCode === 'A' && item.coefficients.replacement === '5',
) ?? (() => { throw new Error('TEST_PART_RULE_MISSING') })()
const replacementParts = snapshot.partRules
  .filter((item) => item.vehicleGroupCode === 'A' && item.coefficients.replacement !== null)

function part(overrides: Partial<RealMarketValueLossPartInput> = {}): RealMarketValueLossPartInput {
  return {
    stableRuleId: firstPart.stableId,
    operation: 'replacement',
    paintMode: null,
    newPartPriceMinor: null,
    repairLaborMinor: null,
    partPriceAvailability: 'unavailable',
    priorPartState: 'none',
    treatment: 'standard',
    ...overrides,
  }
}

const valid: RealMarketValueLossInput = {
  caseType: 'traffic',
  accidentDate: date('2026-07-01'),
  evaluatedOn: date('2026-07-10'),
  vehicleType: 'OTOMOBİL',
  vehicleGroupCode: 'A',
  modelYear: 2026,
  usageMetric: 'mileage',
  usageValue: 1_001,
  commercialOrRental: false,
  previousDamageCount: 0,
  marketValueMinor: 2_000_000,
  damageAmountMinor: 200_000,
  parts: [part()],
  eligibilityFacts: {
    antiqueOrCollector: false,
    priorHeavyDamage: false,
    currentHeavyOrTotalDamage: false,
    foreignPlate: false,
    foreignMarketEvidenceVerified: false,
  },
  comparables,
  evidence,
}

describe('Paket 66 gerçek piyasa değer kaybı motoru', () => {
  it('30.06.2026 için eski, 01.07.2026 için yeni sürümü seçer ve eksik tarihte kapanır', () => {
    expect(selectTrafficValueLossRule(date('2026-06-29'))).toMatchObject({
      status: 'selected',
      kind: 'legacy',
    })
    expect(selectTrafficValueLossRule(date('2026-06-30'))).toMatchObject({
      status: 'selected',
      kind: 'legacy',
    })
    expect(selectTrafficValueLossRule(date('2026-07-01'))).toMatchObject({
      status: 'selected',
      kind: 'real_market',
      ruleVersion: REAL_MARKET_VALUE_LOSS_RULE_VERSION,
    })
    expect(selectTrafficValueLossRule(null)).toEqual({
      status: 'control_required',
      reasonCode: 'LOSS_DATE_MISSING',
    })
  })

  it('snapshot kimliğini ve canonical hash sabitini değiştirmeden kullanır', () => {
    const result = evaluateRealMarketValueLoss(snapshot, valid)
    expect(result.ruleIdentity).toBe('real-market-analysis/2026-07-01/1.0.0')
    expect(result.normalizedSnapshotSha256).toBe(REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256)
    expect(result.sourceWorkbookSha256)
      .toBe('81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424')
  })

  it('exact 1.000 TRY sonucunu sıfıra düşürmeden ve ara yuvarlama yapmadan korur', () => {
    const result = evaluateRealMarketValueLoss(snapshot, { ...valid, marketValueMinor: 1_600_000 })
    expect(result.rawResultMinor).toMatchObject({
      numerator: '100000',
      denominator: '1',
    })
    expect(result.finalResultMinor).toBe(100_000)
    expect(result.eligibility).toBe('eligible')
    expect(result.canSubmitForApproval).toBe(true)
  })

  it('%15 sınırını medium, %30 sınırını heavy onarım sınıfı yapar', () => {
    const evaluateLabor = (repairLaborMinor: number) => evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      parts: [part({
        operation: 'repair',
        partPriceAvailability: 'available',
        newPartPriceMinor: 10_000,
        repairLaborMinor,
      })],
    }).partBreakdown[0]?.repairClass
    expect(evaluateLabor(1_499)).toBe('light')
    expect(evaluateLabor(1_500)).toBe('medium')
    expect(evaluateLabor(1_501)).toBe('medium')
    expect(evaluateLabor(2_999)).toBe('medium')
    expect(evaluateLabor(3_000)).toBe('heavy')
    expect(evaluateLabor(3_001)).toBe('heavy')
  })

  it('%30 tavanının hemen altı, kendisi ve üstünü exact rational olarak ayırır', () => {
    const evaluateDamage = (damageAmountMinor: number) => evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      damageAmountMinor,
    })
    const below = evaluateDamage(4_999_999)
    const exactCap = evaluateDamage(5_000_000)
    const above = evaluateDamage(5_000_001)
    expect(below.capApplied).toBe(false)
    expect(exactCap.capApplied).toBe(false)
    expect(exactCap.rawResultMinor).toEqual(exactCap.capMinor)
    expect(above.capApplied).toBe(true)
    expect(above.cappedResultMinor).toEqual(above.capMinor)
    expect(above.finalResultMinor).toBe(600_000)
  })

  it('kuruş hassasiyetini ara aşamada korur ve yalnız nihai 500 TRY ceiling uygular', () => {
    const result = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      marketValueMinor: 1_600_020,
    })
    expect(result.rawResultMinor).toMatchObject({
      numerator: '100001',
      denominator: '1',
    })
    expect(result.cappedResultMinor?.numerator).toBe('100001')
    expect(result.finalResultMinor).toBe(150_000)
  })

  it('birden fazla rational katsayıyı floating-point kestirmesi olmadan birleştirir', () => {
    const result = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      modelYear: 2021,
      usageValue: 50_000,
      commercialOrRental: true,
      previousDamageCount: 1,
    })
    expect(result.ageCoefficient).toMatchObject({ numerator: '9', denominator: '10' })
    expect(result.usageCoefficient).toMatchObject({ numerator: '9', denominator: '10' })
    expect(result.generalModifiers.multiplier).toMatchObject({ numerator: '97', denominator: '100' })
    expect(result.rawResultMinor).toMatchObject({ numerator: '94284', denominator: '1' })
  })

  it('parça sunum sırasından bağımsız aynı canonical sonucu üretir', () => {
    const selected = replacementParts.slice(0, 3)
      .map((item) => part({ stableRuleId: item.stableId }))
    expect(selected).toHaveLength(3)
    const forward = evaluateRealMarketValueLoss(snapshot, { ...valid, parts: selected })
    const reverse = evaluateRealMarketValueLoss(snapshot, { ...valid, parts: [...selected].reverse() })
    expect(reverse).toEqual(forward)
  })

  it('sıfır hasarı kabul eder; sıfır/negatif para ve zorunlu alan eksikliğini kapalı kodlarla reddeder', () => {
    const zero = evaluateRealMarketValueLoss(snapshot, { ...valid, damageAmountMinor: 0 })
    expect(zero.reasonCodes).not.toContain('DAMAGE_AMOUNT_INVALID')
    expect(zero.damageCoefficient?.decimal).toBe('0')
    expect(zero.finalResultMinor).toBe(0)
    const invalid = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      marketValueMinor: 0,
      damageAmountMinor: -1,
      usageValue: -1,
    })
    expect(invalid.eligibility).toBe('control_required')
    expect(invalid.reasonCodes).toEqual(expect.arrayContaining([
      'MARKET_VALUE_INVALID',
      'DAMAGE_AMOUNT_INVALID',
      'USAGE_VALUE_MISSING',
    ]))
  })

  it.each(snapshot.vehicleMappings)('$vehicleType için J9 kilometre sınırlarını uygular', (mapping) => {
    const boundaries = mapping.vehicleGroupCode === 'D' ? []
      : ['A', 'F'].includes(mapping.vehicleGroupCode)
        ? [0, 20_000, 50_000, 100_000, 150_000, 200_000, 300_000]
        : [0, 50_000, 150_000, 300_000, 500_000, 750_000, 1_000_000]
    const points = new Set([0, 1_000, 1_001, 501, 5_001, 21_001, 101_000, 201_000, 501_000, 751_000])
    for (const boundary of boundaries) {
      for (const offset of [-1, 0, 1_000, 1_001]) if (boundary + offset >= 0) points.add(boundary + offset)
    }
    for (const usageValue of points) {
      const result = evaluateRealMarketValueLoss(snapshot, {
        ...valid,
        vehicleType: mapping.vehicleType as RealMarketValueLossInput['vehicleType'],
        vehicleGroupCode: mapping.vehicleGroupCode,
        usageMetric: mapping.vehicleGroupCode === 'D' ? 'working_hours' : 'mileage',
        usageValue,
      })
      const expected = boundaries.some((boundary) => usageValue >= boundary && usageValue <= boundary + 1_000)
      expect(result.generalModifiers.lowerBandProximity.decimal, `${mapping.vehicleType}: ${usageValue}`)
        .toBe(expected ? '0.05' : '0')
    }
  })

  it('D grubunda çalışma saati emsallerini doğrular ve kilometre yakınlık ilavesi uygulamaz', () => {
    const rule = snapshot.partRules.find((item) => item.vehicleGroupCode === 'D' && item.coefficients.replacement !== null)!
    const result = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      vehicleType: 'TRAKTÖR',
      vehicleGroupCode: 'D',
      usageMetric: 'working_hours',
      usageValue: 501,
      parts: [part({ stableRuleId: rule.stableId })],
      comparables: comparables.map((item) => ({ ...item, mileage: 500 })),
    })
    expect(result.usageCoefficient?.decimal).toBe('0.95')
    expect(result.generalModifiers.lowerBandProximity.decimal).toBe('0')
    expect(result.qualifyingPreComparableCount).toBe(3)
    expect(result.canSubmitForApproval).toBe(true)
  })

  it.each([
    ['none', true, true],
    ['previously_damaged', false, false],
    ['previously_repaired_detachable', false, false],
    ['previously_repaired_welded', true, false],
  ] as const)('%s parça geçmişinde değişim ve boya istisnalarını korur', (priorPartState, replacementIncluded, paintIncluded) => {
    const result = evaluateRealMarketValueLoss(snapshot, { ...valid, parts: [
      part({ priorPartState }), part({ priorPartState, operation: 'paint', paintMode: 'full' }),
    ] })
    expect(result.partBreakdown.find((item) => item.operation === 'replacement')?.included).toBe(replacementIncluded)
    expect(result.partBreakdown.find((item) => item.operation === 'paint')?.included).toBe(paintIncluded)
  })

  it('Number.MAX_SAFE_INTEGER girdide %30 tavanla güvenli minor-unit sonucu üretir', () => {
    const result = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      marketValueMinor: Number.MAX_SAFE_INTEGER,
      damageAmountMinor: Number.MAX_SAFE_INTEGER,
    })
    expect(result.finalResultMinor).not.toBeNull()
    expect(Number.isSafeInteger(result.finalResultMinor)).toBe(true)
    expect(result.capApplied).toBe(false)
  })

  it('kanıt eksikliğinde eligible veya onaylanabilir sonuç üretmez', () => {
    const result = evaluateRealMarketValueLoss(snapshot, { ...valid, evidence: [] })
    expect(result.eligibility).toBe('control_required')
    expect(result.canSubmitForApproval).toBe(false)
    expect(result.reasonCodes).toContain('REQUIRED_EVIDENCE_MISSING')
  })

  it('desteklenmeyen grup/parça/işlem ve eligibility durumlarında tahmin yürütmez', () => {
    const invalid = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      vehicleGroupCode: 'B',
      parts: [part({ operation: 'paint', paintMode: null })],
      eligibilityFacts: {
        ...valid.eligibilityFacts,
        antiqueOrCollector: true,
      },
    })
    expect(invalid.eligibility).toBe('blocked')
    expect(invalid.canSubmitForApproval).toBe(false)
    expect(invalid.reasonCodes).toEqual(expect.arrayContaining([
      'VEHICLE_GROUP_MISMATCH',
      'PART_RULE_INVALID',
      'ANTIQUE_OR_COLLECTOR',
    ]))
    expect(invalid.reasonCodes.every((code) => [
      'WRONG_CASE_TYPE',
      'LOSS_DATE_MISSING',
      'MODEL_YEAR_MISSING',
      'MODEL_YEAR_AFTER_ACCIDENT',
      'VEHICLE_TYPE_MISSING',
      'VEHICLE_GROUP_MISMATCH',
      'USAGE_VALUE_MISSING',
      'USAGE_METRIC_MISMATCH',
      'MARKET_VALUE_INVALID',
      'DAMAGE_AMOUNT_INVALID',
      'PARTS_MISSING',
      'PART_RULE_INVALID',
      'PART_OPERATION_UNSUPPORTED',
      'PART_OPERATION_CONFLICT',
      'REPAIR_PART_PRICE_INVALID',
      'REPAIR_LABOR_MISSING',
      'RESULT_OUT_OF_SAFE_RANGE',
      'REQUIRED_EVIDENCE_MISSING',
      'SOURCE_CONFLICT',
      'INSUFFICIENT_COMPARABLES',
      'FOREIGN_MARKET_EVIDENCE_MISSING',
      'ANTIQUE_OR_COLLECTOR',
      'PRIOR_HEAVY_DAMAGE',
      'CURRENT_HEAVY_OR_TOTAL_DAMAGE',
    ].includes(code))).toBe(true)
  })
})
