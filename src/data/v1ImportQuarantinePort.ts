import type {
  V1ImportQuarantine,
  V1ImportQuarantineReason,
  V1ImportQuarantineStatus,
} from '@hasarbotu/contracts'

export interface V1ImportQuarantineQuery {
  readonly page: number
  readonly pageSize: number
  readonly reason?: V1ImportQuarantineReason
  readonly status?: V1ImportQuarantineStatus
}

export interface V1ImportQuarantinePage {
  readonly items: readonly V1ImportQuarantine[]
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
}

export interface V1ImportQuarantineDataPort {
  list(query: V1ImportQuarantineQuery): Promise<V1ImportQuarantinePage>
}

export type V1ImportQuarantineErrorKind = 'unauthorized' | 'forbidden' | 'unavailable'

export class V1ImportQuarantineError extends Error {
  constructor(readonly kind: V1ImportQuarantineErrorKind, message: string) {
    super(message)
    this.name = 'V1ImportQuarantineError'
  }
}

export function createHttpV1ImportQuarantineAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): V1ImportQuarantineDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    async list(query) {
      const search = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
      if (query.reason !== undefined) search.set('reason', query.reason)
      if (query.status !== undefined) search.set('status', query.status)
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/v1-import/quarantines?${search.toString()}`, {
          credentials: 'include', headers: { accept: 'application/json' },
        })
      } catch {
        throw new V1ImportQuarantineError('unavailable', 'V1 quarantine API unreachable')
      }
      if (response.status === 401) throw new V1ImportQuarantineError('unauthorized', 'V1 quarantine API HTTP 401')
      if (response.status === 403) throw new V1ImportQuarantineError('forbidden', 'V1 quarantine API HTTP 403')
      if (!response.ok) throw new V1ImportQuarantineError('unavailable', `V1 quarantine API HTTP ${response.status}`)
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new V1ImportQuarantineError('unavailable', 'V1 quarantine API returned invalid JSON')
      }
      const { v1ImportQuarantinesResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = v1ImportQuarantinesResponseSchema.safeParse(payload)
      if (!parsed.success) throw new V1ImportQuarantineError('unavailable', 'V1 quarantine API response invalid')
      return {
        items: parsed.data.items,
        page: parsed.data.pageInfo.page,
        pageSize: parsed.data.pageInfo.pageSize,
        totalItems: parsed.data.pageInfo.totalItems,
        totalPages: parsed.data.pageInfo.totalPages,
      }
    },
  }
}
