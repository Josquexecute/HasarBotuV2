import { z } from 'zod'
import { caseIdSchema, entityVersionSchema, idSchema, utcDateTimeSchema } from '../../common/primitives.js'

/**
 * Zorunlu Kasko Kontrolü (paketleme öncesi yeni zorunlu özellik). same/
 * different/unknown karşılaştırma kontrolleri (sürücü/poliçe sahibi ↔
 * ruhsat), present/absent/unclear varlık kontrolleri (ehliyet kısıtlaması,
 * meslek, eşdeğer parça/servis/rayiç muafiyeti klozları) içindir. Şema
 * hem zaten geçersiz bir değeri reddeder hem de hangi kontrolün hangi
 * alt-kümeyi kullandığını `validResults` ile taşır (UI sabit kodlamaz).
 */
export const KASCO_CHECK_RESULT_VALUES = ['same', 'different', 'present', 'absent', 'unclear', 'unknown'] as const
export const kascoCheckResultSchema = z.enum(KASCO_CHECK_RESULT_VALUES)
export type KascoCheckResult = z.infer<typeof kascoCheckResultSchema>

export const KASCO_MANDATORY_CHECK_CODES = [
  'driver_registration_owner_match',
  'driver_license_restriction_codes',
  'policyholder_registration_owner_match',
  'occupation_information',
  'equivalent_parts_clause',
  'service_deductible_clause',
  'market_value_general_deductible',
] as const
export const kascoMandatoryCheckCodeSchema = z.enum(KASCO_MANDATORY_CHECK_CODES)
export type KascoMandatoryCheckCode = z.infer<typeof kascoMandatoryCheckCodeSchema>

export const kascoCheckDerivedStatusSchema = z.enum(['not_applicable', 'missing', 'control_required', 'needs_review', 'resolved'])
export type KascoCheckDerivedStatus = z.infer<typeof kascoCheckDerivedStatusSchema>

/** Kaynak izlenebilirliği: belge + sürüm + sayfa/bölüm + sınırlı alıntı (policy_source_references ile aynı ilke). */
export const kascoCheckEvidenceSchema = z.strictObject({
  documentId: idSchema,
  documentVersionId: idSchema,
  page: z.number().int().min(1),
  section: z.string().trim().min(1).max(300),
  excerpt: z.string().trim().min(1).max(1000),
})
export type KascoCheckEvidence = z.infer<typeof kascoCheckEvidenceSchema>

export const kascoMandatoryCheckSchema = z.strictObject({
  checkCode: kascoMandatoryCheckCodeSchema,
  label: z.string(),
  description: z.string(),
  kind: z.enum(['comparison', 'presence']),
  validResults: z.array(kascoCheckResultSchema),
  status: kascoCheckDerivedStatusSchema,
  reason: z.string(),
  version: entityVersionSchema,
  requiresHumanReview: z.boolean(),
  aiSuggestedResult: kascoCheckResultSchema.nullable(),
  aiConfidenceBasisPoints: z.number().int().min(0).max(10000).nullable(),
  aiEvidence: kascoCheckEvidenceSchema.nullable(),
  aiGeneratedAt: utcDateTimeSchema.nullable(),
  confirmedResult: kascoCheckResultSchema.nullable(),
  confirmedEvidence: kascoCheckEvidenceSchema.nullable(),
  confirmedReason: z.string().nullable(),
  confirmedByUserId: idSchema.nullable(),
  confirmedByDisplayName: z.string().nullable(),
  confirmedAt: utcDateTimeSchema.nullable(),
})
export type KascoMandatoryCheck = z.infer<typeof kascoMandatoryCheckSchema>

export const kascoMandatoryCheckGateSchema = z.strictObject({
  caseId: caseIdSchema,
  applicable: z.boolean(),
  ruleVersion: z.string(),
  checks: z.array(kascoMandatoryCheckSchema),
  missingCount: z.number().int().min(0),
  controlRequiredCount: z.number().int().min(0),
  needsReviewCount: z.number().int().min(0),
  resolvedCount: z.number().int().min(0),
  incomplete: z.boolean(),
  permissions: z.strictObject({ canWrite: z.boolean() }),
})
export type KascoMandatoryCheckGate = z.infer<typeof kascoMandatoryCheckGateSchema>

export const kascoMandatoryCheckGateResponseSchema = z.strictObject({ gate: kascoMandatoryCheckGateSchema })
export type KascoMandatoryCheckGateResponse = z.infer<typeof kascoMandatoryCheckGateResponseSchema>

export const kascoMandatoryCheckResponseSchema = z.strictObject({ check: kascoMandatoryCheckSchema })
export type KascoMandatoryCheckResponse = z.infer<typeof kascoMandatoryCheckResponseSchema>

/** Append-only onay geçmişi öğesi. */
export const kascoMandatoryCheckHistoryItemSchema = z.strictObject({
  id: idSchema,
  checkCode: kascoMandatoryCheckCodeSchema,
  confirmedResult: kascoCheckResultSchema,
  evidence: kascoCheckEvidenceSchema.nullable(),
  reason: z.string().nullable(),
  aiSuggestedResultAtTime: kascoCheckResultSchema.nullable(),
  previousConfirmedResult: kascoCheckResultSchema.nullable(),
  confirmedByUserId: idSchema,
  confirmedByDisplayName: z.string(),
  occurredAt: utcDateTimeSchema,
})
export type KascoMandatoryCheckHistoryItem = z.infer<typeof kascoMandatoryCheckHistoryItemSchema>

export const kascoMandatoryCheckHistoryResponseSchema = z.strictObject({
  items: z.array(kascoMandatoryCheckHistoryItemSchema),
})
export type KascoMandatoryCheckHistoryResponse = z.infer<typeof kascoMandatoryCheckHistoryResponseSchema>
