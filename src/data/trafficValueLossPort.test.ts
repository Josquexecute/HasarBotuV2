import { describe, expect, it, vi } from 'vitest'
import {
  createHttpTrafficValueLossAdapter,
  TrafficValueLossError,
  type TrafficValueLossDraftInput,
} from './trafficValueLossPort'

const CASE_ID = '019f9000-0000-7000-8000-000000000001'
const ASSESSMENT_ID = '019f9000-0000-7000-8000-000000000002'
const VERSION_ID = '019f9000-0000-7000-8000-000000000003'
const USER_ID = '019f9000-0000-7000-8000-000000000004'
const EVIDENCE_ID = '019f9000-0000-7000-8000-000000000005'

const version = {
  id: VERSION_ID,
  organizationId: '019f9000-0000-7000-8000-000000000007',
  caseId: CASE_ID,
  calculationId: ASSESSMENT_ID,
  revisionId: VERSION_ID,
  assessmentVersion: 1,
  status: 'draft',
  ruleSetId: 'traffic-value-loss-market-difference',
  ruleVersion: '2026.07.01.1',
  effectiveFrom: '2026-07-01',
  input: {
    lossDate: '2026-07-02',
    notificationDate: '2026-07-03',
    evaluatedOn: '2026-07-16',
    heavyOrTotalDamage: false,
    vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
    faultRateBasisPoints: 7_500,
    preAccidentMarketValueMinor: 100_000_000,
    postRepairMarketValueMinor: 90_000_000,
    damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
  },
  evaluation: {
    ruleSetId: 'traffic-value-loss-market-difference',
    ruleVersion: '2026.07.01.1',
    effectiveFrom: '2026-07-01',
    calculationMethod: 'market_value_difference',
    roundingRule: 'half_up_minor_unit',
    ruleSources: [{
      code: 'RG', title: 'Resmî Gazete', sourceType: 'official_gazette', publishedAt: '2026-06-12',
      effectiveFrom: '2026-07-01', locator: 'Madde 2', url: 'https://www.resmigazete.gov.tr/test',
    }, {
      code: 'SEDDK', title: 'SEDDK Genelgesi', sourceType: 'seddk_circular', publishedAt: '2026-06-15',
      effectiveFrom: '2026-07-01', locator: 'Bölüm 3', url: 'https://www.seddk.gov.tr/test',
    }],
    eligibilityStatus: 'calculable',
    grossValueLossMinor: 10_000_000,
    faultAdjustedValueLossMinor: 7_500_000,
    qualifyingPreComparableCount: 3,
    qualifyingPostComparableCount: 3,
    uncertainties: [],
    reasoning: ['Kaynaklı piyasa farkı taslağı.'],
    humanApprovalRequired: true,
    canSubmitForApproval: true,
  },
  evidence: [{
    id: EVIDENCE_ID,
    evidenceKey: 'pre-market',
    sourceType: 'market_comparable',
    documentId: null,
    documentVersionId: null,
    externalReference: 'ref:sentetik-pre',
    sourceHash: 'a'.repeat(64),
    observedAt: '2026-07-10',
    supports: ['pre_accident_market_value'],
    verificationStatus: 'verified',
    conflict: false,
    notes: null,
    createdAt: '2026-07-16T08:00:00.000Z',
  }],
  comparables: [{
    id: '019f9000-0000-7000-8000-000000000006',
    comparableKey: 'pre-1',
    side: 'pre_accident',
    amountMinor: 100_000_000,
    mileage: 50_000,
    observedAt: '2026-07-10',
    evidenceId: EVIDENCE_ID,
    excluded: false,
    exclusionReason: null,
  }],
  humanApprovalStatus: 'pending',
  approvedBy: null,
  approvedAt: null,
  approvalReason: null,
  createdBy: USER_ID,
  createdAt: '2026-07-16T08:00:00.000Z',
} as const

