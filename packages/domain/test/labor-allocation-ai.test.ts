import { describe, expect, it } from 'vitest'
import {
  LABOR_ALLOCATION_CONTROL_CONFIDENCE_THRESHOLD,
  LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION,
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ALLOCATION_PRIVACY_POLICY_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  buildLaborAllocationEvidenceHash,
  buildLaborAllocationOutboundContext,
  buildLaborAllocationPlanHash,
  computeEconomicTotals,
  detectMissingEvidence,
  selectableLineOrdinals,
  validateLaborAllocationSuggestion,
  type LaborAllocationLineSuggestion,
  type LaborAllocationPlanContext,
  type LaborEconomicBucket,
} from '../src/labor-allocation-ai.js'
import type { NormalizedLaborItem } from '../src/labor-sheet.js'

const SHEET_LINES: readonly NormalizedLaborItem[] = [
  { description: 'Ön tampon', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 10_000_00 },
  { description: 'Sol ön çamurluk', action: 'Değişim', partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00 },
]

function planContext(overrides: Partial<LaborAllocationPlanContext> = {}): LaborAllocationPlanContext {
  return {
    organizationId: 'org-1',
    caseId: 'case-1',
    caseVersion: 1,
    caseType: 'traffic',
    sheetId: 'sheet-1',
    sheetVersion: 1,
    damageDescription: 'Ön sol bölgede darbe.',
    lines: SHEET_LINES,
    dictionary: [],
    approvedHistory: [],
    expertBaseline: null,
    providerId: 'deterministic-success',
    providerVersion: '1.0.0',
    modelId: 'deterministic',
    externalProvider: false,
    retentionMode: 'local_only',
    pricingVersion: 'pricing/1.0.0',
    ...overrides,
  }
}

function buckets(overrides: Partial<Record<LaborEconomicBucket, number>> = {}) {
  return {
    repair_labor: 0,
    new_part_or_ownership: 0,
    remove_install: 0,
    paint_and_consumable: 0,
    calibration: 0,
    related_operations: 0,
    ...overrides,
  }
}

function line(overrides: Partial<LaborAllocationLineSuggestion> = {}): LaborAllocationLineSuggestion {
  const bucketValues = buckets({ repair_labor: 8_000_00, remove_install: 2_000_00 })
  const totals = computeEconomicTotals(bucketValues)
  return {
    lineOrdinal: 1,
    allocations: [
      { operationType: 'repair', amountMinor: 8_000_00 },
      { operationType: 'remove_install', amountMinor: 2_000_00 },
    ],
    repairReplaceOpinion: 'repair_indicated',
    economicComparison: { buckets: bucketValues, ...totals, note: 'Onarım toplamı daha düşük.' },
    reasoning: 'Kalem tarifi onarım ve boya içeriyor.',
    evidenceRefs: ['line-1-description', 'line-1-action'],
    confidence: 0.8,
    conflictCodes: [],
    missingEvidenceCodes: [],
    controlRequired: false,
    ...overrides,
  }
}

function secondLine(overrides: Partial<LaborAllocationLineSuggestion> = {}): LaborAllocationLineSuggestion {
  const bucketValues = buckets({ new_part_or_ownership: 18_000_00, remove_install: 2_000_00 })
  const totals = computeEconomicTotals(bucketValues)
  return line({
    lineOrdinal: 2,
    allocations: [
      { operationType: 'replace', amountMinor: 18_000_00 },
      { operationType: 'remove_install', amountMinor: 2_000_00 },
    ],
    repairReplaceOpinion: 'replace_indicated',
    economicComparison: { buckets: bucketValues, ...totals, note: 'Parça bedeli baskın.' },
    ...overrides,
  })
}

function suggestion(lines: readonly LaborAllocationLineSuggestion[] = [line(), secondLine()]) {
  return {
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    lines,
    requiresHumanReview: true as const,
  }
}

