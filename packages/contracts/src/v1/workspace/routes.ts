import { API_V1_BASE } from '../../common/routes.js'

export const CASE_WORKSPACE_PLANS_ROUTE = `${API_V1_BASE}/cases/:caseId/workspace-plans` as const
export const CASE_WORKSPACE_PLAN_ROUTE = `${API_V1_BASE}/cases/:caseId/workspace-plans/:planId` as const
export const CASE_WORKSPACE_APPROVE_ROUTE = `${API_V1_BASE}/cases/:caseId/workspace-plans/:planId/approve` as const