const assessment = {
  id: ASSESSMENT_ID,
  caseId: CASE_ID,
  currentVersion: version,
  version: 1,
  createdAt: '2026-07-16T08:00:00.000Z',
  updatedAt: '2026-07-16T08:00:00.000Z',
}

const draft: TrafficValueLossDraftInput = {
  evaluatedOn: '2026-07-16',
  heavyOrTotalDamage: false,
  vehicle: version.input.vehicle,
  faultRateBasisPoints: 7_500,
  preAccidentMarketValueMinor: 100_000_000,
  postRepairMarketValueMinor: 90_000_000,
  damageParts: version.input.damageParts,
  comparables: [],
  evidence: [{
    evidenceKey: 'pre-market',
    sourceType: 'market_comparable',
    documentId: null,
    documentVersionId: null,
    externalReference: 'ref:sentetik-pre',
    sourceHash: 'a'.repeat(64),
    observedAt: '2026-07-10',
    supports: ['pre_accident_market_value'],
    verificationStatus: 'verified',
    conflict: false,
    notes: null,
  }],
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('TrafficValueLoss HttpApiAdapter', () => {
  it('current assessment ve sürüm geçmişini okur; create/submit/approve komutlarında kararlı idempotency taşır', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { assessment }))
      .mockResolvedValueOnce(response(200, { versions: [version] }))
      .mockResolvedValueOnce(response(200, { version }))
      .mockImplementation(async () => response(200, { assessment }))
    const adapter = createHttpTrafficValueLossAdapter({ fetchImpl, idempotencyKeyFactory: () => 'stable-key' })
    const loaded = await adapter.load(CASE_ID)
    expect(loaded.assessment?.currentVersion.evaluation.faultAdjustedValueLossMinor).toBe(7_500_000)
    expect(loaded.versions).toHaveLength(1)
    await adapter.createVersion(CASE_ID, 1, draft)
    await adapter.submit(CASE_ID, VERSION_ID, 1)
    await adapter.approve(CASE_ID, VERSION_ID, 2, 'Kontrol edildi.')
    for (const call of fetchImpl.mock.calls.slice(3)) {
      expect((call[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('stable-key')
    }
    expect(JSON.parse(String(fetchImpl.mock.calls[3]?.[1]?.body))).toMatchObject({ expectedVersion: 1, evaluatedOn: '2026-07-16' })
  })

  it('assessment 404 durumunu gerçek boş başlangıç olarak korur', async () => {
    const adapter = createHttpTrafficValueLossAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(404, {})) as unknown as typeof fetch })
    await expect(adapter.load(CASE_ID)).resolves.toEqual({ assessment: null, versions: [], currentApproved: null })
  })

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [409, 'conflict'], [503, 'unavailable']] as const)(
    'HTTP %s hatasını %s sınıfına map eder ve mock fallback yapmaz',
    async (status, kind) => {
      const adapter = createHttpTrafficValueLossAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(status, {})) as unknown as typeof fetch })
      await expect(adapter.load(CASE_ID)).rejects.toMatchObject({ name: 'TrafficValueLossError', kind })
    },
  )

  it('ağ hatasını ve path benzeri dış referansı güvenli biçimde reddeder', async () => {
    const network = createHttpTrafficValueLossAdapter({ fetchImpl: vi.fn().mockRejectedValue(new Error('secret P:\\müşteri')) as unknown as typeof fetch })
    await expect(network.load(CASE_ID)).rejects.toEqual(new TrafficValueLossError('unavailable', 'traffic value loss API unreachable'))
    const unsafe = {
      ...assessment,
      currentVersion: {
        ...version,
        evidence: [{ ...version.evidence[0], externalReference: 'ref:P:\\müşteri' }],
      },
    }
    const adapter = createHttpTrafficValueLossAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(200, { assessment: unsafe })) as unknown as typeof fetch })
    await expect(adapter.load(CASE_ID)).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
