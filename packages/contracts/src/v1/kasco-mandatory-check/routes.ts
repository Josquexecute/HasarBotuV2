import { API_V1_BASE } from '../../common/routes.js'

/** Zorunlu Kasko Kontrolü gate route sabitleri. */
export const CASE_KASCO_MANDATORY_CHECK_GATE_ROUTE = `${API_V1_BASE}/cases/:caseId/kasco-mandatory-checks` as const
export const CASE_KASCO_MANDATORY_CHECK_ROUTE = `${API_V1_BASE}/cases/:caseId/kasco-mandatory-checks/:checkCode` as const
export const CASE_KASCO_MANDATORY_CHECK_HISTORY_ROUTE = `${API_V1_BASE}/cases/:caseId/kasco-mandatory-checks/:checkCode/history` as const
