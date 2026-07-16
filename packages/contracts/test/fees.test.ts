import { describe, expect, it } from 'vitest'
import {
  caseSummaryReportQuerySchema,
  caseSummaryReportResponseSchema,
  closureFeeApproveRequestSchema,
  closureFeeCandidateCreateRequestSchema,
  closureFeeRecordSchema,
} from '../src/index.js'

const ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const OTHER_ID = '018f3f4c-89ab-7def-8123-456789abcdee'

describe('kapanma ücreti ve rapor contracts', () => {
  it('minor-unit aday ve açık onay gövdelerini strict doğrular', () => {
    expect(closureFeeCandidateCreateRequestSchema.safeParse({
      expectedCaseVersion: 2,
      candidateAmountMinor: 485_000,
      sourceDocumentVersionId: ID,
      sourcePage: 12,
    }).success).toBe(true)
    expect(closureFeeCandidateCreateRequestSchema.safeParse({
      expectedCaseVersion: 2,
      candidateAmountMinor: 48.5,
      sourceDocumentVersionId: ID,
      sourcePage: 12,
    }).success).toBe(false)
    expect(closureFeeApproveRequestSchema.safeParse({
      expectedVersion: 1,
      confirmed: false,
    }).success).toBe(false)
  })

  it('ücret sürümü ve geçmişini kesin şemayla doğrular', () => {
    const currentVersion = {
      id: OTHER_ID,
      feeVersion: 2,
      status: 'approved',
      candidateAmountMinor: 485_000,
      approvedAmountMinor: 485_000,
      currency: 'TRY',
      sourceDocumentVersionId: ID,
      sourcePage: 12,
      sourceType: 'manual',
      ruleVersion: 'closure-fee/1.0.0',
      correctionReason: null,
      createdByUserId: ID,
      approvedByUserId: ID,
      approvedAt: '2026-07-16T10:00:00.000Z',
      createdAt: '2026-07-16T10:00:00.000Z',
    }
    expect(closureFeeRecordSchema.safeParse({
      id: ID,
      caseId: OTHER_ID,
      version: 2,
      currentVersion,
      history: [currentVersion],
      permissions: { canCreateCandidate: false, canApprove: false, canCorrect: true },
    }).success).toBe(true)
  })

  it('YYYY-MM dönemini ve rapor cevabını deterministik doğrular', () => {
    expect(caseSummaryReportQuerySchema.safeParse({ period: '2026-07' }).success).toBe(true)
    expect(caseSummaryReportQuerySchema.safeParse({ period: '07.2026' }).success).toBe(false)
    expect(caseSummaryReportResponseSchema.safeParse({
      period: '2026-07',
      periodStart: '2026-07-01',
      periodEndExclusive: '2026-08-01',
      generatedAt: '2026-07-16T10:00:00.000Z',
      periodBasis: 'open_created_closed_finalized',
      summary: {
        totalCaseCount: 0,
        openCaseCount: 0,
        closedCaseCount: 0,
        trafficCaseCount: 0,
        cascoCaseCount: 0,
        approvedFeeCount: 0,
        approvedFeeTotalMinor: 0,
        controlRequiredFeeCount: 0,
        closedCaseWithoutFeeCount: 0,
      },
      distribution: [
        { code: 'traffic', count: 0 },
        { code: 'casco', count: 0 },
        { code: 'closed', count: 0 },
      ],
      responsibleUsers: [],
      services: [],
      pendingFees: [],
    }).success).toBe(true)
  })
})
