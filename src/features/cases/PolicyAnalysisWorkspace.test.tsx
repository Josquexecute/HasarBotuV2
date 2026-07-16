import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyAnalysisWorkspace } from './PolicyAnalysisWorkspace'

const CASE_ID = '019f8000-0000-7000-8000-000000000030'
const RUN_ID = '019f8000-0000-7000-8000-000000000031'
const BUNDLE_ID = '019f8000-0000-7000-8000-000000000032'
const DOCUMENT_ID = '019f8000-0000-7000-8000-000000000033'
const DOCUMENT_VERSION_ID = '019f8000-0000-7000-8000-000000000034'
const ANALYSIS_ID = '019f8000-0000-7000-8000-000000000035'
const ANALYSIS_VERSION_ID = '019f8000-0000-7000-8000-000000000036'
const SOURCE_REFERENCE_ID = '019f8000-0000-7000-8000-000000000037'
const ANCHOR_ID = 'a'.repeat(64)

const sourceItem = {
  sourceAnchorId: ANCHOR_ID,
  sourceType: 'pdf_text',
  documentId: DOCUMENT_ID,
  documentVersionId: DOCUMENT_VERSION_ID,
  extractionId: '019f8000-0000-7000-8000-000000000038',
  sourceItemId: '019f8000-0000-7000-8000-000000000039',
  pageNumber: 6,
  boundedExcerpt: 'Anlaşmasız serviste sentetik %10 muafiyet uygulanır.',
  textHash: 'b'.repeat(64),
  sourceQuality: 'high',
  warnings: [],
  historicalSelected: false,
}
const review = {
  schemaVersion: 'policy-ai-human-review/1.0.0',
  runId: RUN_ID,
  candidateId: 'deductible-10',
  reviewVersion: 1,
  action: 'accepted',
  normalizedValue: { percentage: 10 },
  originalValue: '%10',
  conditions: ['anlaşmasız servis'],
  exceptions: [],
  sourceAnchorIds: [ANCHOR_ID],
  reason: null,
  evidenceStatus: 'validated',
  reviewedByUserId: DOCUMENT_ID,
  reviewedAt: '2026-07-16T08:00:00.000Z',
}
const candidate = {
  candidateId: 'deductible-10',
  category: 'deductible',
  canonicalField: 'deductible.conditional',
  normalizedValue: { percentage: 10 },
  originalValue: '%10',
  conditions: ['anlaşmasız servis'],
  exceptions: [],
  sourceAnchorIds: [ANCHOR_ID],
  providerConfidence: 0.9,
  sourceQuality: 'high',
  validationStatus: 'validated',
  conflictStatus: 'none',
  humanReviewStatus: 'pending',
  providerId: 'deterministic-success',
  providerVersion: 'deterministic/1.0.0',
  modelId: 'local-fixture-v1',
  promptTemplateVersion: 'policy-ai-extraction/1.0.0',
  outputSchemaVersion: 'policy-ai-candidates/1.0.0',
  review,
}
const runSummary = {
  id: RUN_ID,
  caseId: CASE_ID,
  status: 'review_required',
  providerId: 'deterministic-success',
  providerVersion: 'deterministic/1.0.0',
  modelId: 'local-fixture-v1',
  promptTemplateVersion: 'policy-ai-extraction/1.0.0',
  outputSchemaVersion: 'policy-ai-candidates/1.0.0',
  sourceBundleHash: 'c'.repeat(64),
  sourceBundleId: BUNDLE_ID,
  candidateCount: 1,
  conflictCount: 0,
  controlRequiredCount: 0,
  inputCharacters: 64,
  estimatedCostMinor: 1,
  actualCostMinor: 1,
  safeErrorCode: null,
  version: 4,
  createdAt: '2026-07-16T07:59:00.000Z',
  startedAt: '2026-07-16T08:00:00.000Z',
  completedAt: '2026-07-16T08:00:01.000Z',
  privacy: {
    externalProvider: false,
    policyVersion: 'policy-ai-pii/local-only',
    outboundPayloadHash: null,
    outboundInputCharacters: 64,
    redactedValueCount: 0,
    redactedCategories: [],
    retentionMode: 'local_only',
    pricingVersion: 'deterministic-cost/1.0.0',
  },
}
const runDetail = {
  run: {
    ...runSummary,
    budget: {
      enabled: true,
      providerAvailable: true,
      providerAllowed: true,
      estimatedCostMinor: 1,
      currentMonthCostMinor: 1,
      monthlyBudgetMinor: 100,
      perRequestBudgetMinor: 10,
      allowed: true,
      reasonCode: null,
    },
    bundle: {
      id: BUNDLE_ID,
      sourceBundleHash: 'c'.repeat(64),
      bundleSchemaVersion: 'policy-ai-source-bundle/1.0.0',
      documentVersionIds: [DOCUMENT_VERSION_ID],
      inputCharacters: 64,
      sourceCount: 1,
      completeness: 'complete',
      missingPages: [],
      ocrRequiredPages: [],
      qualityWarnings: [],
      createdAt: '2026-07-16T07:59:00.000Z',
      items: [sourceItem],
    },
  },
}
const promotionPreview = {
  schemaVersion: 'policy-ai-promotion/1.0.0',
  runId: RUN_ID,
  runVersion: 4,
  reviewSetHash: 'd'.repeat(64),
  totalCandidateCount: 1,
  acceptedCount: 1,
  editedCount: 0,
  rejectedCount: 0,
  controlRequiredCount: 0,
  pendingCount: 0,
  promotableCount: 1,
  sourceCount: 1,
  conflictCount: 0,
  preservedConflictCount: 0,
  canPromote: true,
  blockers: [],
  warnings: [],
  targetAnalysisId: null,
  targetAnalysisVersion: null,
  nextAnalysisVersion: 1,
}
const promotion = {
  id: BUNDLE_ID,
  schemaVersion: 'policy-ai-promotion/1.0.0',
  runId: RUN_ID,
  reviewSetHash: 'd'.repeat(64),
  analysisId: ANALYSIS_ID,
  analysisVersionId: ANALYSIS_VERSION_ID,
  analysisVersion: 1,
  promotedCandidateCount: 1,
  preservedConflictCount: 0,
  promotedByUserId: DOCUMENT_ID,
  promotedAt: '2026-07-16T08:01:00.000Z',
}
const sourceReference = {
  id: SOURCE_REFERENCE_ID,
  documentId: DOCUMENT_ID,
  documentVersionId: DOCUMENT_VERSION_ID,
  pageNumber: 6,
  sectionHeading: 'AI insan incelemesi',
  clauseIdentifier: 'deductible.conditional',
  rawExcerpt: '%10',
  excerptHash: 'e'.repeat(64),
  locator: `ai-source-anchor:${ANCHOR_ID}`,
  sourceType: 'policy',
  confidence: 0.9,
}
const analysis = {
  id: ANALYSIS_ID,
  currentAnalysisVersion: 1,
  currentStatus: 'draft',
  version: 1,
  currentVersion: {
    sourceDocumentId: DOCUMENT_ID,
    sourceDocumentVersionId: DOCUMENT_VERSION_ID,
    analysisVersion: 1,
    analysisStatus: 'draft',
    sourceCompleteness: 'complete',
    humanApprovalStatus: 'pending',
    productName: null,
    insurerFormat: null,
    aiCandidateFacts: [{
      id: 'fact-1',
      category: 'deductible',
      canonicalField: 'deductible.conditional',
      normalizedValue: { percentage: 10 },
      originalValue: '%10',
      conditions: ['anlaşmasız servis'],
      exceptions: [],
      reviewAction: 'accepted',
      originRunId: RUN_ID,
      originCandidateId: 'deductible-10',
      originReviewVersion: 1,
      sourceAnchorIds: [ANCHOR_ID],
      sourceReferenceIds: [SOURCE_REFERENCE_ID],
      providerConfidence: 0.9,
      sourceQuality: 'high',
      providerId: 'deterministic-success',
      providerVersion: 'deterministic/1.0.0',
      modelId: 'local-fixture-v1',
      reviewedByUserId: DOCUMENT_ID,
      reviewedAt: '2026-07-16T08:00:00.000Z',
    }],
    sourceReferences: [sourceReference],
    coverages: [],
    deductibles: [],
    serviceRules: [],
    partRules: [],
    replacementVehicleRules: [],
    exclusions: [],
    conflicts: [],
  },
}

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

