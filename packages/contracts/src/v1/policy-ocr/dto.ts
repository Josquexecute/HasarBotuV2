import { z } from 'zod'
import {
  MAX_POLICY_OCR_ELEMENTS_PER_PAGE,
  MAX_POLICY_OCR_RAW_TEXT_LENGTH,
  POLICY_OCR_ELEMENT_TYPES,
  POLICY_OCR_ENGINE_NAME,
  POLICY_OCR_ENGINE_VERSION,
  POLICY_OCR_LANGUAGE_DATA_VERSION,
  POLICY_OCR_LANGUAGE_MODES,
  POLICY_OCR_LOCATOR_VERSION,
  POLICY_OCR_NORMALIZATION_VERSION,
  POLICY_OCR_OFFSET_UNIT,
  POLICY_OCR_PAGE_STATUSES,
  POLICY_OCR_PREPROCESSING_VERSION,
  POLICY_OCR_QUALITY_VERSION,
  POLICY_OCR_QUALITY_STATUSES,
  POLICY_OCR_READING_ORDER_QUALITIES,
  POLICY_OCR_COMPOSITE_STATUSES,
  POLICY_OCR_RENDER_PROFILES,
  POLICY_OCR_RENDER_PROFILE_VERSIONS,
  POLICY_OCR_RUN_STATUSES,
} from '@hasarbotu/domain'
import { caseIdSchema, entityVersionSchema, idSchema, utcDateTimeSchema } from '../../common/primitives.js'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'
import { pageInfoSchema } from '../../common/pagination.js'
import { policySourceReferenceInputSchema } from '../policy-analysis/commands.js'

export const policyOcrRunStatusSchema = z.enum(POLICY_OCR_RUN_STATUSES)
export const policyOcrPageStatusSchema = z.enum(POLICY_OCR_PAGE_STATUSES)
export const policyOcrQualityStatusSchema = z.enum(POLICY_OCR_QUALITY_STATUSES)
export const policyOcrLanguageModeSchema = z.enum(POLICY_OCR_LANGUAGE_MODES)
export const policyOcrRenderProfileSchema = z.enum(POLICY_OCR_RENDER_PROFILES)
export const policyOcrReadingOrderQualitySchema = z.enum(POLICY_OCR_READING_ORDER_QUALITIES)
export const policyOcrCompositeStatusSchema = z.enum(POLICY_OCR_COMPOSITE_STATUSES)
export const policyOcrElementTypeSchema = z.enum(POLICY_OCR_ELEMENT_TYPES)
export const policyOcrConfidenceSchema = z.number().min(0).max(100)
export const policyOcrBoundingBoxSchema = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})

export const policyOcrRunSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  documentId: idSchema,
  documentVersionId: idSchema,
  textExtractionId: idSchema,
  ocrVersion: z.number().int().min(1),
  status: policyOcrRunStatusSchema,
  engineName: z.literal(POLICY_OCR_ENGINE_NAME),
  engineVersion: z.literal(POLICY_OCR_ENGINE_VERSION),
  languageDataVersion: z.literal(POLICY_OCR_LANGUAGE_DATA_VERSION),
  languageDataHash: sha256HexSchema,
  languageMode: policyOcrLanguageModeSchema,
  renderProfile: policyOcrRenderProfileSchema,
  renderProfileVersion: z.enum([POLICY_OCR_RENDER_PROFILE_VERSIONS.standard, POLICY_OCR_RENDER_PROFILE_VERSIONS.high_quality]),
  preprocessingVersion: z.literal(POLICY_OCR_PREPROCESSING_VERSION),
  qualityVersion: z.literal(POLICY_OCR_QUALITY_VERSION),
  normalizationVersion: z.literal(POLICY_OCR_NORMALIZATION_VERSION),
  locatorVersion: z.literal(POLICY_OCR_LOCATOR_VERSION),
  offsetUnit: z.literal(POLICY_OCR_OFFSET_UNIT),
  sourceHash: sha256HexSchema,
  sourceSize: byteSizeSchema,
  eligiblePageCount: z.number().int().min(0),
  processedPageCount: z.number().int().min(0),
  readyPageCount: z.number().int().min(0),
  lowQualityPageCount: z.number().int().min(0),
  emptyPageCount: z.number().int().min(0),
  failedPageCount: z.number().int().min(0),
  blockCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  wordCount: z.number().int().min(0),
  normalizedCharacterCount: z.number().int().min(0),
  meanConfidence: policyOcrConfidenceSchema.nullable(),
  outputHash: sha256HexSchema.nullable(),
  failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
  activeJobId: idSchema.nullable(),
  version: entityVersionSchema,
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
})
export type PolicyOcrRun = z.infer<typeof policyOcrRunSchema>

