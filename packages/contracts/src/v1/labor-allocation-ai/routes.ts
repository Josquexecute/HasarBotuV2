export const CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai' as const
export const CASE_LABOR_ALLOCATION_ANALYZE_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/analyze' as const
export const CASE_LABOR_ALLOCATION_RUN_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId' as const
export const CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId/apply-preview' as const
/** Paket 58: seçilen satırları gerçekten föye uygular. */
export const CASE_LABOR_ALLOCATION_APPLY_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId/apply' as const
export const CASE_LABOR_ALLOCATION_APPLICATIONS_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-applications' as const
/** Paket 62: aktif analizi iptal etmeyi DENER; sonuç belirsizse başarı demez. */
export const CASE_LABOR_ALLOCATION_CANCEL_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId/cancel' as const

export const LABOR_ALLOCATION_ANALYZE_SCOPE = 'labor-allocation-ai:analyze' as const
export const LABOR_ALLOCATION_APPLY_SCOPE = 'labor-allocation-ai:apply' as const
