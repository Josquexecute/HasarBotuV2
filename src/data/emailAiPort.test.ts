import { describe, expect, it, vi } from 'vitest'
import {
  EmailAiError,
  createHttpEmailAiAdapter,
  type EmailAiPlanRecord,
  type EmailAiRunRecord,
} from './emailAiPort'

const caseId = '018f3f4c-89ab-7def-8123-456789abcdef'
const runId = '018f3f4c-89ab-7def-8123-456789abcdea'
const hash = 'a'.repeat(64)
const privacy = {
  externalProvider: true,
  policyVersion: 'email-ai-pii-redaction/1.0.0' as const,
  outboundPayloadHash: hash,
  outboundInputCharacters: 120,
  redactedValueCount: 2,
  redactedCategories: ['email', 'name'] as const,
  retentionMode: 'free_tier_product_improvement' as const,
  warnings: [],
}
const budget = {
  enabled: true,
  providerAvailable: true,
  providerAllowed: true,
  estimatedCostMinor: 0,
  currentMonthCostMinor: 0,
  monthlyBudgetMinor: 100,
  perRequestBudgetMinor: 10,
  allowed: true,
  reasonCode: null,
}
const plan: EmailAiPlanRecord = {
  caseId,
  caseVersion: 3,
  draftType: 'case_status_update',
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-generate-content/1.0.0',
  modelId: 'gemini-2.5-flash',
  promptTemplateVersion: 'email-ai-draft/1.0.0',
  outputSchemaVersion: 'email-ai-suggestion/1.0.0',
  basePreview: { subject: 'Dosya', body: 'Merhaba.', previewHash: hash },
  planHash: hash,
  privacy,
  budget,
  canStart: true,
  requiresExplicitEgressConfirmation: true,
  requiresHumanReview: true,
}
const run: EmailAiRunRecord = {
  id: runId,
  caseId,
  draftType: 'case_status_update',
  status: 'review_required',
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-generate-content/1.0.0',
  modelId: 'gemini-2.5-flash',
  promptTemplateVersion: 'email-ai-draft/1.0.0',
  outputSchemaVersion: 'email-ai-suggestion/1.0.0',
  basePreviewHash: hash,
  planHash: hash,
  version: 2,
  privacy,
  budget,
  suggestion: {
    schemaVersion: 'email-ai-suggestion/1.0.0',
    subject: 'Dosya · Bilgilendirme',
    body: 'Merhaba.',
    reasoning: 'Sadeleştirildi.',
    warnings: [],
    confidence: 0.8,
    requiresHumanReview: true,
  },
  safeErrorCode: null,
  createdAt: '2026-07-16T12:00:00.000Z',
  startedAt: '2026-07-16T12:00:00.000Z',
  completedAt: '2026-07-16T12:00:01.000Z',
}

describe('Email AI HttpApiAdapter', () => {
  it('plan ve start uçlarını strict contract ve idempotency ile çağırır', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run }), { status: 201 }))
    const port = createHttpEmailAiAdapter({
      fetchImpl: fetchMock,
      idempotencyKeyFactory: () => 'email-ai-key-123456',
    })
    await expect(port.plan(caseId, {
      draftType: 'case_status_update',
      instruction: null,
      providerId: 'gemini-generate-content',
    })).resolves.toEqual(plan)
    await expect(port.start(caseId, {
      expectedCaseVersion: 3,
      expectedPreviewHash: hash,
      planHash: hash,
      draftType: 'case_status_update',
      instruction: null,
      providerId: 'gemini-generate-content',
      confirmed: true,
    })).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/cases/${caseId}/email-ai-suggestions`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'idempotency-key': 'email-ai-key-123456' }),
      }),
    )
  })

  it('API kesintisinde mock fallback üretmez ve contract dışı cevabı reddeder', async () => {
    const offline = createHttpEmailAiAdapter({
      fetchImpl: vi.fn(async () => { throw new Error('offline') }),
    })
    await expect(offline.list(caseId)).rejects.toMatchObject({
      name: 'EmailAiError',
      kind: 'unavailable',
    })
    const invalid = createHttpEmailAiAdapter({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ run: { absolutePath: 'P:\\x' } }), {
        status: 200,
      })),
    })
    await expect(invalid.start(caseId, {
      expectedCaseVersion: 3,
      expectedPreviewHash: hash,
      planHash: hash,
      draftType: 'case_status_update',
      instruction: null,
      providerId: 'gemini-generate-content',
      confirmed: true,
    }, 'key-1234567890')).rejects.toBeInstanceOf(EmailAiError)
  })
})
