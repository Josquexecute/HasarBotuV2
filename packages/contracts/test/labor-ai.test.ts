import { describe, expect, it } from 'vitest'
import {
  laborAiPlanRequestSchema,
  laborAiRunSchema,
  laborAiStartRequestSchema,
  laborAiSuggestionSchema,
} from '../src/index.js'

const caseId = '019f5dd6-b191-7380-afe2-95580597762f'
const runId = '019f5dd6-b191-7380-afe2-955805977301'
const hash = 'a'.repeat(64)

const privacy = {
  externalProvider: true,
  policyVersion: 'labor-ai-pii-redaction/1.0.0',
  outboundPayloadHash: 'b'.repeat(64),
  outboundInputCharacters: 240,
  redactedValueCount: 2,
  redactedCategories: ['email', 'name'],
  retentionMode: 'free_tier_product_improvement',
  warnings: ['damage-description:PROMPT_INJECTION'],
}

const budget = {
  enabled: true,
  providerAvailable: true,
  providerAllowed: true,
  estimatedCostMinor: 5,
  currentMonthCostMinor: 0,
  monthlyBudgetMinor: 100,
  perRequestBudgetMinor: 10,
  allowed: true,
  reasonCode: null,
}

describe('labor AI contracts', () => {
  it('plan komutu bounded hasar tarifi ve sağlayıcı ister; fazla anahtar reddedilir', () => {
    expect(laborAiPlanRequestSchema.parse({
      damageDescription: 'Ön tampon ve sol çamurluk hasarlı.',
      providerId: 'gemini-generate-content',
    }).providerId).toBe('gemini-generate-content')
    expect(() => laborAiPlanRequestSchema.parse({
      damageDescription: '',
      providerId: 'gemini-generate-content',
    })).toThrow()
    expect(() => laborAiPlanRequestSchema.parse({
      damageDescription: 'x',
      providerId: 'unknown-provider',
    })).toThrow()
    expect(() => laborAiPlanRequestSchema.parse({
      damageDescription: 'x',
      providerId: 'gemini-generate-content',
      extra: true,
    })).toThrow()
  })

  it('start komutu plan hash, sürümler ve açık onay ister', () => {
    const parsed = laborAiStartRequestSchema.parse({
      damageDescription: 'Ön tampon hasarlı.',
      providerId: 'deterministic-success',
      expectedCaseVersion: 3,
      planHash: hash,
      confirmed: true,
    })
    expect(parsed.expectedSheetVersion).toBeNull()
    expect(() => laborAiStartRequestSchema.parse({
      damageDescription: 'Ön tampon hasarlı.',
      providerId: 'deterministic-success',
      expectedCaseVersion: 3,
      planHash: hash,
      confirmed: false,
    })).toThrow()
  })

  it('öneri şeması kalem sınırlarını ve insan incelemesini zorlar', () => {
    const suggestion = {
      schemaVersion: 'labor-ai-suggestion/1.0.0',
      items: [{ description: 'Ön tampon', action: 'Değişim', partAmountMinor: 1_840_00, laborAmountMinor: 220_00 }],
      reasoning: 'Standart dağılım.',
      warnings: [],
      confidence: 0.8,
      requiresHumanReview: true,
    }
    expect(laborAiSuggestionSchema.parse(suggestion).items).toHaveLength(1)
    expect(() => laborAiSuggestionSchema.parse({ ...suggestion, items: [] })).toThrow()
    expect(() => laborAiSuggestionSchema.parse({ ...suggestion, requiresHumanReview: false })).toThrow()
    expect(() => laborAiSuggestionSchema.parse({
      ...suggestion,
      items: [{ ...suggestion.items[0], partAmountMinor: -1 }],
    })).toThrow()
  })

  it('run DTO strict doğrulanır ve öneri null olabilir', () => {
    const run = laborAiRunSchema.parse({
      id: runId,
      caseId,
      status: 'budget_blocked',
      providerId: 'gemini-generate-content',
      providerVersion: 'gemini-labor/1.0.0',
      modelId: 'gemini-fixture',
      promptTemplateVersion: 'labor-ai-draft/1.0.0',
      outputSchemaVersion: 'labor-ai-suggestion/1.0.0',
      baseSheetVersion: 1,
      planHash: hash,
      version: 1,
      privacy,
      budget: { ...budget, allowed: false, reasonCode: 'AI_BUDGET_EXCEEDED' },
      suggestion: null,
      safeErrorCode: 'AI_BUDGET_EXCEEDED',
      createdAt: '2026-07-17T12:00:00.000Z',
      startedAt: null,
      completedAt: '2026-07-17T12:00:00.000Z',
    })
    expect(run.suggestion).toBeNull()
    expect(run.budget.reasonCode).toBe('AI_BUDGET_EXCEEDED')
  })
})
