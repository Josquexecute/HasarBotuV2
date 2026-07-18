export interface LaborDictionaryEntryRecord {
  readonly description: string
  readonly action: string
  readonly usageCount: number
  readonly lastPartAmountMinor: number
  readonly lastLaborAmountMinor: number
  readonly lastUsedAt: string
}

export interface LaborDictionaryRecord {
  readonly schemaVersion: 'labor-dictionary/1.0.0'
  readonly items: readonly LaborDictionaryEntryRecord[]
}

export interface LaborDictionaryDataPort {
  list(query?: string, limit?: number): Promise<LaborDictionaryRecord>
}

export type LaborDictionaryErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'unavailable'

export class LaborDictionaryError extends Error {
  readonly kind: LaborDictionaryErrorKind

  constructor(kind: LaborDictionaryErrorKind, message: string) {
    super(message)
    this.name = 'LaborDictionaryError'
    this.kind = kind
  }
}

export interface LaborDictionaryAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

function mapError(status: number): LaborDictionaryError {
  if (status === 401) return new LaborDictionaryError('unauthorized', 'session required')
  if (status === 403) return new LaborDictionaryError('forbidden', 'permission required')
  if (status === 404) return new LaborDictionaryError('not_found', 'labor dictionary not found')
  if (status === 400) return new LaborDictionaryError('validation', 'labor dictionary query invalid')
  return new LaborDictionaryError('unavailable', `labor dictionary HTTP ${status}`)
}

export function createHttpLaborDictionaryAdapter(
  options: LaborDictionaryAdapterOptions = {},
): LaborDictionaryDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}

  return {
    async list(query, limit) {
      const search = new URLSearchParams()
      if (query !== undefined && query.trim() !== '') search.set('query', query.trim())
      if (limit !== undefined) search.set('limit', String(limit))
      const suffix = search.size === 0 ? '' : `?${search.toString()}`
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/labor-dictionary${suffix}`, {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json', ...headers },
        })
      } catch {
        throw new LaborDictionaryError('unavailable', 'labor dictionary endpoint unreachable')
      }
      if (!response.ok) throw mapError(response.status)
      let value: unknown
      try {
        value = await response.json()
      } catch {
        throw new LaborDictionaryError('unavailable', 'labor dictionary response invalid')
      }
      const { laborDictionaryResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborDictionaryResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborDictionaryError('unavailable', 'labor dictionary response invalid')
      return parsed.data
    },
  }
}
