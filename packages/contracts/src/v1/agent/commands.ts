import { z } from 'zod'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'
import { fileOperationStrategySchema } from '../file-operations/dto.js'
import { pdfExtractionResultSummarySchema } from '../pdf-text-extractions/dto.js'
import { policyOcrResultSummarySchema } from '../policy-ocr/dto.js'

/**
 * Agent iş sonucu bildirimi (Paket 14).
 *
 * - `verified`: dosya bulundu ve agent SHA-256'yı GERÇEK dosyadan hesapladı;
 *   `observedHash` + `observedSize` zorunludur. Sunucu bunları BEYAN edilenlerle
 *   karşılaştırır; eşleşirse `pending → ready`, eşleşmezse `ready` YAPILMAZ.
 * - `missing`: dosya yok. `failed`: okuma/erişim hatası (retry edilebilir).
 * - `errorCode`: güvenli, kısa neden kodu (ham hata detayı/yolu taşımaz).
 */
export const RESULT_OUTCOMES = ['verified', 'missing', 'failed'] as const
export type ResultOutcome = (typeof RESULT_OUTCOMES)[number]

// `observedHash`/`observedSize` DOSYA hedefli `verified` sonucunda gereklidir;
// dizin hedefli (`verify_case_location`) `verified` sonucunda gerekmez. Bu
// hedef-türüne bağlı kural SUNUCUDA (job payload.kind'e göre) uygulanır; şema
// alanları opsiyonel tutar.
export const FILE_OPERATION_RESULT_PHASES = [
  'destination_verified',
  'cleanup_completed',
  'manual_recovery_required',
] as const
export const fileOperationResultSchema = z.strictObject({
  phase: z.enum(FILE_OPERATION_RESULT_PHASES),
  strategy: fileOperationStrategySchema,
  manifestHash: sha256HexSchema.optional(),
  fileCount: z.number().int().min(0).optional(),
  directoryCount: z.number().int().min(0).optional(),
  totalBytes: byteSizeSchema.optional(),
  safeOutcomeCode: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).optional(),
})
export type FileOperationResult = z.infer<typeof fileOperationResultSchema>

export const jobResultRequestSchema = z.strictObject({
  outcome: z.enum(RESULT_OUTCOMES),
  observedHash: sha256HexSchema.optional(),
  observedSize: byteSizeSchema.optional(),
  errorCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, { error: 'invalid_error_code' })
    .optional(),
  fileOperation: fileOperationResultSchema.optional(),
  pdfExtraction: pdfExtractionResultSummarySchema.optional(),
  policyOcr: policyOcrResultSummarySchema.optional(),
})
export type JobResultRequest = z.infer<typeof jobResultRequestSchema>
export type JobResultRequestInput = z.input<typeof jobResultRequestSchema>

export const JOB_PROGRESS_PHASES = ['applying', 'verifying', 'cleanup', 'rendering', 'preprocessing', 'recognizing', 'normalizing', 'validating', 'ocr'] as const
export const jobHeartbeatRequestSchema = z.strictObject({
  phase: z.enum(JOB_PROGRESS_PHASES).optional(),
})
export type JobHeartbeatRequest = z.infer<typeof jobHeartbeatRequestSchema>

/** Agent kaydı isteği (yönetici). */
export const agentRegisterRequestSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, { error: 'invalid_agent_name' }),
})
export type AgentRegisterRequest = z.infer<typeof agentRegisterRequestSchema>

/** Agent etkinleştir/devre dışı bırak (yönetici). */
export const agentUpdateRequestSchema = z.strictObject({
  status: z.enum(['active', 'disabled']),
})
export type AgentUpdateRequest = z.infer<typeof agentUpdateRequestSchema>
