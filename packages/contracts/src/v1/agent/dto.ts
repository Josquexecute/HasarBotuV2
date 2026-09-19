import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema, utcDateTimeSchema } from '../../common/primitives.js'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'
import {
  fileOperationStrategySchema,
  fileOperationTypeSchema,
  logicalStorageReferenceSchema,
} from '../file-operations/dto.js'
import {
  pdfNormalizationVersionSchema,
  pdfParserVersionSchema,
} from '../pdf-text-extractions/dto.js'
import {
  policyOcrLanguageModeSchema,
} from '../policy-ocr/dto.js'
import {
  MAX_POLICY_OCR_ELEMENTS_PER_PAGE,
  MAX_POLICY_OCR_IMAGE_PIXELS,
  MAX_POLICY_OCR_RAW_TEXT_LENGTH,
  MAX_POLICY_OCR_TOTAL_CHARACTERS,
  POLICY_OCR_ENGINE_VERSION,
  POLICY_OCR_LANGUAGE_DATA_VERSION,
  POLICY_OCR_LOCATOR_VERSION,
  POLICY_OCR_NORMALIZATION_VERSION,
  POLICY_OCR_PREPROCESSING_VERSION,
  POLICY_OCR_QUALITY_VERSION,
  POLICY_OCR_RENDER_DPI,
  POLICY_OCR_RENDER_PROFILE_VERSIONS,
} from '@hasarbotu/domain'

/**
 * File Agent iş kuyruğu ve doğrulama sözleşmeleri (Paket 14).
 *
 * Job payload YALNIZ güvenli alanlar taşır: mantıksal `storageRootKey` + POSIX
 * göreli yol + beyan hash/size. MUTLAK YOL, sürücü harfi veya UNC ASLA taşınmaz;
 * cihaz→mutlak eşleme yalnız Agent'ın yerel config'indedir.
 */
export const JOB_TYPES = [
  'verify_document',
  'verify_photo',
  'verify_case_location',
  'provision_case_workspace',
  'rename_case_workspace',
  'move_case_workspace',
  'cleanup_moved_workspace',
  'extract_pdf_text',
  'ocr_policy_pages',
] as const
export type JobType = (typeof JOB_TYPES)[number]
export const jobTypeSchema = z.enum(JOB_TYPES)

