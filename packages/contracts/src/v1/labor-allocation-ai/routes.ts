export const CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai' as const
export const CASE_LABOR_ALLOCATION_ANALYZE_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/analyze' as const
export const CASE_LABOR_ALLOCATION_RUN_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId' as const
export const CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-ai/:runId/apply-preview' as const

export const LABOR_ALLOCATION_ANALYZE_SCOPE = 'labor-allocation-ai:analyze' as const
