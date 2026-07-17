import { describe, expect, it } from 'vitest'
import {
  EMAIL_AI_OUTPUT_SCHEMA_VERSION,
  buildEmailAiOutboundContext,
  buildEmailAiPlanHash,
  composeEmailAiSubject,
  validateEmailAiSuggestion,
} from '../src/index.js'

const base = {
  organizationId: '01910000-0000-7000-8000-000000000001',
  caseId: '01910000-0000-7000-8000-000000000002',
  caseVersion: 3,
  caseType: 'traffic' as const,
  draftType: 'missing_document_request' as const,
  previewHash: 'a'.repeat(64),
  baseBody: 'Merhaba,\n\nEksik evrakların iletilmesini rica ederiz.',
  instruction: 'Plaka 34 ABC 123 ve hasar dosya no: HSR-42 metne yazılmamalı.',
  sourceRule: 'document_requirements_snapshot',
  missingRequirementCodes: ['traffic_victim_policy'],
  controlRequiredRequirementCodes: ['accident_report'],
  providerId: 'gemini-generate-content' as const,
  providerVersion: 'gemini-generate-content/1.0.0',
  modelId: 'gemini-2.5-flash',
  externalProvider: true,
  retentionMode: 'free_tier_product_improvement' as const,
  pricingVersion: 'gemini-free-tier/2026-07-15',
}

describe('email AI domain', () => {
  it('harici provider bağlamını PII ile birlikte minimize eder ve deterministik hash üretir', () => {
    const first = buildEmailAiOutboundContext(base)
    const second = buildEmailAiOutboundContext(base)
    expect(first).toEqual(second)
    expect(first.context.instruction).toContain('[PII:PLATE_1]')
    expect(first.context.instruction).toContain('[PII:REFERENCE_NUMBER_1]')
    expect(first.redactedCategories).toEqual(['plate', 'reference_number'])
    expect(buildEmailAiPlanHash(base, first)).toBe(buildEmailAiPlanHash(base, second))
  })

  it('iki nokta kullanılmayan sigortalı adını da dış provider öncesi maskeler', () => {
    const outbound = buildEmailAiOutboundContext({
      ...base,
      instruction: 'Sigortalı Ayşe Yılmaz, ayse@example.test için bilgilendirme hazırla.',
    })
    expect(outbound.redactedCategories).toEqual(expect.arrayContaining(['name', 'email']))
    expect(outbound.context.instruction).not.toMatch(/Ayşe|Yılmaz|ayse@example/)
    expect(outbound.context.instruction).toMatch(/\[PII:NAME_1\].*\[PII:EMAIL_1\]/)
  })

  it('yerel provider için redaction/egress hash üretmez', () => {
    const result = buildEmailAiOutboundContext({
      ...base,
      providerId: 'deterministic-success',
      providerVersion: 'deterministic/1.0.0',
      modelId: 'local-email-fixture-v1',
      externalProvider: false,
      retentionMode: 'local_only',
      pricingVersion: 'deterministic-cost/1.0.0',
    })
    expect(result.outboundPayloadHash).toBeNull()
    expect(result.redactedValueCount).toBe(0)
    expect(result.context.instruction).toContain('34 ABC 123')
  })

  it('strict ve güvenli suggestion kabul eder', () => {
    const result = validateEmailAiSuggestion({
      schemaVersion: EMAIL_AI_OUTPUT_SCHEMA_VERSION,
      subjectSuffix: 'Eksik Evrak Hatırlatması',
      body: 'Merhaba,\n\nEksik evrakların iletilmesini rica ederiz.\n\nİyi çalışmalar.',
      reasoning: 'Kısa ve eylem odaklı dil kullanıldı.',
      warnings: ['Alıcı kullanıcı tarafından doğrulanmalıdır.'],
      confidence: 0.84,
      requiresHumanReview: true,
    })
    expect(result.allowed).toBe(true)
  })

  it('provider kaynaklı PII, placeholder, URL ve path çıktısını fail-closed reddeder', () => {
    const valid = {
      schemaVersion: EMAIL_AI_OUTPUT_SCHEMA_VERSION,
      subjectSuffix: 'Bilgilendirme',
      reasoning: 'Kontrollü taslak.',
      warnings: ['İnsan kontrolü gerekir.'],
      confidence: 0.5,
      requiresHumanReview: true,
    } as const
    expect(validateEmailAiSuggestion({ ...valid, body: 'Plaka 34 ABC 123 için.' })).toMatchObject({ allowed: false, code: 'AI_OUTPUT_PII_UNSAFE' })
    expect(validateEmailAiSuggestion({ ...valid, body: '[PII:PLATE_1]' })).toMatchObject({ allowed: false, code: 'AI_OUTPUT_PLACEHOLDER_UNSAFE' })
    expect(validateEmailAiSuggestion({ ...valid, body: 'https://example.test açın.' })).toMatchObject({ allowed: false, code: 'AI_OUTPUT_EXTERNAL_REFERENCE_UNSAFE' })
    expect(validateEmailAiSuggestion({ ...valid, body: 'C:\\sentetik\\dosya.pdf' })).toMatchObject({ allowed: false, code: 'AI_OUTPUT_PATH_UNSAFE' })
  })

  it('subject kimliğini yalnız server tarafında birleştirir', () => {
    expect(composeEmailAiSubject('2026/4101', '34 P 4101', 'Eksik Evrak')).toBe(
      '2026/4101 · 34 P 4101 · Eksik Evrak',
    )
  })
})
