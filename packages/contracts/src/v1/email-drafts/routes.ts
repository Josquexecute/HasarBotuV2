import { API_V1_BASE } from '../../common/routes.js'

export const CASE_EMAIL_DRAFTS_ROUTE = `${API_V1_BASE}/cases/:caseId/email-drafts` as const
export const CASE_EMAIL_DRAFT_PREVIEW_ROUTE = `${API_V1_BASE}/cases/:caseId/email-drafts/preview` as const
export const CASE_EMAIL_DRAFT_VERSIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/email-drafts/:draftId/versions` as const
export const CASE_EMAIL_DRAFT_HANDOFFS_ROUTE = `${API_V1_BASE}/cases/:caseId/email-drafts/:draftId/handoffs` as const

export const EMAIL_DRAFT_CREATE_SCOPE = 'email_drafts.create' as const
export const EMAIL_DRAFT_REVISE_SCOPE = 'email_drafts.revise' as const
export const EMAIL_DRAFT_HANDOFF_SCOPE = 'email_drafts.handoff' as const
