import { API_V1_BASE } from '../../common/routes.js'

export const CASE_PERT_ASSESSMENT_ROUTE = `${API_V1_BASE}/cases/:caseId/pert-assessment` as const
export const CASE_PERT_ASSESSMENT_VERSIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/pert-assessment/versions` as const

export const PERT_ASSESSMENT_CREATE_SCOPE = 'pert_assessment.create' as const
export const PERT_ASSESSMENT_REVISE_SCOPE = 'pert_assessment.revise' as const