export const policyOcrPageSchema = z.strictObject({
  id: idSchema,
  ocrRunId: idSchema,
  textPageId: idSchema,
  pageNumber: z.number().int().min(1).max(1_000),
  status: policyOcrPageStatusSchema,
  languageMode: policyOcrLanguageModeSchema,
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  renderDpi: z.number().int().min(72).max(600),
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  deskewDegrees: z.number().min(-15).max(15),
  threshold: z.number().int().min(0).max(255),
  rawOcrText: z.string().max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  rawTextHash: sha256HexSchema,
  normalizedText: z.string().max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  normalizedTextHash: sha256HexSchema,
  normalizedCharacterCount: z.number().int().min(0),
  meanConfidence: policyOcrConfidenceSchema,
  minimumConfidence: policyOcrConfidenceSchema,
  qualityStatus: policyOcrQualityStatusSchema,
  readingOrderQuality: policyOcrReadingOrderQualitySchema,
  compositeStatus: policyOcrCompositeStatusSchema,
  qualityReasonCode: z.enum(['quality_good', 'low_confidence', 'insufficient_text', 'empty_result', 'suspicious_characters', 'ocr_failed']),
  requiresHumanReview: z.boolean(),
  blockCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  wordCount: z.number().int().min(0),
  lowConfidenceWordCount: z.number().int().min(0),
  unreadableRegionCount: z.number().int().min(0),
  processingDurationMs: z.number().int().min(0).max(600_000),
})
export type PolicyOcrPage = z.infer<typeof policyOcrPageSchema>

export const policyOcrElementSchema = z.strictObject({
  id: idSchema,
  ocrRunId: idSchema,
  pageId: idSchema,
  pageNumber: z.number().int().min(1).max(1_000),
  type: policyOcrElementTypeSchema,
  parentId: idSchema.nullable(),
  elementIndex: z.number().int().nonnegative(),
  readingOrder: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  text: z.string().min(1).max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  textHash: sha256HexSchema,
  confidence: policyOcrConfidenceSchema,
  bbox: policyOcrBoundingBoxSchema,
  sourceLayer: z.literal('ocr'),
})
export type PolicyOcrElement = z.infer<typeof policyOcrElementSchema>

export const policyOcrRunResponseSchema = z.strictObject({ ocrRun: policyOcrRunSchema })
export const policyOcrRunsResponseSchema = z.strictObject({ items: z.array(policyOcrRunSchema) })
export const policyOcrPagesResponseSchema = z.strictObject({ items: z.array(policyOcrPageSchema), pageInfo: pageInfoSchema })
export const policyOcrElementsResponseSchema = z.strictObject({ items: z.array(policyOcrElementSchema), pageInfo: pageInfoSchema })
export const policyOcrSourceReferenceResponseSchema = z.strictObject({ sourceReference: policySourceReferenceInputSchema })

export const policyOcrCreateParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  documentId: idSchema,
  documentVersionId: idSchema,
})
export const policyOcrRunParamsSchema = z.strictObject({ caseId: caseIdSchema, ocrRunId: idSchema })

export type PolicyOcrRunResponse = z.infer<typeof policyOcrRunResponseSchema>
export type PolicyOcrRunsResponse = z.infer<typeof policyOcrRunsResponseSchema>
export type PolicyOcrPagesResponse = z.infer<typeof policyOcrPagesResponseSchema>
export type PolicyOcrElementsResponse = z.infer<typeof policyOcrElementsResponseSchema>
export type PolicyOcrSourceReferenceResponse = z.infer<typeof policyOcrSourceReferenceResponseSchema>