export const JOB_STATUSES = ['pending', 'leased', 'succeeded', 'failed', 'dead_letter', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const jobStatusSchema = z.enum(JOB_STATUSES)

export const JOB_TARGET_TYPES = ['document_version', 'photo', 'case_location', 'workspace_provisioning', 'file_operation', 'document_text_extraction', 'document_ocr_run'] as const
export type JobTargetType = (typeof JOB_TARGET_TYPES)[number]
export const jobTargetTypeSchema = z.enum(JOB_TARGET_TYPES)

/** Doğrulama hedefi: dosya (hash+size) veya dizin (yalnız varlık). */
export const JOB_PAYLOAD_KINDS = ['file', 'directory', 'workspace', 'file_operation', 'file_operation_cleanup', 'pdf_text_extraction', 'policy_ocr'] as const
export const jobPayloadKindSchema = z.enum(JOB_PAYLOAD_KINDS)

/** Agent'a verilen güvenli payload. Mutlak yol yoktur. */
export const verificationJobPayloadSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  kind: z.enum(['file', 'directory']),
  declaredHash: sha256HexSchema.nullable(),
  declaredSize: byteSizeSchema.nullable(),
})
export const workspaceJobPayloadSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  kind: z.literal('workspace'),
  requiredSubdirectories: z.tuple([
    z.literal('EVRAK'),
    z.literal('HASAR'),
    z.literal('OLAY YERİ'),
    z.literal('ONARIM'),
    z.literal('DEĞER KAYBI'),
  ]),
})
export const fileOperationJobPayloadSchema = z.strictObject({
  kind: z.literal('file_operation'),
  operationId: idSchema,
  operationVersion: z.number().int().min(1),
  operationType: fileOperationTypeSchema,
  source: logicalStorageReferenceSchema,
  destination: logicalStorageReferenceSchema,
  strategy: fileOperationStrategySchema,
  plannedAt: utcDateTimeSchema,
  stagingRelativePath: relativePathSchema,
  temporaryRelativePath: relativePathSchema,
})
export const fileOperationCleanupJobPayloadSchema = z.strictObject({
  kind: z.literal('file_operation_cleanup'),
  operationId: idSchema,
  operationVersion: z.number().int().min(1),
  source: logicalStorageReferenceSchema,
  destination: logicalStorageReferenceSchema,
  manifestHash: sha256HexSchema,
  fileCount: z.number().int().min(0),
  directoryCount: z.number().int().min(0),
  totalBytes: byteSizeSchema,
})
export const pdfTextExtractionJobPayloadSchema = z.strictObject({
  kind: z.literal('pdf_text_extraction'),
  extractionId: idSchema,
  extractionVersion: z.number().int().min(1),
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  declaredHash: sha256HexSchema,
  declaredSize: byteSizeSchema,
  parserVersion: pdfParserVersionSchema,
  normalizationVersion: pdfNormalizationVersionSchema,
  maxSourceBytes: byteSizeSchema,
  maxPages: z.number().int().min(1).max(1_000),
  maxPageCharacters: z.number().int().min(1).max(200_000),
  maxTotalCharacters: z.number().int().min(1).max(5_000_000),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  workerMemoryMb: z.number().int().min(64).max(512),
})
export const policyOcrJobPayloadSchema = z.strictObject({
  kind: z.literal('policy_ocr'),
  ocrRunId: idSchema,
  ocrRunVersion: z.number().int().min(1),
  textExtractionId: idSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  declaredHash: sha256HexSchema,
  declaredSize: byteSizeSchema,
  languageMode: policyOcrLanguageModeSchema,
  languageDataVersion: z.literal(POLICY_OCR_LANGUAGE_DATA_VERSION),
  languageDataHash: sha256HexSchema,
  engineVersion: z.literal(POLICY_OCR_ENGINE_VERSION),
  renderProfile: z.enum(['standard', 'high_quality']),
  renderProfileVersion: z.enum([POLICY_OCR_RENDER_PROFILE_VERSIONS.standard, POLICY_OCR_RENDER_PROFILE_VERSIONS.high_quality]),
  preprocessingVersion: z.literal(POLICY_OCR_PREPROCESSING_VERSION),
  qualityVersion: z.literal(POLICY_OCR_QUALITY_VERSION),
  normalizationVersion: z.literal(POLICY_OCR_NORMALIZATION_VERSION),
  locatorVersion: z.literal(POLICY_OCR_LOCATOR_VERSION),
  renderDpi: z.union([z.literal(POLICY_OCR_RENDER_DPI.standard), z.literal(POLICY_OCR_RENDER_DPI.high_quality)]),
  eligiblePages: z.array(z.strictObject({
    textPageId: idSchema,
    pageNumber: z.number().int().min(1).max(1_000),
    sourcePageStatus: z.enum(['image_only', 'text']),
  })).min(1).max(1_000),
  maxSourceBytes: byteSizeSchema,
  maxImagePixels: z.number().int().min(1).max(MAX_POLICY_OCR_IMAGE_PIXELS),
  maxPageCharacters: z.number().int().min(1).max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  maxTotalCharacters: z.number().int().min(1).max(MAX_POLICY_OCR_TOTAL_CHARACTERS),
  maxElementsPerPage: z.number().int().min(1).max(MAX_POLICY_OCR_ELEMENTS_PER_PAGE),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  workerMemoryMb: z.number().int().min(128).max(1_024),
})

export const jobPayloadSchema = z.discriminatedUnion('kind', [
  verificationJobPayloadSchema,
  workspaceJobPayloadSchema,
  fileOperationJobPayloadSchema,
  fileOperationCleanupJobPayloadSchema,
  pdfTextExtractionJobPayloadSchema,
  policyOcrJobPayloadSchema,
])
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
