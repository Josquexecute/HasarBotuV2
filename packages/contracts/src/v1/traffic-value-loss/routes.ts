import { API_V1_BASE } from '../../common/routes.js'

export const TRAFFIC_VALUE_LOSS_ROUTE = `${API_V1_BASE}/cases/:caseId/traffic-value-loss` as const
export const TRAFFIC_VALUE_LOSS_VERSIONS_ROUTE = `${API_V1_BASE}/cases/:caseId/traffic-value-loss/versions` as const
export const TRAFFIC_VALUE_LOSS_SUBMIT_ROUTE = `${API_V1_BASE}/cases/:caseId/traffic-value-loss/versions/:versionId/submit` as const
export const TRAFFIC_VALUE_LOSS_APPROVE_ROUTE = `${API_V1_BASE}/cases/:caseId/traffic-value-loss/versions/:versionId/approve` as const
export const TRAFFIC_VALUE_LOSS_REJECT_ROUTE = `${API_V1_BASE}/cases/:caseId/traffic-value-loss/versions/:versionId/reject` as const

export const TRAFFIC_VALUE_LOSS_VERSION_SCOPE = 'traffic_value_loss.version_create' as const
export const TRAFFIC_VALUE_LOSS_SUBMIT_SCOPE = 'traffic_value_loss.submit' as const
export const TRAFFIC_VALUE_LOSS_APPROVE_SCOPE = 'traffic_value_loss.approve' as const
export const TRAFFIC_VALUE_LOSS_REJECT_SCOPE = 'traffic_value_loss.reject' as const
