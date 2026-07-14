import {
  AGENT_CLAIM_ROUTE,
  AGENT_ID_HEADER,
  AGENT_JOB_HEARTBEAT_ROUTE,
  AGENT_JOB_RESULT_ROUTE,
  AGENT_SECRET_HEADER,
  claimResponseSchema,
  heartbeatResponseSchema,
  jobResultResponseSchema,
  type ClaimedJob,
  type JobResultRequestInput,
  type JobResultResponse,
} from '@hasarbotu/contracts'

/**
 * File Agent API istemcisi (Paket 14). Agent YALNIZ API üzerinden çalışır;
 * doğrudan DB'ye yazmaz. Kimlik başlıkları her istekte gönderilir; ham secret
 * loglanmaz. Yanıtlar contracts şemalarıyla doğrulanır.
 */
export class AgentApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AgentApiError'
    this.status = status
  }
}

export interface AgentApiClientOptions {
  readonly baseUrl: string
  readonly agentId: string
  readonly secret: string
  readonly fetchImpl?: typeof fetch
}

export function createAgentApiClient(options: AgentApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const authHeaders = { [AGENT_ID_HEADER]: options.agentId, [AGENT_SECRET_HEADER]: options.secret }
  const url = (route: string): string => `${options.baseUrl}${route}`

  return {
    /** Sıradaki işi kilitler; uygun iş yoksa null. */
    async claim(): Promise<ClaimedJob | null> {
      const response = await fetchImpl(url(AGENT_CLAIM_ROUTE), {
        method: 'POST',
        headers: { ...authHeaders, accept: 'application/json' },
      })
      if (!response.ok) throw new AgentApiError(response.status, 'claim failed')
      return claimResponseSchema.parse(await response.json()).job
    },

    /** Lease uzatır. 409 (lease kaybı) sessizce false döner. */
    async heartbeat(jobId: string, phase?: 'applying' | 'verifying'): Promise<boolean> {
      const response = await fetchImpl(url(AGENT_JOB_HEARTBEAT_ROUTE.replace(':jobId', encodeURIComponent(jobId))), {
        method: 'POST',
        headers: { ...authHeaders, accept: 'application/json', ...(phase === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(phase === undefined ? {} : { body: JSON.stringify({ phase }) }),
      })
      if (response.status === 409) return false
      if (!response.ok) throw new AgentApiError(response.status, 'heartbeat failed')
      heartbeatResponseSchema.parse(await response.json())
      return true
    },

    /** Sonuç bildirir (idempotent). */
    async reportResult(jobId: string, result: JobResultRequestInput): Promise<JobResultResponse> {
      const response = await fetchImpl(url(AGENT_JOB_RESULT_ROUTE.replace(':jobId', encodeURIComponent(jobId))), {
        method: 'POST',
        headers: { ...authHeaders, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(result),
      })
      if (!response.ok) throw new AgentApiError(response.status, 'result report failed')
      return jobResultResponseSchema.parse(await response.json())
    },
  }
}

export type AgentApiClient = ReturnType<typeof createAgentApiClient>
