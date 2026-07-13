import { API_V1_BASE } from '../../common/routes.js'

/** Surumlu depolama/konum route sabitleri. */
export const STORAGE_ROOTS_ROUTE = `${API_V1_BASE}/storage-roots` as const
export const CASE_LOCATION_ROUTE = `${API_V1_BASE}/cases/:caseId/location` as const
export const CASE_LOCATION_HISTORY_ROUTE = `${API_V1_BASE}/cases/:caseId/location/history` as const
