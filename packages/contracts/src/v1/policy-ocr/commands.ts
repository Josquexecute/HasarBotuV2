import { z } from 'zod'
import {
  MAX_POLICY_OCR_SOURCE_EXCERPT_LENGTH,
  POLICY_OCR_LANGUAGE_MODES,
  POLICY_OCR_RENDER_PROFILES,
  POLICY_SOURCE_TYPES,
} from '@hasarbotu/domain'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'
import { policyCodeSchema, policyConfidenceSchema, policyShortTextSchema } from '../policy-analysis/dto.js'

export const policyOcrRunCreateRequestSchema = z.strictObject({
  textExtractionId: idSchema,
  languageMode: z.enum(POLICY_OCR_LANGUAGE_MODES).default('tur+eng'),
  renderProfile: z.enum(POLICY_OCR_RENDER_PROFILES).default('standard'),
  /** Omitted means all image-only pages. Explicit pages may additionally select partial pages. */
  pageNumbers: z.array(z.number().int().min(1).max(1_000)).min(1).max(1_000).optional(),
}).superRefine((value, context) => {
  if (value.pageNumbers !== undefined && new Set(value.pageNumbers).size !== value.pageNumbers.length) {
    context.addIssue({ code: 'custom', path: ['pageNumbers'], message: 'duplicate_page_number' })
  }
})

export const policyOcrRunCancelRequestSchema = z.strictObject({ expectedVersion: entityVersionSchema })
export const policyOcrRunRetryRequestSchema = z.strictObject({ expectedVersion: entityVersionSchema })
export const policyOcrListQuerySchema = z.strictObject({ page: pageWithDefaultSchema, pageSize: pageSizeWithDefaultSchema })
export const policyOcrElementsQuerySchema = policyOcrListQuerySchema.extend({
  pageNumber: z.number().int().min(1).max(1_000).optional(),
  type: z.enum(['block', 'line', 'word']).optional(),
})

export const policyOcrSourceReferenceRequestSchema = z.strictObject({
  sourceKey: policyCodeSchema,
  pageId: idSchema,
  blockId: idSchema.nullable().default(null),
  lineId: idSchema.nullable().default(null),
  wordId: idSchema.nullable().default(null),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  sectionHeading: policyShortTextSchema,
  clauseIdentifier: policyShortTextSchema,
  sourceType: z.enum(POLICY_SOURCE_TYPES),
  confidence: policyConfidenceSchema,
}).superRefine((value, context) => {
  if (value.endOffset <= value.startOffset) context.addIssue({ code: 'custom', path: ['endOffset'], message: 'invalid_offset_range' })
  if (value.endOffset - value.startOffset > MAX_POLICY_OCR_SOURCE_EXCERPT_LENGTH) context.addIssue({ code: 'custom', path: ['endOffset'], message: 'excerpt_too_long' })
  if (value.wordId !== null && value.lineId === null) context.addIssue({ code: 'custom', path: ['wordId'], message: 'word_requires_line' })
  if (value.lineId !== null && value.blockId === null) context.addIssue({ code: 'custom', path: ['lineId'], message: 'line_requires_block' })
})

export type PolicyOcrRunCreateRequest = z.infer<typeof policyOcrRunCreateRequestSchema>
export type PolicyOcrRunCancelRequest = z.infer<typeof policyOcrRunCancelRequestSchema>
export type PolicyOcrRunRetryRequest = z.infer<typeof policyOcrRunRetryRequestSchema>
export type PolicyOcrListQuery = z.infer<typeof policyOcrListQuerySchema>
export type PolicyOcrElementsQuery = z.infer<typeof policyOcrElementsQuerySchema>
export type PolicyOcrSourceReferenceRequest = z.infer<typeof policyOcrSourceReferenceRequestSchema>