describe('taksonomi', () => {
  it('kanonik operasyon türleri ve ekonomik kovalar ayrı yapılardır', () => {
    expect(LABOR_OPERATION_TYPES).toEqual([
      'repair', 'replace', 'remove_install', 'paint', 'consumable',
      'calibration', 'related_operation', 'other',
    ])
    expect(LABOR_ECONOMIC_BUCKETS).toEqual([
      'repair_labor', 'new_part_or_ownership', 'remove_install',
      'paint_and_consumable', 'calibration', 'related_operations',
    ])
    expect(LABOR_OPERATION_TYPES_VERSION).toBe('labor-operation-types/1.0.0')
  })

  it('onarım ve değişim toplamları ortak kovaları paylaşır', () => {
    const values = buckets({
      repair_labor: 5_000_00,
      new_part_or_ownership: 12_000_00,
      remove_install: 1_000_00,
      paint_and_consumable: 2_000_00,
      calibration: 500_00,
      related_operations: 250_00,
    })
    // Tek başına parça bedeline bakılmaz; ortak operasyonlar iki tarafta da vardır.
    expect(computeEconomicTotals(values)).toEqual({
      repairTotalMinor: 5_000_00 + 1_000_00 + 2_000_00 + 500_00 + 250_00,
      replaceTotalMinor: 12_000_00 + 1_000_00 + 2_000_00 + 500_00 + 250_00,
    })
  })
})

describe('detectMissingEvidence', () => {
  it('şemada bulunmayan kanıt kanallarını işaretler', () => {
    const codes = detectMissingEvidence(planContext())
    expect(codes).toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
    expect(codes).toContain('EVIDENCE_MISSING_PART_CODE')
    expect(codes).toContain('EVIDENCE_MISSING_DAMAGE_REGION')
    expect(codes).toContain('EVIDENCE_MISSING_APPROVED_HISTORY')
    expect(codes).toContain('EVIDENCE_MISSING_DICTIONARY_MATCH')
    expect(codes).toContain('EVIDENCE_MISSING_EXPERT_BASELINE')
  })

  it('kanıt sağlandığında ilgili kod düşer', () => {
    const codes = detectMissingEvidence(planContext({
      dictionary: [{ description: 'Ön tampon', action: 'Onarım', usageCount: 3 }],
      approvedHistory: [{ description: 'Ön tampon', action: 'Onarım', operationTypes: ['repair'] }],
      expertBaseline: { sheetVersion: 1, lines: [] },
    }))
    expect(codes).not.toContain('EVIDENCE_MISSING_DICTIONARY_MATCH')
    expect(codes).not.toContain('EVIDENCE_MISSING_APPROVED_HISTORY')
    expect(codes).not.toContain('EVIDENCE_MISSING_EXPERT_BASELINE')
    // Şema kaynaklı eksikler her zaman kalır.
    expect(codes).toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
  })
})

