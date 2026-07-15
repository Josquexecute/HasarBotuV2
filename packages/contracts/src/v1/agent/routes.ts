import { API_V1_BASE } from '../../common/routes.js'

/** Agent iş kuyruğu route sabitleri (agent kimliğiyle erişilir). */
export const AGENT_CLAIM_ROUTE = `${API_V1_BASE}/agent/jobs/claim` as const
export const AGENT_JOB_HEARTBEAT_ROUTE = `${API_V1_BASE}/agent/jobs/:jobId/heartbeat` as const
export const AGENT_JOB_RESULT_ROUTE = `${API_V1_BASE}/agent/jobs/:jobId/result` as const
export const AGENT_JOB_EXTRACTION_CHUNKS_ROUTE = `${API_V1_BASE}/agent/jobs/:jobId/extraction-chunks` as const
export const AGENT_JOB_OCR_CHUNKS_ROUTE = `${API_V1_BASE}/agent/jobs/:jobId/ocr-chunks` as const

/** Agent yönetimi (yalnız yönetici). */
export const AGENTS_ROUTE = `${API_V1_BASE}/agents` as const
export const AGENT_DETAIL_ROUTE = `${API_V1_BASE}/agents/:agentId` as const

/** Agent kimlik başlıkları (kullanıcı oturumundan ayrı). Ham secret loglanmaz. */
export const AGENT_ID_HEADER = 'x-agent-id'
export const AGENT_SECRET_HEADER = 'x-agent-secret'
