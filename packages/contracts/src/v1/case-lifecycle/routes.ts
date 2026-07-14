import { API_V1_BASE } from '../../common/routes.js'

export const CASE_CLOSE_PLAN_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle/close/plan` as const
export const CASE_CLOSE_APPROVE_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle/close/:operationId/approve` as const
export const CASE_REOPEN_PLAN_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle/reopen/plan` as const
export const CASE_REOPEN_APPROVE_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle/reopen/:operationId/approve` as const
export const CASE_LIFECYCLE_OPERATIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle-operations` as const
export const CASE_LIFECYCLE_OPERATION_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle-operations/:operationId` as const
export const CASE_LIFECYCLE_CANCEL_ROUTE = `${API_V1_BASE}/cases/:caseId/lifecycle-operations/:operationId/cancel` as const
