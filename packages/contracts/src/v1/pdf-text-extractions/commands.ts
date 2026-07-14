import { z } from 'zod'
import { MAX_PDF_SOURCE_EXCERPT_LENGTH, POLICY_SOURCE_TYPES } from '@hasarbotu/domain'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'
import { policyCodeSchema, policyConfidenceSchema, policyShortTextSchema } from '../policy-analysis/dto.js'

export const pdfTextExtractionCreateRequestSchema = z.record(z.string(), z.never())
export const pdfTextExtractionCancelRequestSchema = z.strictObject({ expectedVersion: entityVersionSchema })
export const pdfTextListQuerySchema = z.strictObject({ page: pageWithDefaultSchema, pageSize: pageSizeWithDefaultSchema })
export const pdfTextSegmentsQuerySchema = pdfTextListQuerySchema.extend({ pageNumber: z.number().int().min(1).optional() })
export const pdfTextSourceReferenceRequestSchema = z.strictObject({
  sourceKey: policyCodeSchema,
  pageId: idSchema,
  segmentId: idSchema.nullable().default(null),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  sectionHeading: policyShortTextSchema,
  clauseIdentifier: policyShortTextSchema,
  sourceType: z.enum(POLICY_SOURCE_TYPES),
  confidence: policyConfidenceSchema,
}).superRefine((value, context) => {
  if (value.endOffset <= value.startOffset) context.addIssue({ code: 'custom', path: ['endOffset'], message: 'invalid_offset_range' })
  if (value.endOffset - value.startOffset > MAX_PDF_SOURCE_EXCERPT_LENGTH) context.addIssue({ code: 'custom', path: ['endOffset'], message: 'excerpt_too_long' })
})

export type PdfTextExtractionCreateRequest = z.infer<typeof pdfTextExtractionCreateRequestSchema>
export type PdfTextExtractionCancelRequest = z.infer<typeof pdfTextExtractionCancelRequestSchema>
export type PdfTextListQuery = z.infer<typeof pdfTextListQuerySchema>
export type PdfTextSegmentsQuery = z.infer<typeof pdfTextSegmentsQuerySchema>
export type PdfTextSourceReferenceRequest = z.infer<typeof pdfTextSourceReferenceRequestSchema>
