import { describe, expect, it } from 'vitest'
import {
  TRAFFIC_VALUE_LOSS_RULE_VERSION,
  evaluateTrafficValueLoss,
  parseLocalDate,
  type TrafficValueLossComparable,
  type TrafficValueLossEvidenceFact,
  type TrafficValueLossInput,
} from '../src/index.js'

const hash = 'a'.repeat(64)
const date = (value: string) => {
  const parsed = parseLocalDate(value)
  if (!parsed.ok) throw new Error(parsed.error.code)
  return parsed.value
}
const evidence: TrafficValueLossEvidenceFact[] = [
  { evidenceKey: 'vehicle', sourceType: 'document_version', sourceHash: hash, supports: ['vehicle_identity', 'mileage', 'usage_type', 'heavy_damage_status'] as const, verificationStatus: 'verified' as const, conflict: false },
  { evidenceKey: 'damage', sourceType: 'expert_observation', sourceHash: hash, supports: ['damage_parts', 'prior_damage', 'fault_rate'] as const, verificationStatus: 'verified' as const, conflict: false },
  { evidenceKey: 'pre', sourceType: 'market_comparable', sourceHash: hash, supports: ['pre_accident_market_value'] as const, verificationStatus: 'verified' as const, conflict: false },
  { evidenceKey: 'post', sourceType: 'market_comparable', sourceHash: hash, supports: ['post_repair_market_value'] as const, verificationStatus: 'verified' as const, conflict: false },
]
const comparables: TrafficValueLossComparable[] = [...Array.from({ length: 3 }, (_, index) => ({
  comparableKey: `pre-${index}`, side: 'pre_accident' as const, amountMinor: 1_000_000_00 + index,
  mileage: 50_000 + index, observedAt: date('2026-07-10'), evidenceKey: 'pre', excluded: false, exclusionReason: null,
})), ...Array.from({ length: 3 }, (_, index) => ({
  comparableKey: `post-${index}`, side: 'post_repair' as const, amountMinor: 900_000_00 + index,
  mileage: 50_000 + index, observedAt: date('2026-07-11'), evidenceKey: 'post', excluded: false, exclusionReason: null,
}))]

const valid: TrafficValueLossInput = {
  caseType: 'traffic',
  lossDate: date('2026-07-02'),
  evaluatedOn: date('2026-07-16'),
  heavyOrTotalDamage: false,
  vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
  faultRateBasisPoints: 7_500,
  preAccidentMarketValueMinor: 1_000_000_00,
  postRepairMarketValueMinor: 900_000_00,
  damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
  comparables,
  evidence,
}

describe('01.07.2026 Trafik değer kaybı çekirdeği', () => {
  it('eski Ek-1 katsayı formülü yerine doğrulanmış piyasa değer farkını kullanır', () => {
    const result = evaluateTrafficValueLoss(valid)
    expect(result.ruleVersion).toBe(TRAFFIC_VALUE_LOSS_RULE_VERSION)
    expect(result.grossValueLossMinor).toBe(10_000_000)
    expect(result.faultAdjustedValueLossMinor).toBe(7_500_000)
    expect(result.eligibilityStatus).toBe('calculable')
    expect(result.canSubmitForApproval).toBe(true)
    expect(result.reasoning[0]).toContain('Ek-1')
  })

  it('aynı girdiyle deterministik sonuç üretir', () => {
    expect(evaluateTrafficValueLoss(valid)).toEqual(evaluateTrafficValueLoss(valid))
  })

  it('yüksek güvenli minor-unit tutarında baz puan hesabını ara çarpım taşması olmadan yapar', () => {
    const amount = Number.MAX_SAFE_INTEGER
    const result = evaluateTrafficValueLoss({
      ...valid,
      faultRateBasisPoints: 10_000,
      preAccidentMarketValueMinor: amount,
      postRepairMarketValueMinor: 0,
    })
    expect(result.grossValueLossMinor).toBe(amount)
    expect(result.faultAdjustedValueLossMinor).toBe(amount)
    expect(result.canSubmitForApproval).toBe(true)
  })

  it('01.07.2026 öncesi hasarı yeni sürümle kesinleştirmez', () => {
    const result = evaluateTrafficValueLoss({ ...valid, lossDate: date('2026-06-30') })
    expect(result.eligibilityStatus).toBe('control_required')
    expect(result.uncertainties.map((item) => item.code)).toContain('RULE_PERIOD_NOT_APPLICABLE')
    expect(result.canSubmitForApproval).toBe(false)
  })

  it('eksik piyasa kanıtı ve yetersiz emsali control_required yapar', () => {
    const result = evaluateTrafficValueLoss({ ...valid, comparables: [], evidence: evidence.filter((item) => item.evidenceKey !== 'post') })
    expect(result.eligibilityStatus).toBe('control_required')
    expect(result.uncertainties.map((item) => item.code)).toEqual(expect.arrayContaining([
      'POST_VALUE_EVIDENCE_MISSING',
      'INSUFFICIENT_PRE_COMPARABLES',
      'INSUFFICIENT_POST_COMPARABLES',
    ]))
  })

  it('30 günü aşan veya ±%10 km dışında kalan emsali yeterli saymaz', () => {
    const stale = comparables.map((item) => ({ ...item, observedAt: date('2026-05-01'), mileage: 80_000 }))
    const result = evaluateTrafficValueLoss({ ...valid, comparables: stale })
    expect(result.qualifyingPreComparableCount).toBe(0)
    expect(result.qualifyingPostComparableCount).toBe(0)
    expect(result.canSubmitForApproval).toBe(false)
  })

  it('kaynak çelişkisini sessiz çözmez', () => {
    const result = evaluateTrafficValueLoss({ ...valid, evidence: evidence.map((item, index) => index === 0 ? { ...item, conflict: true } : item) })
    expect(result.uncertainties.map((item) => item.code)).toContain('SOURCE_CONFLICT')
    expect(result.eligibilityStatus).toBe('control_required')
  })

  it('ağır veya tam hasarda değer kaybı taslağı üretmez fakat insan onayı ister', () => {
    const result = evaluateTrafficValueLoss({ ...valid, heavyOrTotalDamage: true })
    expect(result.eligibilityStatus).toBe('not_applicable')
    expect(result.grossValueLossMinor).toBeNull()
    expect(result.humanApprovalRequired).toBe(true)
    expect(result.canSubmitForApproval).toBe(true)
  })

  it('piyasa farkı sıfırsa no_value_loss taslağı üretir ve yine onay gerektirir', () => {
    const result = evaluateTrafficValueLoss({ ...valid, postRepairMarketValueMinor: valid.preAccidentMarketValueMinor })
    expect(result.eligibilityStatus).toBe('no_value_loss')
    expect(result.faultAdjustedValueLossMinor).toBe(0)
    expect(result.humanApprovalRequired).toBe(true)
  })
})
