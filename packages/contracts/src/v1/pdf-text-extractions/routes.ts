import { API_V1_BASE } from '../../common/routes.js'

export const PDF_TEXT_EXTRACTIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/documents/:documentId/versions/:documentVersionId/text-extractions` as const
export const PDF_TEXT_EXTRACTION_ROUTE = `${API_V1_BASE}/cases/:caseId/text-extractions/:extractionId` as const
export const PDF_TEXT_EXTRACTION_PAGES_ROUTE = `${API_V1_BASE}/cases/:caseId/text-extractions/:extractionId/pages` as const
export const PDF_TEXT_EXTRACTION_SEGMENTS_ROUTE = `${API_V1_BASE}/cases/:caseId/text-extractions/:extractionId/segments` as const
export const PDF_TEXT_EXTRACTION_SOURCE_REFERENCE_ROUTE = `${API_V1_BASE}/cases/:caseId/text-extractions/:extractionId/source-reference` as const
export const PDF_TEXT_EXTRACTION_CANCEL_ROUTE = `${API_V1_BASE}/cases/:caseId/text-extractions/:extractionId/cancel` as const
export const PDF_TEXT_EXTRACTION_CREATE_SCOPE = 'document_text.extraction_create' as const
export const PDF_TEXT_EXTRACTION_CANCEL_SCOPE = 'document_text.extraction_cancel' as const
export const PDF_TEXT_SOURCE_REFERENCE_SCOPE = 'document_text.source_reference_create' as const
