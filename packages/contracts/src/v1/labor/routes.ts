import { API_V1_BASE } from '../../common/routes.js'

export const CASE_LABOR_SHEET_ROUTE = `${API_V1_BASE}/cases/:caseId/labor-sheet` as const
export const CASE_LABOR_SHEET_VERSIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/labor-sheet/versions` as const

export const LABOR_SHEET_CREATE_SCOPE = 'labor_sheet.create' as const
export const LABOR_SHEET_REVISE_SCOPE = 'labor_sheet.revise' as const
