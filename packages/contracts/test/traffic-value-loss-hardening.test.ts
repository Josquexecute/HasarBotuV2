import { describe, expect, it } from 'vitest'
import {
  trafficValueLossApproveRequestSchema,
  trafficValueLossCurrentApprovedResponseSchema,
  trafficValueLossPartCatalogQuerySchema,
  trafficValueLossPreviewRequestSchema,
  trafficValueLossSubmitRequestSchema,
  trafficValueLossVersionParamsSchema,
  type TrafficValueLossPreviewRequest,
} from '../src/index.js'

const ID = '019f7000-0000-7000-8000-000000000001'
const HASH = 'a'.repeat(64)

function request(): TrafficValueLossPreviewRequest {
  return trafficValueLossPreviewRequestSchema.parse({
    expectedVersion: 0,
    evaluatedOn: '2026-07-16',
    heavyOrTotalDamage: false,
    vehicle: {
      make: 'Sentetik',
      model: 'Model',
      variant: null,
      modelYear: 2026,
      mileage: 10_000,
      usageType: 'hususi',
    },
    faultRateBasisPoints: null,
    preAccidentMarketValueMinor: null,
    postRepairMarketValueMinor: null,
    damageParts: [],
    comparables: [],
    evidence: [{
      evidenceKey: 'expert',
      sourceType: 'expert_observation',
      externalReference: 'ref:expert',
      sourceHash: HASH,
      supports: ['vehicle_identity'],
      verificationStatus: 'verified',
    }],
    realMarket: {
      vehicleType: 'OTOMOBİL',
      vehicleGroupCode: 'A',
      usageMetric: 'mileage',
      usageValue: 10_000,
      commercialOrRental: false,
      previousDamageCount: 0,
      marketValueMinor: 2_000_000,
      damageAmountMinor: 100_000,
      parts: [{
        stableRuleId: 'value-loss-part|vehicle-group=A|source-table=group-a|source-row=34|label=tavan|operations=paint%2Brepair%2Breplacement',
        operation: 'replacement',
        paintMode: null,
        newPartPriceMinor: null,
        repairLaborMinor: null,
        partPriceAvailability: 'unavailable',
        priorPartState: 'none',
        treatment: 'standard',
      }],
      eligibilityFacts: {
        antiqueOrCollector: false,
        priorHeavyDamage: false,
        currentHeavyOrTotalDamage: false,
        foreignPlate: false,
        foreignMarketEvidenceVerified: false,
      },
      prefillProvenance: [],
    },
    ruleOverride: null,
    confirmedPreviewHash: null,
  })
}

describe('Değer kaybı strict contract sertleştirmesi', () => {
  it('UUID params ve katalog allowlist sınırlarını strict doğrular', () => {
    expect(trafficValueLossVersionParamsSchema.safeParse({
      caseId: ID,
      versionId: ID,
    }).success).toBe(true)
    expect(trafficValueLossVersionParamsSchema.safeParse({
      caseId: 'not-uuid',
      versionId: ID,
    }).success).toBe(false)
    expect(trafficValueLossPartCatalogQuerySchema.safeParse({
      vehicleGroupCode: 'Z',
    }).success).toBe(false)
    expect(trafficValueLossPartCatalogQuerySchema.safeParse({
      vehicleGroupCode: 'A',
      unexpected: true,
    }).success).toBe(false)
  })

  it('eksik zorunlu, fazla, null/undefined ve enum dışı alanları reddeder', () => {
    const valid = request()
    if (valid.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    const missing: Partial<TrafficValueLossPreviewRequest> = { ...valid }
    delete missing.evaluatedOn
    expect(trafficValueLossPreviewRequestSchema.safeParse(missing).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({ ...valid, expectedVersion: null }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      realMarket: { ...valid.realMarket, vehicleType: 'TAHMİN' },
    }).success).toBe(false)
  })

  it('empty/whitespace string ve geçersiz provenance yapısını reddeder', () => {
    const valid = request()
    if (valid.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      evidence: [{ ...valid.evidence[0], evidenceKey: '   ' }],
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      realMarket: {
        ...valid.realMarket,
        prefillProvenance: [{
          field: 'marketValueMinor',
          source: 'user_input',
          sourceRevisionId: null,
          originalValue: 1,
          newValue: 2,
          overrideReason: '   ',
        }],
      },
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      realMarket: {
        ...valid.realMarket,
        prefillProvenance: [{
          field: 'marketValueMinor',
          source: 'approved_market_value',
          sourceRevisionId: ID,
          originalValue: 1,
          newValue: 2,
          overrideReason: 'İstemci uydurması',
        }],
      },
    }).success).toBe(false)
  })

  it('negatif, unsafe ve integer olmayan parasal girdileri reddeder', () => {
    const valid = request()
    if (valid.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    for (const amount of [-1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
      expect(trafficValueLossPreviewRequestSchema.safeParse({
        ...valid,
        realMarket: { ...valid.realMarket, marketValueMinor: amount },
      }).success).toBe(false)
    }
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      realMarket: { ...valid.realMarket, marketValueMinor: Number.MAX_SAFE_INTEGER },
    }).success).toBe(true)
  })

  it('snapshot hash, evidence ve supports yapısını fail-closed doğrular', () => {
    const valid = request()
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      evidence: [{ ...valid.evidence[0], sourceHash: 'ABC' }],
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      evidence: [{ ...valid.evidence[0], supports: [] }],
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      evidence: [{ ...valid.evidence[0], supports: ['unknown'] }],
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      confirmedPreviewHash: 'not-a-hash',
    }).success).toBe(false)
  })

  it('rule override ve approval gerekçesini boşlukla geçmeye izin vermez', () => {
    const valid = request()
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...valid,
      ruleOverride: {
        ruleIdentity: 'real-market-analysis/2026-07-01/1.0.0',
        reason: '   ',
      },
    }).success).toBe(false)
    expect(trafficValueLossApproveRequestSchema.safeParse({
      expectedVersion: 1,
      reason: '   ',
    }).success).toBe(false)
  })

  it('optimistic komutları strict ve pozitif sürümle sınırlar', () => {
    expect(trafficValueLossSubmitRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(true)
    expect(trafficValueLossSubmitRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false)
    expect(trafficValueLossSubmitRequestSchema.safeParse({
      expectedVersion: 1,
      calculationId: ID,
    }).success).toBe(false)
  })

  it('current-approved response içinde kimlik eşleşmesini runtime DTO katmanında görünür tutar', () => {
    const result = trafficValueLossCurrentApprovedResponseSchema.safeParse({
      version: {
        id: ID,
        organizationId: ID,
        caseId: ID,
        calculationId: ID,
        revisionId: 'not-uuid',
      },
    })
    expect(result.success).toBe(false)
  })
})
