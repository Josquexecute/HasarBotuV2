import { API_V1_BASE } from '../../common/routes.js'

export const CASE_FILE_OPERATION_PLAN_ROUTE = `${API_V1_BASE}/cases/:caseId/file-operations/plan` as const
export const CASE_FILE_OPERATION_ROUTE = `${API_V1_BASE}/cases/:caseId/file-operations/:operationId` as const
export const CASE_FILE_OPERATION_APPROVE_ROUTE = `${CASE_FILE_OPERATION_ROUTE}/approve` as const
export const CASE_FILE_OPERATION_CANCEL_ROUTE = `${CASE_FILE_OPERATION_ROUTE}/cancel` as const
