import { z } from 'zod'
import {
  MAX_PDF_PAGE_TEXT_LENGTH,
  MAX_PDF_SOURCE_EXCERPT_LENGTH,
  PDF_TEXT_EXTRACTION_STATUSES,
  PDF_TEXT_OFFSET_UNIT,
  PDF_TEXT_PAGE_STATUSES,
  PDF_TEXT_SEGMENT_TYPES,
} from '@hasarbotu/domain'
import { caseIdSchema, entityVersionSchema, idSchema, utcDateTimeSchema } from '../../common/primitives.js'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'
import { pageInfoSchema } from '../../common/pagination.js'
import { policySourceReferenceInputSchema } from '../policy-analysis/commands.js'

export const pdfTextExtractionStatusSchema = z.enum(PDF_TEXT_EXTRACTION_STATUSES)
export const pdfTextPageStatusSchema = z.enum(PDF_TEXT_PAGE_STATUSES)
export const pdfTextSegmentTypeSchema = z.enum(PDF_TEXT_SEGMENT_TYPES)
export const pdfTextOffsetUnitSchema = z.literal(PDF_TEXT_OFFSET_UNIT)
export const pdfParserNameSchema = z.literal('pdfjs-dist')
export const pdfParserVersionSchema = z.literal('6.1.200')
export const pdfNormalizationVersionSchema = z.literal('pdf-text-normalization/1.0.0')

export const pdfTextExtractionSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  documentId: idSchema,
  documentVersionId: idSchema,
  extractionVersion: z.number().int().min(1),
  status: pdfTextExtractionStatusSchema,
  parserName: pdfParserNameSchema,
  parserVersion: pdfParserVersionSchema,
  normalizationVersion: pdfNormalizationVersionSchema,
  offsetUnit: pdfTextOffsetUnitSchema,
  sourceHash: sha256HexSchema,
  sourceSize: byteSizeSchema,
  pageCount: z.number().int().min(0),
  textPageCount: z.number().int().min(0),
  imageOnlyPageCount: z.number().int().min(0),
  emptyPageCount: z.number().int().min(0),
  failedPageCount: z.number().int().min(0),
  segmentCount: z.number().int().min(0),
  rawCharacterCount: z.number().int().min(0),
  normalizedCharacterCount: z.number().int().min(0),
  outputHash: sha256HexSchema.nullable(),
  failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
  activeJobId: idSchema.nullable(),
  version: entityVersionSchema,
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
})
export type PdfTextExtraction = z.infer<typeof pdfTextExtractionSchema>

export const pdfTextPageSchema = z.strictObject({
  id: idSchema,
  extractionId: idSchema,
  pageNumber: z.number().int().min(1),
  status: pdfTextPageStatusSchema,
  rawText: z.string().max(MAX_PDF_PAGE_TEXT_LENGTH),
  normalizedText: z.string().max(MAX_PDF_PAGE_TEXT_LENGTH),
  rawTextHash: sha256HexSchema,
  normalizedTextHash: sha256HexSchema,
  rawCharacterCount: z.number().int().min(0),
  normalizedCharacterCount: z.number().int().min(0),
  segmentCount: z.number().int().min(0),
})
export type PdfTextPage = z.infer<typeof pdfTextPageSchema>

export const pdfTextSegmentSchema = z.strictObject({
  id: idSchema,
  extractionId: idSchema,
  pageId: idSchema,
  pageNumber: z.number().int().min(1),
  segmentIndex: z.number().int().min(0),
  type: pdfTextSegmentTypeSchema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  text: z.string().min(1).max(MAX_PDF_PAGE_TEXT_LENGTH),
  textHash: sha256HexSchema,
})
export type PdfTextSegment = z.infer<typeof pdfTextSegmentSchema>

export const pdfTextExtractionResponseSchema = z.strictObject({ extraction: pdfTextExtractionSchema })
export const pdfTextExtractionsResponseSchema = z.strictObject({ items: z.array(pdfTextExtractionSchema) })
export const pdfTextPagesResponseSchema = z.strictObject({ items: z.array(pdfTextPageSchema), pageInfo: pageInfoSchema })
export const pdfTextSegmentsResponseSchema = z.strictObject({ items: z.array(pdfTextSegmentSchema), pageInfo: pageInfoSchema })
export const pdfTextSourceReferenceResponseSchema = z.strictObject({ sourceReference: policySourceReferenceInputSchema })

export const pdfTextCreateParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  documentId: idSchema,
  documentVersionId: idSchema,
})
export const pdfTextExtractionParamsSchema = z.strictObject({ caseId: caseIdSchema, extractionId: idSchema })

export type PdfTextExtractionResponse = z.infer<typeof pdfTextExtractionResponseSchema>
export type PdfTextExtractionsResponse = z.infer<typeof pdfTextExtractionsResponseSchema>
export type PdfTextPagesResponse = z.infer<typeof pdfTextPagesResponseSchema>
export type PdfTextSegmentsResponse = z.infer<typeof pdfTextSegmentsResponseSchema>
export type PdfTextSourceReferenceResponse = z.infer<typeof pdfTextSourceReferenceResponseSchema>

export const pdfExtractedPageChunkSchema = z.strictObject({
  pageNumber: z.number().int().min(1),
  status: pdfTextPageStatusSchema,
  rawText: z.string().max(MAX_PDF_PAGE_TEXT_LENGTH),
  normalizedText: z.string().max(MAX_PDF_PAGE_TEXT_LENGTH),
  rawTextHash: sha256HexSchema,
  normalizedTextHash: sha256HexSchema,
  segments: z.array(z.strictObject({
    segmentIndex: z.number().int().min(0),
    type: pdfTextSegmentTypeSchema,
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(1),
    textHash: sha256HexSchema,
  })).max(2_000),
})
export type PdfExtractedPageChunk = z.infer<typeof pdfExtractedPageChunkSchema>

export const pdfExtractionChunkRequestSchema = z.strictObject({
  extractionId: idSchema,
  extractionVersion: entityVersionSchema,
  sequence: z.number().int().min(0),
  pages: z.array(pdfExtractedPageChunkSchema).min(1).max(4),
})
export const pdfExtractionChunkResponseSchema = z.strictObject({
  jobId: idSchema,
  extractionId: idSchema,
  sequence: z.number().int().min(0),
  acceptedPageCount: z.number().int().min(1).max(4),
})
export type PdfExtractionChunkRequest = z.infer<typeof pdfExtractionChunkRequestSchema>
export type PdfExtractionChunkResponse = z.infer<typeof pdfExtractionChunkResponseSchema>

export const pdfExtractionResultSummarySchema = z.strictObject({
  extractionId: idSchema,
  extractionVersion: entityVersionSchema,
  status: z.enum(['ready', 'partial', 'ocr_required']),
  parserVersion: pdfParserVersionSchema,
  normalizationVersion: pdfNormalizationVersionSchema,
  sourceHash: sha256HexSchema,
  sourceSize: byteSizeSchema,
  pageCount: z.number().int().min(1),
  textPageCount: z.number().int().min(0),
  imageOnlyPageCount: z.number().int().min(0),
  emptyPageCount: z.number().int().min(0),
  failedPageCount: z.number().int().min(0),
  segmentCount: z.number().int().min(0),
  rawCharacterCount: z.number().int().min(0),
  normalizedCharacterCount: z.number().int().min(0),
  outputHash: sha256HexSchema,
})
export type PdfExtractionResultSummary = z.infer<typeof pdfExtractionResultSummarySchema>

export { MAX_PDF_SOURCE_EXCERPT_LENGTH }
