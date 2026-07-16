import { describe, expect, it } from 'vitest'
import {
  buildTrafficValueLossReportContent,
  canonicalizeTrafficValueLossReportContent,
  parseLocalDate,
  parseUtcDateTime,
  type TrafficValueLossReportSource,
} from '../src/index.js'

function local(value: string) {
  const parsed = parseLocalDate(value)
  if (!parsed.ok) throw new Error('invalid test date')
  return parsed.value
}
function utc(value: string) {
  const parsed = parseUtcDateTime(value)
  if (!parsed.ok) throw new Error('invalid test datetime')
  return parsed.value
}

const source: TrafficValueLossReportSource = {
  caseReference: {
    caseId: '019fa100-0000-7000-8000-000000000001',
    officeNumber: '2026/3401',
    plate: '34 TEST 034',
    caseType: 'traffic',
    lossDate: local('2026-07-02'),
    notificationDate: local('2026-07-03'),
  },
  assessmentId: '019fa100-0000-7000-8000-000000000002',
  version: {
    id: '019fa100-0000-7000-8000-000000000003',
    assessmentVersion: 1,
    status: 'approved',
    humanApprovalStatus: 'approved',
    approvedBy: '019fa100-0000-7000-8000-000000000004',
    approvedAt: utc('2026-07-16T09:00:00.000Z'),
    approvalReason: 'Sentetik kanıtlar kontrol edildi.',
    input: {
      vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
      faultRateBasisPoints: 7_500,
      preAccidentMarketValueMinor: 100_000_000,
      postRepairMarketValueMinor: 90_000_000,
      damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
    },
    evaluation: {
      eligibilityStatus: 'calculable',
      calculationMethod: 'market_value_difference',
      roundingRule: 'half_up_minor_unit',
      grossValueLossMinor: 10_000_000,
      faultAdjustedValueLossMinor: 7_500_000,
      qualifyingPreComparableCount: 1,
      qualifyingPostComparableCount: 0,
      reasoning: ['Sentetik piyasa farkı hesaplandı.'],
      uncertainties: [],
      ruleSetId: 'traffic-value-loss-market-difference',
      ruleVersion: '2026.07.01.1',
      effectiveFrom: local('2026-07-01'),
      ruleSources: [
        {
          code: 'SEDDK-2026',
          title: 'SEDDK sentetik kaynak',
          sourceType: 'seddk_circular',
          publishedAt: local('2026-05-13'),
          effectiveFrom: local('2026-07-01'),
          locator: 'Ek-1.1',
          url: 'https://seddk.gov.tr/sentetik',
        },
        {
          code: 'RG-2026',
          title: 'Resmî Gazete sentetik kaynak',
          sourceType: 'official_gazette',
          publishedAt: local('2026-06-12'),
          effectiveFrom: local('2026-07-01'),
          locator: 'Madde 2',
          url: 'https://www.resmigazete.gov.tr/sentetik',
        },
      ],
    },
    evidence: [{
      id: '019fa100-0000-7000-8000-000000000005',
      evidenceKey: 'market-pre',
      sourceType: 'market_comparable',
      documentId: null,
      documentVersionId: null,
      externalReference: 'ref:sentetik-emsal',
      sourceHash: 'a'.repeat(64),
      observedAt: local('2026-07-10'),
      supports: ['pre_accident_market_value'],
      verificationStatus: 'verified',
      conflict: false,
      notes: null,
    }],
    comparables: [{
      id: '019fa100-0000-7000-8000-000000000006',
      comparableKey: 'pre-1',
      side: 'pre_accident',
      amountMinor: 100_000_000,
      mileage: 50_000,
      observedAt: local('2026-07-10'),
      evidenceId: '019fa100-0000-7000-8000-000000000005',
      excluded: false,
      exclusionReason: null,
    }],
  },
}

describe('Trafik değer kaybı nihai rapor içeriği', () => {
  it('onaylı sürümden kaynak, emsal, hesaplama ve kural sürümünü deterministik üretir', () => {
    const first = buildTrafficValueLossReportContent(source, ' Kullanıcı kontrollü nihai not. ')
    const second = buildTrafficValueLossReportContent(source, 'Kullanıcı kontrollü nihai not.')
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.content).toMatchObject({
      schemaVersion: 'traffic-value-loss-final-report/1.0.0',
      templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
      reportNote: 'Kullanıcı kontrollü nihai not.',
      calculation: {
        grossValueLossMinor: 10_000_000,
        faultAdjustedValueLossMinor: 7_500_000,
      },
      rule: { ruleVersion: '2026.07.01.1' },
    })
    expect(first.content.comparables[0]).toMatchObject({
      evidenceKey: 'market-pre',
      sourceReference: 'ref:sentetik-emsal',
    })
    expect(canonicalizeTrafficValueLossReportContent(first.content))
      .toBe(canonicalizeTrafficValueLossReportContent(second.content))
  })

  it('onaysız sürümü, eksik kaynak bağlantısını ve geçersiz notu fail-closed reddeder', () => {
    expect(buildTrafficValueLossReportContent({
      ...source,
      version: { ...source.version, status: 'draft', humanApprovalStatus: 'pending', approvedBy: null, approvedAt: null },
    }, null)).toEqual({ ok: false, error: 'REPORT_SOURCE_NOT_APPROVED' })
    expect(buildTrafficValueLossReportContent({
      ...source,
      version: { ...source.version, comparables: [{ ...source.version.comparables[0], evidenceId: 'missing' }] },
    }, null)).toEqual({ ok: false, error: 'REPORT_COMPARABLE_SOURCE_MISSING' })
    expect(buildTrafficValueLossReportContent(source, 'x'.repeat(501)))
      .toEqual({ ok: false, error: 'REPORT_NOTE_INVALID' })
  })
})
