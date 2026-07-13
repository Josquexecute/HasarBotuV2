import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema, utcDateTimeSchema } from '../../common/primitives.js'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'

/**
 * File Agent iş kuyruğu ve doğrulama sözleşmeleri (Paket 14).
 *
 * Job payload YALNIZ güvenli alanlar taşır: mantıksal `storageRootKey` + POSIX
 * göreli yol + beyan hash/size. MUTLAK YOL, sürücü harfi veya UNC ASLA taşınmaz;
 * cihaz→mutlak eşleme yalnız Agent'ın yerel config'indedir.
 */
export const JOB_TYPES = ['verify_document', 'verify_photo', 'verify_case_location'] as const
export type JobType = (typeof JOB_TYPES)[number]
export const jobTypeSchema = z.enum(JOB_TYPES)

export const JOB_STATUSES = ['pending', 'leased', 'succeeded', 'failed', 'dead_letter'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const jobStatusSchema = z.enum(JOB_STATUSES)

export const JOB_TARGET_TYPES = ['document_version', 'photo', 'case_location'] as const
export type JobTargetType = (typeof JOB_TARGET_TYPES)[number]
export const jobTargetTypeSchema = z.enum(JOB_TARGET_TYPES)

/** Doğrulama hedefi: dosya (hash+size) veya dizin (yalnız varlık). */
export const JOB_PAYLOAD_KINDS = ['file', 'directory'] as const
export const jobPayloadKindSchema = z.enum(JOB_PAYLOAD_KINDS)

/** Agent'a verilen güvenli payload. Mutlak yol yoktur. */
export const jobPayloadSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  kind: jobPayloadKindSchema,
  declaredHash: sha256HexSchema.nullable(),
  declaredSize: byteSizeSchema.nullable(),
})
export type JobPayload = z.infer<typeof jobPayloadSchema>

/** Claim edilen iş: agent'ın çalışacağı güvenli görev. */
export const claimedJobSchema = z.strictObject({
  id: idSchema,
  type: jobTypeSchema,
  targetType: jobTargetTypeSchema,
  targetId: idSchema,
  targetVersion: z.number().int().min(0),
  attemptCount: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
  leaseExpiresAt: utcDateTimeSchema,
  payload: jobPayloadSchema,
})
export type ClaimedJob = z.infer<typeof claimedJobSchema>

/** Claim yanıtı: uygun iş varsa job, yoksa null. */
export const claimResponseSchema = z.strictObject({
  job: claimedJobSchema.nullable(),
})
export type ClaimResponse = z.infer<typeof claimResponseSchema>

export const heartbeatResponseSchema = z.strictObject({
  jobId: idSchema,
  leaseExpiresAt: utcDateTimeSchema,
})
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>

/** İş sonucu (idempotent). Güvenli özet; mutlak yol/ham hata detayı yoktur. */
export const jobResultResponseSchema = z.strictObject({
  jobId: idSchema,
  status: jobStatusSchema,
  lastErrorCode: z.string().min(1).max(64).nullable(),
})
export type JobResultResponse = z.infer<typeof jobResultResponseSchema>

/** Agent kaydı (yönetici). Ham secret YALNIZ bir kez döner, DB'de saklanmaz. */
export const agentSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'disabled']),
  lastSeenAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
})
export type Agent = z.infer<typeof agentSchema>

export const agentRegisterResponseSchema = z.strictObject({
  agent: agentSchema,
  /** Ham agent secret — yalnız bu yanıtta bir kez; DB'de yalnız hash tutulur. */
  secret: z.string().min(1),
})
export type AgentRegisterResponse = z.infer<typeof agentRegisterResponseSchema>

export const agentResponseSchema = z.strictObject({ agent: agentSchema })
export type AgentResponse = z.infer<typeof agentResponseSchema>

export const agentsListResponseSchema = z.strictObject({ items: z.array(agentSchema) })
export type AgentsListResponse = z.infer<typeof agentsListResponseSchema>

/** Path parametreleri. */
export const jobParamsSchema = z.strictObject({ jobId: idSchema })
export type JobParams = z.infer<typeof jobParamsSchema>
export const agentParamsSchema = z.strictObject({ agentId: idSchema })
export type AgentParams = z.infer<typeof agentParamsSchema>
