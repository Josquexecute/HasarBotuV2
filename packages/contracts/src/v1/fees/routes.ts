import { API_V1_BASE } from '../../common/routes.js'

export const FEES_ROUTE = `${API_V1_BASE}/fees` as const
export const CASE_FEE_ROUTE = `${API_V1_BASE}/cases/:caseId/fee` as const
export const CASE_FEE_CANDIDATES_ROUTE = `${API_V1_BASE}/cases/:caseId/fee/candidates` as const
export const FEE_APPROVE_ROUTE = `${API_V1_BASE}/fees/:feeId/approve` as const
export const FEE_CORRECT_ROUTE = `${API_V1_BASE}/fees/:feeId/correct` as const
export const CASE_SUMMARY_REPORT_ROUTE = `${API_V1_BASE}/reports/case-summary` as const
