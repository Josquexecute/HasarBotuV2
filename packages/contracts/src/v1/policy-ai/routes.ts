import {API_V1_BASE} from '../../common/routes.js'

export const POLICY_AI_EXTRACTIONS_ROUTE=`${API_V1_BASE}/cases/:caseId/policy-ai-extractions` as const
export const POLICY_AI_PLAN_ROUTE=`${POLICY_AI_EXTRACTIONS_ROUTE}/plan` as const
export const POLICY_AI_RUN_ROUTE=`${POLICY_AI_EXTRACTIONS_ROUTE}/:runId` as const
export const POLICY_AI_START_ROUTE=`${POLICY_AI_RUN_ROUTE}/start` as const
export const POLICY_AI_CANDIDATES_ROUTE=`${POLICY_AI_RUN_ROUTE}/candidates` as const
export const POLICY_AI_CANDIDATE_REVIEW_ROUTE=`${POLICY_AI_CANDIDATES_ROUTE}/:candidateId/review` as const
export const POLICY_AI_PROMOTION_PREVIEW_ROUTE=`${POLICY_AI_RUN_ROUTE}/promotion-preview` as const
export const POLICY_AI_PROMOTE_ROUTE=`${POLICY_AI_RUN_ROUTE}/promote` as const
export const POLICY_AI_CANCEL_ROUTE=`${POLICY_AI_RUN_ROUTE}/cancel` as const
export const POLICY_AI_USAGE_ROUTE=`${API_V1_BASE}/ai/usage` as const
export const POLICY_AI_PLAN_SCOPE='policy_ai_extraction.plan' as const
export const POLICY_AI_START_SCOPE='policy_ai_extraction.start' as const
export const POLICY_AI_CANCEL_SCOPE='policy_ai_extraction.cancel' as const
export const POLICY_AI_CANDIDATE_REVIEW_SCOPE='policy_ai_candidate.review' as const
export const POLICY_AI_PROMOTE_SCOPE='policy_ai_candidate.promote' as const
