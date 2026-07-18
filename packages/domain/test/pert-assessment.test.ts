import { describe, expect, it } from 'vitest'
import {
  MAX_PERT_AMOUNT_MINOR,
  PERT_ASSESSMENT_SCHEMA_VERSION,
  computePertDamageRatioPercent,
  validatePertAssessment,
  type PertAssessmentInput,
} from '../src/index.js'

const base = (over: Partial<PertAssessmentInput> = {}): PertAssessmentInput => ({
  workflowStatus: 'under_review',
  estimatedDamageMinor: 4_800_000_00,
  marketValueMinor: 6_250_000_00,
  structuralNote: 'Ön panel ölçümü bekleniyor.',
  expertOpinion: null,
  expertRationale: null,
  centerDecision: null,
  centerNote: null,
  ...over,
})

describe('pert sabitleri ve oran', () => {
  it('şema sürümü kararlıdır', () => {
    expect(PERT_ASSESSMENT_SCHEMA_VERSION).toBe('pert-assessment/1.0.0')
  })

  it('oran yalnız iki pozitif değerle türetilir ve tam sayı yüzdeye yuvarlanır', () => {
    expect(computePertDamageRatioPercent(4_800_000_00, 6_250_000_00)).toBe(77)
    expect(computePertDamageRatioPercent(null, 6_250_000_00)).toBeNull()
    expect(computePertDamageRatioPercent(4_800_000_00, null)).toBeNull()
    expect(computePertDamageRatioPercent(0, 6_250_000_00)).toBeNull()
    expect(computePertDamageRatioPercent(4_800_000_00, 0)).toBeNull()
    expect(computePertDamageRatioPercent(MAX_PERT_AMOUNT_MINOR + 1, 100)).toBeNull()
  })
})

describe('validatePertAssessment', () => {
  it('inceleme durumunu kanaatsız kabul eder ve notları normalize eder', () => {
    const result = validatePertAssessment(base({ structuralNote: '  Ölçüm bekleniyor.  ' }))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.assessment.structuralNote).toBe('Ölçüm bekleniyor.')
    expect(result.assessment.expertOpinion).toBeNull()
  })

  it('geçersiz tutar ve kontrol karakterli notu reddeder', () => {
    expect(validatePertAssessment(base({ estimatedDamageMinor: -1 }))).toEqual({ valid: false, reasonCode: 'invalid_amount' })
    expect(validatePertAssessment(base({ marketValueMinor: 1.5 }))).toEqual({ valid: false, reasonCode: 'invalid_amount' })
    expect(validatePertAssessment(base({ structuralNote: 'kötünot' }))).toEqual({ valid: false, reasonCode: 'invalid_note' })
    expect(validatePertAssessment(base({ structuralNote: 'a'.repeat(501) }))).toEqual({ valid: false, reasonCode: 'invalid_note' })
  })

  it('kanaat gerekçesiz kaydedilemez; kanaat-sonrası durum kanaatsız olamaz', () => {
    expect(validatePertAssessment(base({
      workflowStatus: 'expert_opinion_issued',
      expertOpinion: 'pert',
      expertRationale: null,
    }))).toEqual({ valid: false, reasonCode: 'expert_rationale_required' })
    expect(validatePertAssessment(base({ workflowStatus: 'expert_opinion_issued' })))
      .toEqual({ valid: false, reasonCode: 'expert_opinion_required' })
    expect(validatePertAssessment(base({
      expertOpinion: 'repair',
      expertRationale: 'Onarım ekonomik olarak uygundur.',
    }))).toEqual({ valid: false, reasonCode: 'expert_opinion_forbidden' })
  })

  it('merkez kararı kanaatten ayrıdır ve yalnız karar durumlarıyla birebir eşleşir', () => {
    const withOpinion = base({
      workflowStatus: 'center_decision_pending',
      expertOpinion: 'pert',
      expertRationale: 'Hasar/rayiç oranı yüksek; yapısal hasar mevcut.',
    })
    expect(validatePertAssessment(withOpinion).valid).toBe(true)

    expect(validatePertAssessment({ ...withOpinion, workflowStatus: 'pert_decided' }))
      .toEqual({ valid: false, reasonCode: 'center_decision_required' })
    expect(validatePertAssessment({ ...withOpinion, centerDecision: 'pert' }))
      .toEqual({ valid: false, reasonCode: 'center_decision_forbidden' })
    expect(validatePertAssessment({
      ...withOpinion,
      workflowStatus: 'repair_decided',
      centerDecision: 'pert',
    })).toEqual({ valid: false, reasonCode: 'center_decision_mismatch' })

    const decided = validatePertAssessment({
      ...withOpinion,
      workflowStatus: 'pert_decided',
      centerDecision: 'pert',
      centerNote: 'Merkez PERT kararını iletti.',
    })
    expect(decided.valid).toBe(true)
  })
})
