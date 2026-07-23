import { describe, expect, it } from 'vitest'
import {
  trafficValueLossPreviewRequestSchema,
  type TrafficValueLossVersionCreateRequest,
} from '@hasarbotu/contracts'
import { createTrafficValueLossPreviewHash } from '../src/traffic-value-loss/store.js'

const ORGANIZATION_ID = '019f7000-0000-7000-8000-000000000001'
const OTHER_ORGANIZATION_ID = '019f7000-0000-7000-8000-000000000002'
const CASE_ID = '019f7000-0000-7000-8000-000000000003'
const OTHER_CASE_ID = '019f7000-0000-7000-8000-000000000004'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function request(): TrafficValueLossVersionCreateRequest {
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
    damageParts: [
      { partCode: 'B', partName: 'Parça B', repairAction: 'replace', priorDamage: 'no' },
      { partCode: 'A', partName: 'Parça A', repairAction: 'paint', priorDamage: 'no' },
    ],
    comparables: [
      {
        comparableKey: 'b',
        side: 'pre_accident',
        amountMinor: 2_000_000,
        mileage: 10_000,
        observedAt: '2026-07-10',
        evidenceKey: 'market-b',
      },
      {
        comparableKey: 'a',
        side: 'pre_accident',
        amountMinor: 1_900_000,
        mileage: 10_001,
        observedAt: '2026-07-10',
        evidenceKey: 'market-a',
      },
    ],
    evidence: [
      {
        evidenceKey: 'market-b',
        sourceType: 'market_comparable',
        externalReference: 'ref:market-b',
        sourceHash: HASH_B,
        observedAt: '2026-07-10',
        supports: ['pre_accident_market_value', 'vehicle_identity'],
        verificationStatus: 'verified',
      },
      {
        evidenceKey: 'market-a',
        sourceType: 'market_comparable',
        externalReference: 'ref:market-a',
        sourceHash: HASH_A,
        observedAt: '2026-07-10',
        supports: ['vehicle_identity', 'pre_accident_market_value'],
        verificationStatus: 'verified',
      },
    ],
    realMarket: {
      vehicleType: 'OTOMOBİL',
      vehicleGroupCode: 'A',
      usageMetric: 'mileage',
      usageValue: 10_000,
      commercialOrRental: false,
      previousDamageCount: 0,
      marketValueMinor: 2_000_000,
      damageAmountMinor: 100_000,
      parts: [
        {
          stableRuleId: 'part-b',
          operation: 'replacement',
          paintMode: null,
          newPartPriceMinor: null,
          repairLaborMinor: null,
          partPriceAvailability: 'unavailable',
          priorPartState: 'none',
          treatment: 'standard',
        },
        {
          stableRuleId: 'part-a',
          operation: 'paint',
          paintMode: 'full',
          newPartPriceMinor: null,
          repairLaborMinor: null,
          partPriceAvailability: 'unavailable',
          priorPartState: 'none',
          treatment: 'standard',
        },
      ],
      eligibilityFacts: {
        antiqueOrCollector: false,
        priorHeavyDamage: false,
        currentHeavyOrTotalDamage: false,
        foreignPlate: false,
        foreignMarketEvidenceVerified: false,
      },
      prefillProvenance: [
        {
          field: 'marketValueMinor',
          source: 'user_input',
          sourceRevisionId: null,
          originalValue: 1_900_000,
          newValue: 2_000_000,
          overrideReason: 'Onaylı emsal kontrolü.',
        },
        {
          field: 'accidentDate',
          source: 'case',
          sourceRevisionId: null,
          originalValue: '2026-07-01',
          newValue: '2026-07-01',
          overrideReason: null,
        },
      ],
    },
    ruleOverride: null,
    confirmedPreviewHash: null,
  })
}

const evaluation = {
  ruleSetId: 'real-market-analysis',
  ruleVersion: 'real-market-analysis/2026-07-01/1.0.0',
  finalResultMinor: 150_000,
}

function hash(
  value: TrafficValueLossVersionCreateRequest,
  overrides: Partial<{
    organizationId: string
    caseId: string
    evaluation: unknown
  }> = {},
): string {
  return createTrafficValueLossPreviewHash({
    organizationId: overrides.organizationId ?? ORGANIZATION_ID,
    caseId: overrides.caseId ?? CASE_ID,
    request: value,
    evaluation: overrides.evaluation ?? evaluation,
  })
}

describe('Değer kaybı preview hash güvenliği', () => {
  it('aynı canonical girdi ve farklı nesne anahtar sırası için aynı hash üretir', () => {
    const original = request()
    const reordered = {
      ...original,
      vehicle: {
        usageType: original.vehicle.usageType,
        mileage: original.vehicle.mileage,
        modelYear: original.vehicle.modelYear,
        variant: original.vehicle.variant,
        model: original.vehicle.model,
        make: original.vehicle.make,
      },
    } as TrafficValueLossVersionCreateRequest
    expect(hash(reordered)).toBe(hash(original))
    expect(hash(original)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('UI sunum sırasını, supports sırasını ve semantik olarak sırasız listeleri hash dışı tutar', () => {
    const original = request()
    if (original.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    const reordered: TrafficValueLossVersionCreateRequest = {
      ...original,
      damageParts: [...original.damageParts].reverse(),
      comparables: [...original.comparables].reverse(),
      evidence: [...original.evidence].reverse().map((item) => ({
        ...item,
        supports: [...item.supports].reverse(),
      })),
      realMarket: {
        ...original.realMarket,
        parts: [...original.realMarket.parts].reverse(),
        prefillProvenance: [...original.realMarket.prefillProvenance].reverse(),
      },
    }
    expect(hash(reordered)).toBe(hash(original))
  })

  it('hesabı etkileyen alan, rule version, evidence ve provenance değişikliğini ayırır', () => {
    const original = request()
    if (original.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    const baseHash = hash(original)
    expect(hash({
      ...original,
      realMarket: { ...original.realMarket, marketValueMinor: 2_000_001 },
    })).not.toBe(baseHash)
    expect(hash(original, {
      evaluation: { ...evaluation, ruleVersion: 'traffic-value-loss-market-difference/2026.07.01.1' },
    })).not.toBe(baseHash)
    expect(hash({
      ...original,
      evidence: original.evidence.map((item, index) =>
        index === 0 ? { ...item, sourceHash: 'c'.repeat(64) } : item),
    })).not.toBe(baseHash)
    expect(hash({
      ...original,
      realMarket: {
        ...original.realMarket,
        prefillProvenance: original.realMarket.prefillProvenance.map((item, index) =>
          index === 0 ? { ...item, overrideReason: 'Farklı doğrulama gerekçesi.' } : item),
      },
    })).not.toBe(baseHash)
  })

  it('tenant ve case kimliğini hash kapsamına alır', () => {
    const original = request()
    const baseHash = hash(original)
    expect(hash(original, { organizationId: OTHER_ORGANIZATION_ID })).not.toBe(baseHash)
    expect(hash(original, { caseId: OTHER_CASE_ID })).not.toBe(baseHash)
  })
})
