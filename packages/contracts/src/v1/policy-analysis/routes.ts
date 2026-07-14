import { API_V1_BASE } from '../../common/routes.js'

export const POLICY_ANALYSES_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-analyses` as const
export const POLICY_ANALYSIS_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-analyses/:analysisId` as const
export const POLICY_ANALYSIS_VERSIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-analyses/:analysisId/versions` as const
export const POLICY_ANALYSIS_APPROVE_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-analyses/:analysisId/approve` as const
export const POLICY_ANALYSIS_REJECT_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-analyses/:analysisId/reject` as const
export const POLICY_CONFLICTS_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-conflicts` as const
export const POLICY_CONFLICT_RESOLVE_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-conflicts/:conflictId/resolve` as const
export const POLICY_SCENARIO_EVALUATE_ROUTE = `${API_V1_BASE}/cases/:caseId/policy-scenarios/evaluate` as const

export const POLICY_ANALYSIS_CREATE_SCOPE = 'policy_analysis.create' as const
export const POLICY_ANALYSIS_VERSION_SCOPE = 'policy_analysis.version_create' as const
export const POLICY_ANALYSIS_APPROVE_SCOPE = 'policy_analysis.approve' as const
export const POLICY_ANALYSIS_REJECT_SCOPE = 'policy_analysis.reject' as const
export const POLICY_CONFLICT_RESOLVE_SCOPE = 'policy_conflict.resolve' as const
export const POLICY_SCENARIO_EVALUATE_SCOPE = 'policy_scenario.evaluate' as const
