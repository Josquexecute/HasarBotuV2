import { API_V1_BASE } from '../../common/routes.js'

export const CASE_OPERATIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/operations` as const
export const CASE_NOTES_ROUTE = `${API_V1_BASE}/cases/:caseId/notes` as const
export const CASE_TASKS_ROUTE = `${API_V1_BASE}/cases/:caseId/tasks` as const
export const CASE_TASK_COMPLETE_ROUTE = `${API_V1_BASE}/cases/:caseId/tasks/:taskId/complete` as const
export const CASE_TASK_CANCEL_ROUTE = `${API_V1_BASE}/cases/:caseId/tasks/:taskId/cancel` as const
