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
  mileage: 0,
  observedAt: date('2026-07-09'),
  evidenceKey: 'market',
  excluded: false,
  exclusionReason: null,
}))
const firstPart = snapshot.partRules.find((item) =>
  item.vehicleGroupCode === 'A' && item.coefficients.replacement === '5',
) ?? (() => { throw new Error('TEST_PART_RULE_MISSING') })()

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
  usageValue: 0,
  commercialOrRental: false,
  previousDamageCount: 0,
  marketValueMinor: 2_000_000,
  damageAmountMinor: 0,
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
    const result = evaluateRealMarketValueLoss(snapshot, valid)
    expect(result.rawResultMinor).toMatchObject({
      numerator: '100000',
      denominator: '1',
    })
    expect(result.finalResultMinor).toBe(100_000)
    expect(result.eligibility).toBe('eligible')
    expect(result.canSubmitForApproval).toBe(true)
  })

  it('%15 sınırını medium, %30 sınırını heavy onarım sınıfı yapar', () => {
    const medium = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      parts: [part({
        operation: 'repair',
        partPriceAvailability: 'available',
        newPartPriceMinor: 10_000,
        repairLaborMinor: 1_500,
      })],
    })
    const heavy = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      parts: [part({
        operation: 'repair',
        partPriceAvailability: 'available',
        newPartPriceMinor: 10_000,
        repairLaborMinor: 3_000,
      })],
    })
    expect(medium.partBreakdown[0]?.repairClass).toBe('medium')
    expect(heavy.partBreakdown[0]?.repairClass).toBe('heavy')
  })

  it('ham sonucu piyasa değerinin %30 tavanında sınırlar ve 500 TRY ceiling uygular', () => {
    const highParts = snapshot.partRules
      .filter((item) => item.vehicleGroupCode === 'A' && item.coefficients.replacement !== null)
      .slice(0, 12)
      .map((item) => part({ stableRuleId: item.stableId }))
    const result = evaluateRealMarketValueLoss(snapshot, {
      ...valid,
      damageAmountMinor: 2_000_000,
      parts: highParts,
    })
    expect(result.capApplied).toBe(true)
    expect(result.capMinor?.decimal).toBe('600000')
    expect(result.finalResultMinor).toBe(600_000)
  })

  it('kanıt eksikliğinde eligible veya onaylanabilir sonuç üretmez', () => {
    const result = evaluateRealMarketValueLoss(snapshot, { ...valid, evidence: [] })
    expect(result.eligibility).toBe('control_required')
    expect(result.canSubmitForApproval).toBe(false)
    expect(result.reasonCodes).toContain('REQUIRED_EVIDENCE_MISSING')
  })
})
