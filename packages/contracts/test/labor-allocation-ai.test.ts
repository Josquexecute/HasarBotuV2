import { describe, expect, it } from 'vitest'
import {
  CASE_LABOR_ALLOCATION_ANALYZE_ROUTE,
  CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE,
  CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE,
  laborAllocationAnalyzeRequestSchema,
  laborAllocationApplyPreviewRequestSchema,
  laborAllocationApplyPreviewResponseSchema,
  laborAllocationSuggestionSchema,
} from '../src/index.js'

const CASE_ID = '11111111-1111-4111-8111-111111111111'

function economic(repairLabor = 8_000_00, removeInstall = 2_000_00) {
  return {
    buckets: {
      repair_labor: repairLabor,
      new_part_or_ownership: 0,
      remove_install: removeInstall,
      paint_and_consumable: 0,
      calibration: 0,
      related_operations: 0,
    },
    repairTotalMinor: repairLabor + removeInstall,
    replaceTotalMinor: removeInstall,
    note: 'Onarım toplamı daha düşük.',
  }
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    lineOrdinal: 1,
    sourceDescription: 'Ön tampon',
    sourceAction: 'Onarım + boya',
    sourcePartAmountMinor: 0,
    sourceLaborAmountMinor: 10_000_00,
    allocations: [
      { operationType: 'repair', amountMinor: 8_000_00 },
      { operationType: 'remove_install', amountMinor: 2_000_00 },
    ],
    repairReplaceOpinion: 'repair_indicated',
    economicComparison: economic(),
    reasoning: 'Kalem tarifi onarım içeriyor.',
    evidenceRefs: ['line-1-description'],
    confidence: 0.82,
    conflictCodes: [],
    missingEvidenceCodes: ['EVIDENCE_MISSING_PART_CODE'],
    controlRequired: true,
    // Paket 57: baseline eşleşmediğinde null; sağlayıcı bu alanı üretmez.
    baseline: null,
    categoryAllocation: null,
    ...overrides,
  }
}

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'labor-allocation-suggestion/2.0.0',
    operationTypesVersion: 'labor-operation-types/1.0.0',
    ruleVersion: 'labor-allocation-rules/1.0.0',
    lines: [line()],
    requiresHumanReview: true,
    ...overrides,
  }
}

describe('labor allocation rotaları', () => {
  it('yeni endpoint açmaz; dosya altında konumlanır', () => {
    expect(CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE).toBe('/api/v1/cases/:caseId/labor-allocation-ai')
    expect(CASE_LABOR_ALLOCATION_ANALYZE_ROUTE).toBe('/api/v1/cases/:caseId/labor-allocation-ai/analyze')
    expect(CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE)
      .toBe('/api/v1/cases/:caseId/labor-allocation-ai/:runId/apply-preview')
  })
})

describe('analiz isteği', () => {
  it('kaynak föy sürümü, tarif ve egress onayı zorunludur', () => {
    expect(laborAllocationAnalyzeRequestSchema.parse({
      expectedSheetVersion: 3,
      damageDescription: 'Ön sol darbe.',
      confirmedEgress: true,
    })).toEqual({ expectedSheetVersion: 3, damageDescription: 'Ön sol darbe.', confirmedEgress: true })

    for (const payload of [
      { damageDescription: 'x', confirmedEgress: true },
      { expectedSheetVersion: 1, confirmedEgress: true },
      { expectedSheetVersion: 1, damageDescription: 'x' },
      { expectedSheetVersion: 0, damageDescription: 'x', confirmedEgress: true },
      { expectedSheetVersion: 1, damageDescription: '', confirmedEgress: true },
      { expectedSheetVersion: 1, damageDescription: 'x', confirmedEgress: true, extra: 'y' },
    ]) {
      expect(() => laborAllocationAnalyzeRequestSchema.parse(payload)).toThrow()
    }
  })
})

describe('öneri şeması', () => {
  it('taksonomi, prompt ve şema sürümleri zorunlu alandır', () => {
    expect(laborAllocationSuggestionSchema.parse(suggestion()).operationTypesVersion)
      .toBe('labor-operation-types/1.0.0')
    for (const key of ['schemaVersion', 'operationTypesVersion', 'ruleVersion']) {
      const payload = suggestion()
      delete (payload as Record<string, unknown>)[key]
      expect(() => laborAllocationSuggestionSchema.parse(payload)).toThrow()
    }
  })

  it('yanlış sürüm etiketi reddedilir', () => {
    expect(() => laborAllocationSuggestionSchema.parse(
      suggestion({ operationTypesVersion: 'labor-operation-types/9.9.9' }),
    )).toThrow()
    expect(() => laborAllocationSuggestionSchema.parse(
      suggestion({ ruleVersion: 'labor-allocation-rules/9.9.9' }),
    )).toThrow()
  })

  it('bilinmeyen operasyon türü, çelişki kodu ve fazla alan reddedilir', () => {
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      lines: [line({ allocations: [{ operationType: 'welding', amountMinor: 10_000_00 }] })],
    }))).toThrow()
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      lines: [line({ conflictCodes: ['CONFLICT_UNKNOWN'] })],
    }))).toThrow()
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      lines: [line({ extra: 'x' })],
    }))).toThrow()
  })

  it('güven puanı 0..1 aralığındadır ve insan incelemesi sabittir', () => {
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      lines: [line({ confidence: 1.2 })],
    }))).toThrow()
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      requiresHumanReview: false,
    }))).toThrow()
  })

  it('ekonomik kova kümesi eksiksiz olmalıdır', () => {
    const partial = economic()
    delete (partial.buckets as Record<string, unknown>).calibration
    expect(() => laborAllocationSuggestionSchema.parse(suggestion({
      lines: [line({ economicComparison: partial })],
    }))).toThrow()
  })
})

describe('apply-preview sözleşmesi', () => {
  it('seçili satırlar tekil olmalıdır', () => {
    expect(laborAllocationApplyPreviewRequestSchema.parse({
      expectedSheetVersion: 2,
      selectedLineOrdinals: [1, 3],
    }).selectedLineOrdinals).toEqual([1, 3])
    expect(() => laborAllocationApplyPreviewRequestSchema.parse({
      expectedSheetVersion: 2,
      selectedLineOrdinals: [1, 1],
    })).toThrow()
    expect(() => laborAllocationApplyPreviewRequestSchema.parse({
      expectedSheetVersion: 2,
      selectedLineOrdinals: [],
    })).toThrow()
  })

  it('önizleme yanıtı föyün uygulanmadığını sabitler', () => {
    const response = {
      runId: 'run-1',
      caseId: CASE_ID,
      sourceSheetId: 'sheet-1',
      sourceSheetVersion: 2,
      operationTypesVersion: 'labor-operation-types/1.0.0',
      outputSchemaVersion: 'labor-allocation-suggestion/2.0.0',
      lines: [{
        lineOrdinal: 1,
        description: 'Ön tampon',
        action: 'Onarım + boya',
        partAmountMinor: 0,
        laborAmountMinor: 10_000_00,
        allocations: [{ operationType: 'repair', amountMinor: 10_000_00 }],
        controlRequired: false,
      }],
      selectedCount: 1,
      controlRequiredCount: 0,
      applied: false,
      requiresHumanReview: true,
    }
    expect(laborAllocationApplyPreviewResponseSchema.parse(response).applied).toBe(false)
    // `applied: true` sözleşme seviyesinde imkânsızdır.
    expect(() => laborAllocationApplyPreviewResponseSchema.parse({ ...response, applied: true }))
      .toThrow()
  })
})
