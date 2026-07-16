import { describe, expect, it, vi } from 'vitest'
import {
  createHttpTrafficValueLossReportAdapter,
  TrafficValueLossReportError,
  type TrafficValueLossReportContentRecord,
} from './trafficValueLossReportPort'

const CASE = '019fa200-0000-7000-8000-000000000001'
const VERSION = '019fa200-0000-7000-8000-000000000002'
const REPORT = '019fa200-0000-7000-8000-000000000003'
const USER = '019fa200-0000-7000-8000-000000000004'
const content: TrafficValueLossReportContentRecord = {
  schemaVersion: 'traffic-value-loss-final-report/1.0.0',
  templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
  title: 'Trafik Değer Kaybı Nihai Raporu',
  caseReference: {
    caseId: CASE,
    officeNumber: '2026/34',
    plate: '34 TEST 034',
    caseType: 'traffic',
    lossDate: '2026-07-02',
    notificationDate: '2026-07-03',
  },
  assessment: {
    assessmentId: '019fa200-0000-7000-8000-000000000005',
    versionId: VERSION,
    assessmentVersion: 1,
    status: 'approved',
    humanApprovalStatus: 'approved',
    approvedBy: USER,
    approvedAt: '2026-07-16T09:00:00.000Z',
    approvalReason: null,
  },
  vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
  damageParts: [],
  calculation: {
    eligibilityStatus: 'calculable',
    calculationMethod: 'market_value_difference',
    roundingRule: 'half_up_minor_unit',
    preAccidentMarketValueMinor: 100_000_000,
    postRepairMarketValueMinor: 90_000_000,
    grossValueLossMinor: 10_000_000,
    faultRateBasisPoints: 7_500,
    faultAdjustedValueLossMinor: 7_500_000,
    qualifyingPreComparableCount: 3,
    qualifyingPostComparableCount: 3,
    reasoning: ['Sentetik hesaplama.'],
  },
  evidence: [{
    id: '019fa200-0000-7000-8000-000000000006',
    evidenceKey: 'market',
    sourceType: 'market_comparable',
    documentId: null,
    documentVersionId: null,
    externalReference: 'ref:sentetik',
    sourceHash: 'a'.repeat(64),
    observedAt: '2026-07-10',
    supports: ['pre_accident_market_value'],
    verificationStatus: 'verified',
    conflict: false,
    notes: null,
  }],
  comparables: [{
    id: '019fa200-0000-7000-8000-000000000007',
    comparableKey: 'pre-1',
    side: 'pre_accident',
    amountMinor: 100_000_000,
    mileage: 50_000,
    observedAt: '2026-07-10',
    evidenceId: '019fa200-0000-7000-8000-000000000006',
    evidenceKey: 'market',
    sourceReference: 'ref:sentetik',
    excluded: false,
    exclusionReason: null,
  }],
  uncertainties: [],
  rule: {
    ruleSetId: 'traffic-value-loss-market-difference',
    ruleVersion: '2026.07.01.1',
    effectiveFrom: '2026-07-01',
    sources: [{
      code: 'RG',
      title: 'Resmî Gazete sentetik kaynak',
      sourceType: 'official_gazette',
      publishedAt: '2026-06-12',
      effectiveFrom: '2026-07-01',
      locator: 'Madde 2',
      url: 'https://www.resmigazete.gov.tr/sentetik',
    }, {
      code: 'SEDDK',
      title: 'SEDDK sentetik kaynak',
      sourceType: 'seddk_circular',
      publishedAt: '2026-05-13',
      effectiveFrom: '2026-07-01',
      locator: 'Ek-1.1',
      url: 'https://seddk.gov.tr/sentetik',
    }],
  },
  reportNote: null,
}
const report = {
  id: REPORT,
  caseId: CASE,
  assessmentId: content.assessment.assessmentId,
  assessmentVersionId: VERSION,
  assessmentVersion: 1,
  status: 'ready',
  format: 'pdf',
  schemaVersion: content.schemaVersion,
  templateVersion: content.templateVersion,
  ruleVersion: content.rule.ruleVersion,
  contentHash: 'b'.repeat(64),
  pdfHash: 'c'.repeat(64),
  pdfByteSize: 8,
  content,
  generatedBy: USER,
  generatedAt: '2026-07-16T09:30:00.000Z',
  version: 1,
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('Trafik değer kaybı rapor HTTP adapter', () => {
  it('önizleme, idempotent üretim, liste ve PDF indirme sınırlarını uygular', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/report-preview')) {
        expect(init?.method).toBe('POST')
        return json({ content, previewHash: 'b'.repeat(64), previewedAt: '2026-07-16T09:29:00.000Z' })
      }
      if (url.endsWith(`/versions/${VERSION}/reports`)) {
        expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('stable-key')
        return json({ report }, 201)
      }
      if (url.endsWith(`/reports/${REPORT}/pdf`)) {
        return new Response('%PDF-1.4', {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="trafik-deger-kaybi-v1.pdf"',
          },
        })
      }
      return json({ reports: [report] })
    })
    const adapter = createHttpTrafficValueLossReportAdapter({ fetchImpl })
    const preview = await adapter.preview(CASE, VERSION, 3, null)
    expect(preview.content.rule.ruleVersion).toBe('2026.07.01.1')
    expect((await adapter.generate(CASE, VERSION, 3, null, preview.previewHash, 'stable-key')).id).toBe(REPORT)
    expect(await adapter.list(CASE)).toHaveLength(1)
    const pdf = await adapter.download(CASE, REPORT)
    expect(pdf.filename).toBe('trafik-deger-kaybi-v1.pdf')
    expect(pdf.blob.type).toBe('application/pdf')
  })

  it('ağ ve conflict hatalarında mock fallback üretmez', async () => {
    const conflict = createHttpTrafficValueLossReportAdapter({ fetchImpl: vi.fn().mockResolvedValue(json({}, 409)) })
    await expect(conflict.preview(CASE, VERSION, 1, null)).rejects.toMatchObject({ kind: 'conflict' })
    const unavailable = createHttpTrafficValueLossReportAdapter({ fetchImpl: vi.fn().mockRejectedValue(new Error('network')) })
    await expect(unavailable.list(CASE)).rejects.toBeInstanceOf(TrafficValueLossReportError)
    await expect(unavailable.list(CASE)).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