describe('buildLaborAllocationOutboundContext', () => {
  it('yerel sağlayıcıda hash üretmez ve metni kısaltmaz', () => {
    const outbound = buildLaborAllocationOutboundContext(planContext())
    expect(outbound.privacyPolicyVersion).toBe(LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION)
    expect(outbound.outboundPayloadHash).toBeNull()
    expect(outbound.context.damageDescription).toBe('Ön sol bölgede darbe.')
    expect(outbound.context.allowedOperationTypes).toEqual(LABOR_OPERATION_TYPES)
  })

  it('dış sağlayıcıda PII minimize eder ve hash üretir', () => {
    const outbound = buildLaborAllocationOutboundContext(planContext({
      externalProvider: true,
      damageDescription: 'Sürücü Ahmet Yılmaz, 34 MPA 764 plakalı araç.',
    }))
    expect(outbound.privacyPolicyVersion).toBe(LABOR_ALLOCATION_PRIVACY_POLICY_VERSION)
    expect(outbound.outboundPayloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(outbound.redactedValueCount).toBeGreaterThan(0)
    expect(JSON.stringify(outbound.context)).not.toContain('34 MPA 764')
  })

  it('vaka kimliği dış bağlama girmez', () => {
    const outbound = buildLaborAllocationOutboundContext(planContext({ externalProvider: true }))
    const serialized = JSON.stringify(outbound.context)
    expect(serialized).not.toContain('case-1')
    expect(serialized).not.toContain('org-1')
    expect(serialized).not.toContain('sheet-1')
  })
})

describe('plan ve kanıt hash', () => {
  it('aynı girdi için kararlıdır', () => {
    const context = planContext()
    const outbound = buildLaborAllocationOutboundContext(context)
    expect(buildLaborAllocationPlanHash(context, outbound))
      .toBe(buildLaborAllocationPlanHash(context, outbound))
    expect(buildLaborAllocationEvidenceHash(context)).toBe(buildLaborAllocationEvidenceHash(context))
  })

  it('kaynak föy değişince kanıt hash değişir', () => {
    const before = buildLaborAllocationEvidenceHash(planContext())
    const after = buildLaborAllocationEvidenceHash(planContext({
      lines: [{ ...SHEET_LINES[0], laborAmountMinor: 11_000_00 }, SHEET_LINES[1]],
    }))
    expect(after).not.toBe(before)
  })

  it('föy sürümü değişince kanıt hash değişir', () => {
    expect(buildLaborAllocationEvidenceHash(planContext({ sheetVersion: 2 })))
      .not.toBe(buildLaborAllocationEvidenceHash(planContext()))
  })
})

describe('validateLaborAllocationSuggestion', () => {
  it('geçerli öneriyi kabul eder', () => {
    const result = validateLaborAllocationSuggestion(suggestion(), SHEET_LINES)
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.suggestion.lines).toHaveLength(2)
    expect(result.suggestion.lines[0].allocations).toHaveLength(2)
  })

  it('her satır tam olarak bir kez kapsanmalıdır', () => {
    expect(validateLaborAllocationSuggestion(suggestion([line()]), SHEET_LINES))
      .toMatchObject({ allowed: false, code: 'AI_OUTPUT_LINE_COVERAGE_INVALID' })
    expect(validateLaborAllocationSuggestion(
      suggestion([line(), line({ lineOrdinal: 1 })]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_LINE_COVERAGE_INVALID' })
    expect(validateLaborAllocationSuggestion(
      suggestion([line(), secondLine({ lineOrdinal: 9 })]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_LINE_COVERAGE_INVALID' })
  })

  it('tahsis toplamı satır toplamına eşit olmalıdır', () => {
    const wrong = line({
      allocations: [{ operationType: 'repair', amountMinor: 9_999_00 }],
    })
    expect(validateLaborAllocationSuggestion(suggestion([wrong, secondLine()]), SHEET_LINES))
      .toMatchObject({ allowed: false, code: 'AI_OUTPUT_ALLOCATION_SUM_INVALID' })
  })

  it('aynı operasyon türü bir satırda tekrarlanamaz', () => {
    const duplicated = line({
      allocations: [
        { operationType: 'repair', amountMinor: 5_000_00 },
        { operationType: 'repair', amountMinor: 5_000_00 },
      ],
    })
    expect(validateLaborAllocationSuggestion(suggestion([duplicated, secondLine()]), SHEET_LINES))
      .toMatchObject({ allowed: false, code: 'AI_OUTPUT_ALLOCATION_INVALID' })
  })

  it('ekonomik toplamlar kovalardan hesaplanan değerle eşleşmelidir', () => {
    const bucketValues = buckets({ repair_labor: 8_000_00, remove_install: 2_000_00 })
    const tampered = line({
      economicComparison: {
        buckets: bucketValues,
        repairTotalMinor: 1,
        replaceTotalMinor: 2,
        note: 'Uydurma toplam.',
      },
    })
    expect(validateLaborAllocationSuggestion(suggestion([tampered, secondLine()]), SHEET_LINES))
      .toMatchObject({ allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' })
  })

  it('bilinmeyen operasyon türü ve fazla alan reddedilir', () => {
    expect(validateLaborAllocationSuggestion(
      suggestion([{ ...line(), allocations: [{ operationType: 'welding', amountMinor: 10_000_00 }] } as never, secondLine()]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' })
    expect(validateLaborAllocationSuggestion(
      { ...suggestion(), extra: 'x' },
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' })
  })

  it('yanlış şema veya taksonomi sürümü reddedilir', () => {
    expect(validateLaborAllocationSuggestion(
      { ...suggestion(), schemaVersion: 'labor-allocation-suggestion/9.9.9' },
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' })
    expect(validateLaborAllocationSuggestion(
      { ...suggestion(), operationTypesVersion: 'labor-operation-types/9.9.9' },
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' })
  })

  it('PII, URL ve dosya yolu içeren çıktı reddedilir', () => {
    expect(validateLaborAllocationSuggestion(
      suggestion([line({ reasoning: 'Kaynak: https://example.com/parca' }), secondLine()]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_EXTERNAL_REFERENCE_UNSAFE' })
    expect(validateLaborAllocationSuggestion(
      suggestion([line({ reasoning: 'Bkz C:\\parca\\liste.xlsx' }), secondLine()]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_PATH_UNSAFE' })
    expect(validateLaborAllocationSuggestion(
      suggestion([line({ reasoning: 'Yer tutucu [PII:NAME_1] kaldı.' }), secondLine()]),
      SHEET_LINES,
    )).toMatchObject({ allowed: false, code: 'AI_OUTPUT_PLACEHOLDER_UNSAFE' })
  })
})

describe('controlRequired sunucuda yeniden hesaplanır', () => {
  it('other operasyon türü kontrolü zorunlu kılar', () => {
    const withOther = line({
      allocations: [
        { operationType: 'other', amountMinor: 4_000_00 },
        { operationType: 'repair', amountMinor: 6_000_00 },
      ],
      controlRequired: false,
    })
    const result = validateLaborAllocationSuggestion(suggestion([withOther, secondLine()]), SHEET_LINES)
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.suggestion.lines[0].controlRequired).toBe(true)
  })

  it('eksik kanıt, çelişki ve düşük güven kontrolü zorunlu kılar', () => {
    const cases: LaborAllocationLineSuggestion[] = [
      line({ missingEvidenceCodes: ['EVIDENCE_MISSING_PART_CODE'], controlRequired: false }),
      line({ conflictCodes: ['CONFLICT_ACTION_VS_OPERATION'], controlRequired: false }),
      line({ confidence: LABOR_ALLOCATION_CONTROL_CONFIDENCE_THRESHOLD - 0.01, controlRequired: false }),
      line({ repairReplaceOpinion: 'insufficient_evidence', controlRequired: false }),
    ]
    for (const candidate of cases) {
      const result = validateLaborAllocationSuggestion(suggestion([candidate, secondLine()]), SHEET_LINES)
      expect(result.allowed).toBe(true)
      if (!result.allowed) continue
      expect(result.suggestion.lines[0].controlRequired).toBe(true)
    }
  })

  it('plan seviyesindeki eksik kanıt kodları her satıra taşınır', () => {
    const result = validateLaborAllocationSuggestion(
      suggestion(),
      SHEET_LINES,
      ['EVIDENCE_MISSING_VEHICLE_IDENTITY'],
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    for (const suggestionLine of result.suggestion.lines) {
      expect(suggestionLine.missingEvidenceCodes).toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
      expect(suggestionLine.controlRequired).toBe(true)
    }
  })
})

describe('selectableLineOrdinals', () => {
  it('kontrol gerekli satırları hariç tutar', () => {
    const result = validateLaborAllocationSuggestion(
      suggestion([line(), secondLine({ conflictCodes: ['CONFLICT_ECONOMIC_INCONCLUSIVE'] })]),
      SHEET_LINES,
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(selectableLineOrdinals(result.suggestion)).toEqual([1])
  })

  it('tüm satırlar kontrol gerektiriyorsa boş döner', () => {
    const result = validateLaborAllocationSuggestion(
      suggestion(),
      SHEET_LINES,
      ['EVIDENCE_MISSING_VEHICLE_IDENTITY'],
    )
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(selectableLineOrdinals(result.suggestion)).toEqual([])
  })
})
