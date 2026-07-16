import { describe, expect, it } from 'vitest'
import type { TrafficValueLossReportContentDto } from '@hasarbotu/contracts'
import { parseLocalDate, parseUtcDateTime } from '@hasarbotu/domain'
import {
  hashTrafficValueLossReportPdf,
  renderTrafficValueLossReportPdf,
} from '../src/traffic-value-loss/report-pdf.js'

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

const content: TrafficValueLossReportContentDto = {
  schemaVersion: 'traffic-value-loss-final-report/1.0.0',
  templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
  title: 'Trafik Değer Kaybı Nihai Raporu',
  caseReference: {
    caseId: '019fa300-0000-7000-8000-000000000001',
    officeNumber: '2026/34',
    plate: '34 TEST 034',
    caseType: 'traffic',
    lossDate: local('2026-07-02'),
    notificationDate: local('2026-07-03'),
  },
  assessment: {
    assessmentId: '019fa300-0000-7000-8000-000000000002',
    versionId: '019fa300-0000-7000-8000-000000000003',
    assessmentVersion: 1,
    status: 'approved',
    humanApprovalStatus: 'approved',
    approvedBy: '019fa300-0000-7000-8000-000000000004',
    approvedAt: utc('2026-07-16T09:00:00.000Z'),
    approvalReason: 'Sentetik kanıtlar insan tarafından kontrol edildi.',
  },
  vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
  damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
  calculation: {
    eligibilityStatus: 'calculable',
    calculationMethod: 'market_value_difference',
    roundingRule: 'half_up_minor_unit',
    preAccidentMarketValueMinor: 100_000_000,
    postRepairMarketValueMinor: 90_000_000,
    grossValueLossMinor: 10_000_000,
    faultRateBasisPoints: 7_500,
    faultAdjustedValueLossMinor: 7_500_000,
    qualifyingPreComparableCount: 1,
    qualifyingPostComparableCount: 0,
    reasoning: ['Sentetik piyasa farkı kanıt ve emsallerle hesaplandı.'],
  },
  evidence: [{
    id: '019fa300-0000-7000-8000-000000000005',
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
    id: '019fa300-0000-7000-8000-000000000006',
    comparableKey: 'pre-1',
    side: 'pre_accident',
    amountMinor: 100_000_000,
    mileage: 50_000,
    observedAt: local('2026-07-10'),
    evidenceId: '019fa300-0000-7000-8000-000000000005',
    evidenceKey: 'market-pre',
    sourceReference: 'ref:sentetik-emsal',
    excluded: false,
    exclusionReason: null,
  }],
  uncertainties: [],
  rule: {
    ruleSetId: 'traffic-value-loss-market-difference',
    ruleVersion: '2026.07.01.1',
    effectiveFrom: local('2026-07-01'),
    sources: [{
      code: 'RG-2026',
      title: 'Resmî Gazete sentetik kaynak',
      sourceType: 'official_gazette',
      publishedAt: local('2026-06-12'),
      effectiveFrom: local('2026-07-01'),
      locator: 'Madde 2',
      url: 'https://www.resmigazete.gov.tr/sentetik',
    }, {
      code: 'SEDDK-2026',
      title: 'SEDDK sentetik kaynak',
      sourceType: 'seddk_circular',
      publishedAt: local('2026-05-13'),
      effectiveFrom: local('2026-07-01'),
      locator: 'Ek-1.1',
      url: 'https://seddk.gov.tr/sentetik',
    }],
  },
  reportNote: 'Kullanıcı kontrollü sentetik nihai not.',
}

describe('Trafik değer kaybı nihai PDF renderer', () => {
  it('aynı immutable snapshot için aynı doğrulanabilir Türkçe PDF byte çıktısını üretir', () => {
    const input = {
      reportId: '019fa300-0000-7000-8000-000000000007',
      generatedAt: '2026-07-16T09:30:00.000Z',
      content,
    }
    const first = renderTrafficValueLossReportPdf(input)
    const second = renderTrafficValueLossReportPdf(input)
    expect(first.subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect(first.length).toBeGreaterThan(100_000)
    expect(first.equals(second)).toBe(true)
    expect(hashTrafficValueLossReportPdf(first)).toBe(hashTrafficValueLossReportPdf(second))
  })
})
