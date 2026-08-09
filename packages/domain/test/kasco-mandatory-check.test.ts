import { describe, expect, it } from 'vitest'
import {
  KASCO_MANDATORY_CHECK_CODES,
  evaluateKascoMandatoryCheckGate,
  isValidResultForCheck,
  type KascoMandatoryCheckFact,
} from '../src/index.js'

const fact = (overrides: Partial<KascoMandatoryCheckFact> & { checkCode: KascoMandatoryCheckFact['checkCode'] }): KascoMandatoryCheckFact => ({
  confirmedResult: null,
  confirmedEvidenceDocumentId: null,
  confirmedEvidenceDocumentVersionId: null,
  confirmedAt: null,
  confirmedByUserId: null,
  aiSuggestedResult: null,
  aiSuggestedAt: null,
  evidenceDocumentCurrentVersionId: null,
  ...overrides,
})

const allSevenResolved = (): readonly KascoMandatoryCheckFact[] => KASCO_MANDATORY_CHECK_CODES.map((code) => fact({
  checkCode: code,
  confirmedResult: code === 'driver_registration_owner_match' || code === 'policyholder_registration_owner_match' ? 'same' : 'present',
  confirmedEvidenceDocumentVersionId: 'docv-1',
  confirmedByUserId: 'user-1',
  confirmedAt: '2026-08-09T10:00:00.000Z',
  evidenceDocumentCurrentVersionId: 'docv-1',
}))

describe('kasco mandatory check gate', () => {
  it('trafik dosyasında tamamen not_applicable döner, hiçbir zaman engellemez', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('traffic', [])
    expect(evaluation.applicable).toBe(false)
    expect(evaluation.incomplete).toBe(false)
    expect(evaluation.checks.every((item) => item.status === 'not_applicable')).toBe(true)
    expect(evaluation.checks).toHaveLength(7)
  })

  it('kasko dosyasında hiç kayıt yoksa 7 kontrol de missing ve gate incomplete olur', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', [])
    expect(evaluation.applicable).toBe(true)
    expect(evaluation.missingCount).toBe(7)
    expect(evaluation.incomplete).toBe(true)
  })

  it('same/different/unknown yalnız karşılaştırma kontrollerinde geçerlidir; present/absent/unclear yalnız varlık kontrollerinde', () => {
    expect(isValidResultForCheck('driver_registration_owner_match', 'same')).toBe(true)
    expect(isValidResultForCheck('driver_registration_owner_match', 'present')).toBe(false)
    expect(isValidResultForCheck('equivalent_parts_clause', 'present')).toBe(true)
    expect(isValidResultForCheck('equivalent_parts_clause', 'same')).toBe(false)
  })

  it('unclear/unknown sonucu kanıt olmadan bile control_required üretir (gate tamamlanmamış sayılır)', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', [
      fact({ checkCode: 'driver_registration_owner_match', confirmedResult: 'unknown', confirmedByUserId: 'u', confirmedAt: '2026-08-09T10:00:00.000Z' }),
    ])
    const item = evaluation.checks.find((check) => check.checkCode === 'driver_registration_owner_match')!
    expect(item.status).toBe('control_required')
    expect(item.requiresHumanReview).toBe(true)
    expect(evaluation.controlRequiredCount).toBe(1)
    expect(evaluation.incomplete).toBe(true)
  })

  it('kesin sonuç (same/different/present/absent) kanıt belge sürümü güncelken resolved sayılır', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', [
      fact({
        checkCode: 'equivalent_parts_clause', confirmedResult: 'present', confirmedEvidenceDocumentVersionId: 'v1',
        confirmedByUserId: 'u', confirmedAt: '2026-08-09T10:00:00.000Z', evidenceDocumentCurrentVersionId: 'v1',
      }),
    ])
    const item = evaluation.checks.find((check) => check.checkCode === 'equivalent_parts_clause')!
    expect(item.status).toBe('resolved')
    expect(item.requiresHumanReview).toBe(false)
    expect(evaluation.resolvedCount).toBe(1)
  })

  it('"different"/"absent" gibi negatif kesin bulgular da resolved sayılır -- control_required yalnız belirsizlik içindir', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', [
      fact({
        checkCode: 'driver_registration_owner_match', confirmedResult: 'different', confirmedEvidenceDocumentVersionId: 'v1',
        confirmedByUserId: 'u', confirmedAt: '2026-08-09T10:00:00.000Z', evidenceDocumentCurrentVersionId: 'v1',
      }),
    ])
    expect(evaluation.checks.find((check) => check.checkCode === 'driver_registration_owner_match')!.status).toBe('resolved')
  })

  it('kanıt belgesinin güncel sürümü, onaylandığı andaki sürümden farklıysa needs_review üretir (kaynak değişti)', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', [
      fact({
        checkCode: 'service_deductible_clause', confirmedResult: 'absent', confirmedEvidenceDocumentVersionId: 'v1',
        confirmedByUserId: 'u', confirmedAt: '2026-08-09T10:00:00.000Z', evidenceDocumentCurrentVersionId: 'v2',
      }),
    ])
    const item = evaluation.checks.find((check) => check.checkCode === 'service_deductible_clause')!
    expect(item.status).toBe('needs_review')
    expect(item.requiresHumanReview).toBe(true)
    expect(evaluation.needsReviewCount).toBe(1)
    expect(evaluation.incomplete).toBe(true)
  })

  it('7 kontrolün hepsi güncel kanıtla resolved ise gate tamamlanmış (incomplete=false) sayılır', () => {
    const evaluation = evaluateKascoMandatoryCheckGate('casco', allSevenResolved())
    expect(evaluation.resolvedCount).toBe(7)
    expect(evaluation.missingCount).toBe(0)
    expect(evaluation.controlRequiredCount).toBe(0)
    expect(evaluation.needsReviewCount).toBe(0)
    expect(evaluation.incomplete).toBe(false)
  })

  it('saf ve deterministiktir: aynı girdi aynı sonucu üretir', () => {
    const facts = allSevenResolved()
    expect(evaluateKascoMandatoryCheckGate('casco', facts)).toEqual(evaluateKascoMandatoryCheckGate('casco', facts))
  })
})
