import { describe, expect, it } from 'vitest'
import {
  TRAFFIC_VALUE_LOSS_APPROVE_ROUTE,
  TRAFFIC_VALUE_LOSS_REPORT_PREVIEW_ROUTE,
  TRAFFIC_VALUE_LOSS_ROUTE,
  trafficValueLossEvaluationSchema,
  trafficValueLossClosureListResponseSchema,
  trafficValueLossReportGenerateRequestSchema,
  trafficValueLossReportPreviewRequestSchema,
  trafficValueLossPreviewRequestSchema,
  trafficValueLossVersionCreateRequestSchema,
} from '../src/index.js'

const id = '019f7000-0000-7000-8000-000000000001'
const hash = 'a'.repeat(64)

describe('Trafik değer kaybı contracts', () => {
  it('yeni real-market revision girdisini strict enum ve stable ID sınırlarıyla doğrular', () => {
    const result = trafficValueLossPreviewRequestSchema.safeParse({
      expectedVersion: 0,
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: false,
      vehicle: { make: 'Sentetik', model: 'Model', variant: null, modelYear: 2026, mileage: 0, usageType: 'hususi' },
      faultRateBasisPoints: null,
      preAccidentMarketValueMinor: null,
      postRepairMarketValueMinor: null,
      damageParts: [],
      comparables: [],
      evidence: [{
        evidenceKey: 'expert',
        sourceType: 'expert_observation',
        externalReference: 'ref:expert',
        sourceHash: hash,
        supports: ['vehicle_identity'],
        verificationStatus: 'verified',
      }],
      realMarket: {
        vehicleType: 'OTOMOBİL',
        vehicleGroupCode: 'A',
        usageMetric: 'mileage',
        usageValue: 0,
        commercialOrRental: false,
        previousDamageCount: 0,
        marketValueMinor: 2_000_000,
        damageAmountMinor: 0,
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
    expect(result.success).toBe(true)
    if (!result.success || result.data.realMarket === null) return
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...result.data,
      realMarket: { ...result.data.realMarket, vehicleGroupCode: 'Z' },
    }).success).toBe(false)
    expect(trafficValueLossPreviewRequestSchema.safeParse({
      ...result.data,
      realMarket: {
        ...result.data.realMarket,
        parts: [{ ...result.data.realMarket.parts[0], operation: 'guess' }],
      },
    }).success).toBe(false)
  })
  it('kapanış özet listesini strict kimlik ve minor-unit alanlarıyla doğrular', () => {
    expect(trafficValueLossClosureListResponseSchema.safeParse({
      items: [{
        caseId: id,
        officeCaseNumber: '2026/40',
        plate: '34 PK 040',
        caseType: 'traffic',
        closedAt: '2026-07-16T10:00:00.000Z',
        closureMode: 'normal',
        closureReason: null,
        summary: {
          status: 'present',
          reason: 'Onaylı sonuç ve nihai rapor bulundu.',
          ruleVersion: 'traffic-value-loss-closure/1.0.0',
          requiresHumanReview: false,
          assessmentId: id,
          assessmentVersionId: id,
          assessmentVersion: 1,
          assessmentStatus: 'approved',
          humanApprovalStatus: 'approved',
          calculationRuleVersion: '2026.07.01.1',
          resultCode: 'calculable',
          amountMinor: 245_000,
          reportId: id,
          reportGeneratedAt: '2026-07-16T10:00:00.000Z',
        },
      }],
    }).success).toBe(true)
  })

  it('route ve 01.07.2026 kural sürümünü sabitler', () => {
    expect(TRAFFIC_VALUE_LOSS_ROUTE).toContain('/traffic-value-loss')
    expect(TRAFFIC_VALUE_LOSS_APPROVE_ROUTE).toContain('/approve')
    expect(TRAFFIC_VALUE_LOSS_REPORT_PREVIEW_ROUTE).toContain('/report-preview')
    expect(trafficValueLossEvaluationSchema.options[0].shape.ruleVersion.value).toBe('2026.07.01.1')
  })

  it('rapor önizleme ve kesin çıktı onayını strict biçimde doğrular', () => {
    expect(trafficValueLossReportPreviewRequestSchema.parse({
      expectedAssessmentVersion: 3,
      reportNote: 'Sentetik nihai rapor notu.',
    })).toMatchObject({ expectedAssessmentVersion: 3 })
    expect(trafficValueLossReportGenerateRequestSchema.safeParse({
      expectedAssessmentVersion: 3,
      reportNote: null,
      confirmed: true,
      previewHash: hash,
    }).success).toBe(true)
    expect(trafficValueLossReportGenerateRequestSchema.safeParse({
      expectedAssessmentVersion: 3,
      reportNote: null,
      confirmed: false,
      previewHash: hash,
    }).success).toBe(false)
  })

  it('strict sürüm girdisini ve kanıt bağlantılarını doğrular', () => {
    const parsed = trafficValueLossVersionCreateRequestSchema.parse({
      expectedVersion: 0,
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: false,
      vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50000, usageType: 'hususi' },
      faultRateBasisPoints: 7500,
      preAccidentMarketValueMinor: 100000000,
      postRepairMarketValueMinor: 90000000,
      damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
      evidence: [{
        evidenceKey: 'doc', sourceType: 'document_version', documentId: id, documentVersionId: id,
        sourceHash: hash, supports: ['vehicle_identity'], verificationStatus: 'verified',
      }, {
        evidenceKey: 'pre', sourceType: 'market_comparable', externalReference: 'https://example.test/sentetik',
        sourceHash: hash, observedAt: '2026-07-10', supports: ['pre_accident_market_value'], verificationStatus: 'verified',
      }],
      comparables: [{ comparableKey: 'pre-1', side: 'pre_accident', amountMinor: 100000000, mileage: 50000, observedAt: '2026-07-10', evidenceKey: 'pre' }],
    })
    expect(parsed.evidence).toHaveLength(2)
    expect(trafficValueLossVersionCreateRequestSchema.safeParse({ ...parsed, extra: true }).success).toBe(false)
  })

  it('mutlak dosya yolu ve bilinmeyen emsal kanıtını reddeder', () => {
    const base = {
      expectedVersion: 0, evaluatedOn: '2026-07-16', heavyOrTotalDamage: null,
      vehicle: { make: null, model: null, variant: null, modelYear: null, mileage: null, usageType: null },
      faultRateBasisPoints: null, preAccidentMarketValueMinor: null, postRepairMarketValueMinor: null,
      damageParts: [], evidence: [{
        evidenceKey: 'pre', sourceType: 'market_comparable', externalReference: 'P:\\musteri',
        sourceHash: hash, observedAt: '2026-07-10', supports: ['pre_accident_market_value'], verificationStatus: 'control_required',
      }],
      comparables: [{ comparableKey: 'x', side: 'pre_accident', amountMinor: 1, observedAt: '2026-07-10', evidenceKey: 'missing' }],
    }
    expect(trafficValueLossVersionCreateRequestSchema.safeParse(base).success).toBe(false)
    expect(trafficValueLossVersionCreateRequestSchema.safeParse({
      ...base,
      evidence: [{
        ...base.evidence[0],
        externalReference: 'ref:P:\\musteri',
      }],
      comparables: [],
    }).success).toBe(false)
  })

  it('sonuç taslağında kural kaynaklarını ve insan onayı sınırını zorlar', () => {
    const result = trafficValueLossEvaluationSchema.parse({
      ruleSetId: 'traffic-value-loss-market-difference', ruleVersion: '2026.07.01.1', effectiveFrom: '2026-07-01',
      calculationMethod: 'market_value_difference', roundingRule: 'half_up_minor_unit',
      ruleSources: [
        { code: 'RG', title: 'Resmî Gazete', sourceType: 'official_gazette', publishedAt: '2026-06-12', effectiveFrom: '2026-07-01', locator: 'Madde 2', url: 'https://www.resmigazete.gov.tr/test' },
        { code: 'SEDDK', title: 'Genelge', sourceType: 'seddk_circular', publishedAt: '2026-05-13', effectiveFrom: '2026-07-01', locator: 'Ek-1.1', url: 'https://seddk.gov.tr/test' },
      ],
      eligibilityStatus: 'calculable', grossValueLossMinor: 1000, faultAdjustedValueLossMinor: 750,
      qualifyingPreComparableCount: 3, qualifyingPostComparableCount: 3, uncertainties: [],
      reasoning: ['Kaynaklı taslak.'], humanApprovalRequired: true, canSubmitForApproval: true,
    })
    expect(result.humanApprovalRequired).toBe(true)
  })
})
