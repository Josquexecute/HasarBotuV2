import { describe, expect, it } from 'vitest'
import {
  emailAiPlanRequestSchema,
  emailAiPlanResponseSchema,
  emailAiRunResponseSchema,
  emailAiStartRequestSchema,
  policyAiUsageResponseSchema,
} from '../src/index.js'

const id = '019f5dd6-b191-7380-afe2-95580597762f'
const hash = 'a'.repeat(64)
const privacy = {
  externalProvider: true,
  policyVersion: 'email-ai-pii-redaction/1.0.0',
  outboundPayloadHash: hash,
  outboundInputCharacters: 240,
  redactedValueCount: 3,
  redactedCategories: ['email', 'name', 'plate'],
  retentionMode: 'free_tier_product_improvement',
  warnings: ['PII_REDACTED'],
} as const
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
} as const

describe('email AI contracts', () => {
  it('plan/start komutlarını strict doğrular ve açık egress onayı ister', () => {
    expect(emailAiPlanRequestSchema.parse({
      draftType: 'missing_document_request',
      providerId: 'gemini-generate-content',
    })).toEqual({
      draftType: 'missing_document_request',
      instruction: null,
      providerId: 'gemini-generate-content',
    })
    expect(emailAiStartRequestSchema.parse({
      expectedCaseVersion: 2,
      expectedPreviewHash: hash,
      planHash: hash,
      draftType: 'missing_document_request',
      providerId: 'gemini-generate-content',
      confirmed: true,
    }).confirmed).toBe(true)
    expect(() => emailAiStartRequestSchema.parse({
      expectedCaseVersion: 2,
      expectedPreviewHash: hash,
      planHash: hash,
      draftType: 'missing_document_request',
      providerId: 'gemini-generate-content',
      confirmed: false,
    })).toThrow()
    expect(() => emailAiPlanRequestSchema.parse({
      draftType: 'case_status_update',
      providerId: 'gemini-generate-content',
      recipient: 'hasar@example.test',
    })).toThrow()
  })

  it('plan yalnız minimize edilmiş privacy/bütçe özeti ve deterministik preview taşır', () => {
    const parsed = emailAiPlanResponseSchema.parse({
      caseId: id,
      caseVersion: 2,
      draftType: 'missing_document_request',
      providerId: 'gemini-generate-content',
      providerVersion: 'gemini-generate-content/1.0.0',
      modelId: 'gemini-2.5-flash',
      promptTemplateVersion: 'email-ai-draft/1.0.0',
      outputSchemaVersion: 'email-ai-suggestion/1.0.0',
      basePreview: {
        subject: '2026/42 · 34 ABC 42 · Eksik Evrak',
        body: 'Merhaba.',
        previewHash: hash,
      },
      planHash: hash,
      privacy,
      budget,
      canStart: true,
      requiresExplicitEgressConfirmation: true,
      requiresHumanReview: true,
    })
    expect(parsed.privacy.redactedCategories).toContain('email')
    expect(parsed.requiresExplicitEgressConfirmation).toBe(true)
  })

  it('öneri nihai karar veya alıcı taşımadan insan incelemesi ister', () => {
    const response = emailAiRunResponseSchema.parse({
      run: {
        id,
        caseId: id,
        draftType: 'missing_document_request',
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
          subject: '2026/42 · 34 ABC 42 · Eksik Evrak Hatırlatması',
          body: 'Merhaba.',
          reasoning: 'Şablon sadeleştirildi.',
          warnings: ['Kullanıcı kontrolü zorunludur.'],
          confidence: 0.82,
          requiresHumanReview: true,
        },
        safeErrorCode: null,
        createdAt: '2026-07-16T12:00:00.000Z',
        startedAt: '2026-07-16T12:00:00.000Z',
        completedAt: '2026-07-16T12:00:01.000Z',
      },
    })
    expect(response.run.suggestion?.requiresHumanReview).toBe(true)
    expect(response.run.suggestion).not.toHaveProperty('to')
  })

  it('ortak usage cevabı policy ve email modülünü açıkça ayırır', () => {
    const parsed = policyAiUsageResponseSchema.parse({
      month: '2026-07',
      totalCostMinor: 0,
      items: [{
        module: 'email_draft',
        runId: id,
        caseId: id,
        providerId: 'gemini-generate-content',
        modelId: 'gemini-2.5-flash',
        inputCharacters: 240,
        outputCharacters: 120,
        inputTokens: 60,
        outputTokens: 30,
        pricingVersion: 'gemini-free-tier/2026-07-15',
        estimatedCostMinor: 0,
        actualCostMinor: 0,
        status: 'completed',
        safeErrorCode: null,
        startedAt: '2026-07-16T12:00:00.000Z',
        completedAt: '2026-07-16T12:00:01.000Z',
      }],
    })
    expect(parsed.items[0]?.module).toBe('email_draft')
  })
})