afterEach(() => vi.restoreAllMocks())

describe('Kasko poliçe analiz uçtan uca çalışma alanı', () => {
  it('onaylanan adayı uygular, Paket 23 taslağını yeniler ve kanıtı aynı dosya detayında gösterir', async () => {
    let promoted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/ai/providers')) return response(200, { policy: { enabled: true, monthlyBudgetMinor: 100, perRequestBudgetMinor: 10, monthlyHardStop: true, currentMonthCostMinor: 0, maximumInputCharacters: 50_000, maximumCandidates: 50, requestTimeoutMs: 5_000 }, providers: [{ providerId: 'deterministic-success', configured: true, organizationEnabled: true, providerAllowed: true, callReady: true, providerVersion: 'deterministic/1.0.0', modelId: 'local-fixture-v1', externalProvider: false, retentionMode: 'local_only', pricingVersion: 'deterministic-cost/1.0.0', maximumInputCharacters: 200_000, reasonCode: null }] })
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (init?.method === 'POST' && url.endsWith('/promote')) {
        promoted = true
        return response(201, { promotion })
      }
      if (url.includes('/candidates?')) return response(200, {
        items: [candidate],
        conflicts: [],
        pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
      })
      if (url.endsWith('/promotion-preview')) return response(200, { preview: promotionPreview })
      if (url.endsWith(`/policy-ai-extractions/${RUN_ID}`)) return response(200, runDetail)
      if (url.endsWith('/policy-ai-extractions')) return response(200, { items: [runSummary] })
      if (url.endsWith(`/policy-analyses/${ANALYSIS_ID}`)) return response(200, { analysis })
      if (url.endsWith('/policy-analyses')) return response(200, { items: promoted ? [{ id: ANALYSIS_ID }] : [] })
      return response(404, {})
    }) as never)

    const user = userEvent.setup()
    render(<PolicyAnalysisWorkspace caseId={CASE_ID} source="api" />)
    expect(await screen.findByRole('heading', { name: 'Kasko Poliçe Analiz Akışı' })).toBeInTheDocument()
    expect(await screen.findByText('Kasko poliçe analizi yok')).toBeInTheDocument()
    await user.click(screen.getByLabelText(/yeni, onaysız Paket 23 taslak sürümüne uygulanmasını/))
    await user.click(screen.getByRole('button', { name: 'Onaylanan Adayları Uygula' }))

    await waitFor(() => expect(screen.getByText('Onaylanan adaylar analiz taslağına uygulandı.')).toBeInTheDocument())
    expect(await screen.findByText('Analiz v1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'İnsan Onaylı AI Adayları' })).toBeInTheDocument()
    expect(screen.getAllByText(/Sayfa 6 · AI insan incelemesi/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/deductible.conditional/).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('P:\\')
  })
})
