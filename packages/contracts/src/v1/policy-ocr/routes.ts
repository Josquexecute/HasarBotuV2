import { API_V1_BASE } from '../../common/routes.js'

export const POLICY_OCR_RUNS_ROUTE = `${API_V1_BASE}/cases/:caseId/documents/:documentId/versions/:documentVersionId/ocr-runs` as const
export const POLICY_OCR_RUN_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId` as const
export const POLICY_OCR_PAGES_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId/pages` as const
export const POLICY_OCR_ELEMENTS_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId/elements` as const
export const POLICY_OCR_CANCEL_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId/cancel` as const
export const POLICY_OCR_RETRY_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId/retry` as const
export const POLICY_OCR_SOURCE_REFERENCE_ROUTE = `${API_V1_BASE}/cases/:caseId/ocr-runs/:ocrRunId/source-reference` as const

export const POLICY_OCR_CREATE_SCOPE = 'document_ocr.run_create' as const
export const POLICY_OCR_CANCEL_SCOPE = 'document_ocr.run_cancel' as const
export const POLICY_OCR_RETRY_SCOPE = 'document_ocr.run_retry' as const
export const POLICY_OCR_SOURCE_REFERENCE_SCOPE = 'document_ocr.source_reference_create' as const
