/**
 * Paket 45 — kullanıcı kontrollü PERT / Ağır Hasar değerlendirme çekirdeği.
 *
 * Saf ve deterministik doğrulama katmanı. AI önerisi, eksper kanaati ve merkez
 * kararı birbirinden ayrıdır (DOMAIN_RULES/PERT); bu dilim AI içermez. Eşik
 * veya otomatik sonuç sabit kodlanmaz: oran yalnız türetilmiş bilgidir, karar
 * alanları insan girdisidir ve hiçbir sonuç açık onay olmadan kesinleşmez.
 */
export const PERT_ASSESSMENT_SCHEMA_VERSION = 'pert-assessment/1.0.0' as const
export const PERT_ASSESSMENT_CURRENCY = 'TRY' as const

export const PERT_WORKFLOW_STATUSES = [
  'review_not_started',
  'data_missing',
  'under_review',
  'repair_indicated',
  'pert_candidate',
  'expert_opinion_issued',
  'center_decision_pending',
  'repair_decided',
  'pert_decided',
] as const
export type PertWorkflowStatus = (typeof PERT_WORKFLOW_STATUSES)[number]

export const PERT_EXPERT_OPINIONS = ['repair', 'pert'] as const
export type PertExpertOpinion = (typeof PERT_EXPERT_OPINIONS)[number]

export const PERT_CENTER_DECISIONS = ['repair', 'pert'] as const
export type PertCenterDecision = (typeof PERT_CENTER_DECISIONS)[number]

export const PERT_SOURCE_TYPES = ['user_entered', 'manual_revision'] as const
export type PertSourceType = (typeof PERT_SOURCE_TYPES)[number]

/** Alan başına üst sınır: ₺100.000.000 (kuruş). İş kuralı değil, taşma/abuse sınırıdır. */
export const MAX_PERT_AMOUNT_MINOR = 100_000_000_00
export const MAX_PERT_NOTE_LENGTH = 500
export const MAX_PERT_REVISION_REASON_LENGTH = 500

export interface PertAssessmentInput {
  readonly workflowStatus: PertWorkflowStatus
  readonly estimatedDamageMinor: number | null
  readonly marketValueMinor: number | null
  readonly structuralNote: string | null
  readonly expertOpinion: PertExpertOpinion | null
  readonly expertRationale: string | null
  readonly centerDecision: PertCenterDecision | null
  readonly centerNote: string | null
}

export interface NormalizedPertAssessment extends PertAssessmentInput {
  readonly structuralNote: string | null
  readonly expertRationale: string | null
  readonly centerNote: string | null
}

export type PertAssessmentInvalidReason =
  | 'invalid_status'
  | 'invalid_amount'
  | 'invalid_note'
  | 'expert_rationale_required'
  | 'expert_opinion_required'
  | 'expert_opinion_forbidden'
  | 'center_decision_required'
  | 'center_decision_forbidden'
  | 'center_decision_mismatch'

export type PertAssessmentValidation =
  | { readonly valid: true; readonly assessment: NormalizedPertAssessment }
  | { readonly valid: false; readonly reasonCode: PertAssessmentInvalidReason }

/** Kanaat girilmeden önce izinli süreç durumları. */
const PRE_OPINION_STATUSES: readonly PertWorkflowStatus[] = [
  'review_not_started',
  'data_missing',
  'under_review',
  'repair_indicated',
  'pert_candidate',
]

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

function normalizeNote(value: string | null, maxLength: number): string | null | undefined {
  if (value === null) return null
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (normalized.length > maxLength || hasControlCharacter(normalized)) return undefined
  return normalized
}

export function isValidPertAmountMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PERT_AMOUNT_MINOR
}

/**
 * Türetilmiş hasar/rayiç oranı (tam sayı yüzde, yarım yukarı yuvarlanır).
 * Her iki değer de pozitif değilse oran üretilmez; eşik veya otomatik karar yoktur.
 */
export function computePertDamageRatioPercent(
  estimatedDamageMinor: number | null,
  marketValueMinor: number | null,
): number | null {
  if (estimatedDamageMinor === null || marketValueMinor === null) return null
  if (!isValidPertAmountMinor(estimatedDamageMinor) || !isValidPertAmountMinor(marketValueMinor)) return null
  if (estimatedDamageMinor === 0 || marketValueMinor === 0) return null
  return Math.round((estimatedDamageMinor * 100) / marketValueMinor)
}

/**
 * PERT değerlendirmesini doğrular ve normalize eder. Yapısal tutarlılık
 * kuralları DOMAIN_RULES durum adlarından türetilir:
 * - Kanaat (`expertOpinion` + zorunlu gerekçe) yalnız kanaat-sonrası
 *   durumlarla; kanaat yokken yalnız inceleme durumlarıyla kaydedilebilir.
 * - Merkez kararı kanaatten ayrıdır; yalnız karar durumlarında bulunur ve
 *   durumla (onarım/pert) birebir eşleşmek zorundadır.
 */
export function validatePertAssessment(input: PertAssessmentInput): PertAssessmentValidation {
  if (!PERT_WORKFLOW_STATUSES.includes(input.workflowStatus)) {
    return { valid: false, reasonCode: 'invalid_status' }
  }
  for (const amount of [input.estimatedDamageMinor, input.marketValueMinor]) {
    if (amount !== null && !isValidPertAmountMinor(amount)) {
      return { valid: false, reasonCode: 'invalid_amount' }
    }
  }
  const structuralNote = normalizeNote(input.structuralNote, MAX_PERT_NOTE_LENGTH)
  const expertRationale = normalizeNote(input.expertRationale, MAX_PERT_NOTE_LENGTH)
  const centerNote = normalizeNote(input.centerNote, MAX_PERT_NOTE_LENGTH)
  if (structuralNote === undefined || expertRationale === undefined || centerNote === undefined) {
    return { valid: false, reasonCode: 'invalid_note' }
  }

  const hasOpinion = input.expertOpinion !== null
  if (hasOpinion && expertRationale === null) {
    return { valid: false, reasonCode: 'expert_rationale_required' }
  }
  if (!hasOpinion && !PRE_OPINION_STATUSES.includes(input.workflowStatus)) {
    return { valid: false, reasonCode: 'expert_opinion_required' }
  }
  if (hasOpinion && PRE_OPINION_STATUSES.includes(input.workflowStatus)) {
    return { valid: false, reasonCode: 'expert_opinion_forbidden' }
  }

  const hasCenterDecision = input.centerDecision !== null
  const decisionStatus = input.workflowStatus === 'repair_decided' || input.workflowStatus === 'pert_decided'
  if (decisionStatus && !hasCenterDecision) {
    return { valid: false, reasonCode: 'center_decision_required' }
  }
  if (hasCenterDecision && !decisionStatus) {
    return { valid: false, reasonCode: 'center_decision_forbidden' }
  }
  if (
    (input.workflowStatus === 'repair_decided' && input.centerDecision !== 'repair')
    || (input.workflowStatus === 'pert_decided' && input.centerDecision !== 'pert')
  ) {
    return { valid: false, reasonCode: 'center_decision_mismatch' }
  }

  return {
    valid: true,
    assessment: {
      workflowStatus: input.workflowStatus,
      estimatedDamageMinor: input.estimatedDamageMinor,
      marketValueMinor: input.marketValueMinor,
      structuralNote,
      expertOpinion: input.expertOpinion,
      expertRationale,
      centerDecision: input.centerDecision,
      centerNote,
    },
  }
}
