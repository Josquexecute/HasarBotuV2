import { API_V1_BASE } from '../../common/routes.js'

/** Surumlu Cases route sabitleri. */
export const CASES_ROUTE = `${API_V1_BASE}/cases` as const
export const CASE_DETAIL_ROUTE = `${API_V1_BASE}/cases/:caseId` as const
