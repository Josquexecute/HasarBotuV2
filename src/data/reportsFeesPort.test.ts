import { describe, expect, it, vi } from 'vitest'
import {
  ReportsFeesError,
  createHttpReportsFeesAdapter,
} from './reportsFeesPort'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const FEE_ID = '018f3f4c-89ab-7def-8123-456789abcdee'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcded'
const USER_ID = '018f3f4c-89ab-7def-8123-456789abcdec'

const version = {
  id: VERSION_ID,
  feeVersion: 1,
  status: 'control_required',
  candidateAmountMinor: 485_000,
  approvedAmountMinor: null,
  currency: 'TRY',
  sourceDocumentVersionId: VERSION_ID,
  sourcePage: 12,
  sourceType: 'manual',
  ruleVersion: 'closure-fee/1.0.0',
  correctionReason: null,
  createdByUserId: USER_ID,
  approvedByUserId: null,
  approvedAt: null,
  createdAt: '2026-07-16T10:00:00.000Z',
} as const

const fee = {
  id: FEE_ID,
  caseId: CASE_ID,
  version: 1,
  currentVersion: version,
  history: [version],
  permissions: { canCreateCandidate: false, canApprove: true, canCorrect: false },
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('reports/fees HTTP adapter', () => {
  it('case fee, liste ve dönem raporunu strict contracts ile okur', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/reports/case-summary')) {
        return response({
          period: '2026-07',
          periodStart: '2026-07-01',
          periodEndExclusive: '2026-08-01',
          generatedAt: '2026-07-16T10:00:00.000Z',
          periodBasis: 'open_created_closed_finalized',
          includesFinancials: true,
          summary: {
            totalCaseCount: 1,
            openCaseCount: 0,
            closedCaseCount: 1,
            trafficCaseCount: 1,
            cascoCaseCount: 0,
            approvedFeeCount: 0,
            approvedFeeTotalMinor: 0,
            controlRequiredFeeCount: 1,
            closedCaseWithoutFeeCount: 0,
            approvedValueLossCount: 1,
            approvedValueLossTotalMinor: 245_000,
            controlRequiredValueLossCount: 0,
            notApplicableValueLossCount: 0,
          },
          distribution: [
            { code: 'traffic', count: 1 },
            { code: 'casco', count: 0 },
            { code: 'closed', count: 1 },
          ],
          responsibleUsers: [{ id: USER_ID, name: 'Sentetik Sorumlu' }],
          services: [],
          pendingFees: [{
            caseId: CASE_ID,
            officeCaseNumber: '2026/39',
            plate: '34 ABC 39',
            caseType: 'traffic',
            insurerName: null,
            serviceName: null,
            responsibleUserName: 'Sentetik Sorumlu',
            closedAt: '2026-07-10T10:00:00.000Z',
            fee,
          }],
        })
      }
      if (url.endsWith('/api/v1/fees')) return response({ items: [] })
      if (url.endsWith('/api/v1/traffic-value-loss/closure-summaries')) return response({ items: [] })
      return response({ fee, permissions: fee.permissions })
    })
    const adapter = createHttpReportsFeesAdapter({ baseUrl: 'http://api.test', fetchImpl })
    expect((await adapter.getCaseFee(CASE_ID)).fee?.id).toBe(FEE_ID)
    expect(await adapter.listFees()).toEqual([])
    const report = await adapter.getCaseSummaryReport({
      period: '2026-07',
      responsibleUserId: USER_ID,
    })
    expect(report.summary.controlRequiredFeeCount).toBe(1)
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain(`responsibleUserId=${USER_ID}`)
  })

  it('komutlarda Idempotency-Key ve kanonik minor-unit gövdesi kullanır', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input
      void init
      return response({ fee })
    })
    const adapter = createHttpReportsFeesAdapter({ fetchImpl })
    await adapter.createCandidate(CASE_ID, {
      expectedCaseVersion: 1,
      candidateAmountMinor: 485_000,
      sourceDocumentVersionId: VERSION_ID,
      sourcePage: 12,
    }, 'idem-p39-12345678')
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'idem-p39-12345678' })
    expect(JSON.parse(String(init.body))).toMatchObject({ candidateAmountMinor: 485_000 })
  })

  it('401 ve geçersiz successful response için fail-closed hata üretir', async () => {
    const unauthorized = createHttpReportsFeesAdapter({
      fetchImpl: vi.fn(async () => response({ ok: false }, 401)),
    })
    await expect(unauthorized.getCaseFee(CASE_ID)).rejects.toMatchObject({
      name: 'ReportsFeesError',
      kind: 'unauthorized',
    })
    const invalid = createHttpReportsFeesAdapter({
      fetchImpl: vi.fn(async () => response({ fee: { status: 'uydurma' } })),
    })
    await expect(invalid.getCaseFee(CASE_ID)).rejects.toBeInstanceOf(ReportsFeesError)
  })
})
