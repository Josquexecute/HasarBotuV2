import { z } from 'zod'
import { caseIdSchema, entityVersionSchema } from '../../common/primitives.js'
import { kascoCheckEvidenceSchema, kascoCheckResultSchema, kascoMandatoryCheckCodeSchema } from './dto.js'

export const kascoMandatoryCheckGateParamsSchema = z.strictObject({ caseId: caseIdSchema })
export type KascoMandatoryCheckGateParams = z.infer<typeof kascoMandatoryCheckGateParamsSchema>

export const kascoMandatoryCheckParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  checkCode: kascoMandatoryCheckCodeSchema,
})
export type KascoMandatoryCheckParams = z.infer<typeof kascoMandatoryCheckParamsSchema>

const DEFINITIVE_RESULTS = new Set(['same', 'different', 'present', 'absent'])

/**
 * "Poliçe tamamı okunmadan kloz yok sonucu verme": kesin sonuç
 * (same/different/present/absent) her zaman kanıt taşımalıdır; yalnız
 * unclear/unknown kanıtsız kalabilir. Aynı kural veritabanı CHECK
 * kısıtında ve domain katmanında da (savunma derinliği) uygulanır --
 * burada erken, kullanıcıya en yakın katmanda tekrarlanır.
 */
export const kascoMandatoryCheckConfirmRequestSchema = z.strictObject({
  result: kascoCheckResultSchema,
  evidence: kascoCheckEvidenceSchema.nullable(),
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
  expectedVersion: entityVersionSchema,
}).refine((value) => !DEFINITIVE_RESULTS.has(value.result) || value.evidence !== null, {
  error: 'definitive_result_requires_evidence',
  path: ['evidence'],
})
export type KascoMandatoryCheckConfirmRequest = z.infer<typeof kascoMandatoryCheckConfirmRequestSchema>