export const policyOcrElementChunkSchema = z.strictObject({
  elementIndex: z.number().int().min(0).max(MAX_POLICY_OCR_ELEMENTS_PER_PAGE - 1),
  type: policyOcrElementTypeSchema,
  parentIndex: z.number().int().min(0).nullable(),
  readingOrder: z.number().int().min(0),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  textHash: sha256HexSchema,
  confidence: policyOcrConfidenceSchema,
  bbox: policyOcrBoundingBoxSchema,
})
export const policyOcrPageChunkSchema = z.strictObject({
  textPageId: idSchema,
  pageNumber: z.number().int().min(1).max(1_000),
  status: policyOcrPageStatusSchema,
  languageMode: policyOcrLanguageModeSchema,
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  renderDpi: z.number().int().min(72).max(600),
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  deskewDegrees: z.number().min(-15).max(15),
  threshold: z.number().int().min(0).max(255),
  rawOcrText: z.string().max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  rawTextHash: sha256HexSchema,
  normalizedText: z.string().max(MAX_POLICY_OCR_RAW_TEXT_LENGTH),
  normalizedTextHash: sha256HexSchema,
  meanConfidence: policyOcrConfidenceSchema,
  minimumConfidence: policyOcrConfidenceSchema,
  qualityStatus: policyOcrQualityStatusSchema,
  readingOrderQuality: policyOcrReadingOrderQualitySchema,
  compositeStatus: policyOcrCompositeStatusSchema,
  qualityReasonCode: z.enum(['quality_good', 'low_confidence', 'insufficient_text', 'empty_result', 'suspicious_characters', 'ocr_failed']),
  requiresHumanReview: z.boolean(),
  lowConfidenceWordCount: z.number().int().min(0),
  unreadableRegionCount: z.number().int().min(0),
  processingDurationMs: z.number().int().min(0).max(600_000),
  elements: z.array(policyOcrElementChunkSchema).max(MAX_POLICY_OCR_ELEMENTS_PER_PAGE),
})
export type PolicyOcrPageChunk = z.infer<typeof policyOcrPageChunkSchema>

export const policyOcrChunkRequestSchema = z.strictObject({
  ocrRunId: idSchema,
  ocrRunVersion: entityVersionSchema,
  sequence: z.number().int().min(0),
  pages: z.array(policyOcrPageChunkSchema).min(1).max(2),
})
export const policyOcrChunkResponseSchema = z.strictObject({
  jobId: idSchema,
  ocrRunId: idSchema,
  sequence: z.number().int().min(0),
  acceptedPageCount: z.number().int().min(1).max(2),
})
export type PolicyOcrChunkRequest = z.infer<typeof policyOcrChunkRequestSchema>
export type PolicyOcrChunkResponse = z.infer<typeof policyOcrChunkResponseSchema>

export const policyOcrResultSummarySchema = z.strictObject({
  ocrRunId: idSchema,
  ocrRunVersion: entityVersionSchema,
  status: z.enum(['ready', 'partial', 'low_confidence', 'control_required']),
  engineVersion: z.literal(POLICY_OCR_ENGINE_VERSION),
  languageDataVersion: z.literal(POLICY_OCR_LANGUAGE_DATA_VERSION),
  languageDataHash: sha256HexSchema,
  renderProfileVersion: z.enum([POLICY_OCR_RENDER_PROFILE_VERSIONS.standard, POLICY_OCR_RENDER_PROFILE_VERSIONS.high_quality]),
  preprocessingVersion: z.literal(POLICY_OCR_PREPROCESSING_VERSION),
  qualityVersion: z.literal(POLICY_OCR_QUALITY_VERSION),
  normalizationVersion: z.literal(POLICY_OCR_NORMALIZATION_VERSION),
  locatorVersion: z.literal(POLICY_OCR_LOCATOR_VERSION),
  sourceHash: sha256HexSchema,
  sourceSize: byteSizeSchema,
  eligiblePageCount: z.number().int().min(1).max(1_000),
  processedPageCount: z.number().int().min(0).max(1_000),
  readyPageCount: z.number().int().min(0).max(1_000),
  lowQualityPageCount: z.number().int().min(0).max(1_000),
  emptyPageCount: z.number().int().min(0).max(1_000),
  failedPageCount: z.number().int().min(0).max(1_000),
  blockCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  wordCount: z.number().int().min(0),
  normalizedCharacterCount: z.number().int().min(0),
  meanConfidence: policyOcrConfidenceSchema.nullable(),
  outputHash: sha256HexSchema,
})
export type PolicyOcrResultSummary = z.infer<typeof policyOcrResultSummarySchema>
