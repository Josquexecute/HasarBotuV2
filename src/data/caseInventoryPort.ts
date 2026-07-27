export interface CaseInventoryQueryRecord {
  readonly caseType?: 'traffic' | 'casco'
  readonly status?: 'open' | 'closed'
}

export interface CaseInventoryPreviewRecord {
  readonly totalCount: number
  readonly maxRows: number
  readonly truncated: boolean
  readonly includesPhones: boolean
}

export interface CaseInventoryDataPort {
  preview(query: CaseInventoryQueryRecord): Promise<CaseInventoryPreviewRecord>
  exportWorkbook(query: CaseInventoryQueryRecord): Promise<{ readonly blob: Blob; readonly filename: string }>
}

export type CaseInventoryErrorKind = 'unauthorized' | 'forbidden' | 'validation' | 'unavailable'

export class CaseInventoryClientError extends Error {
  readonly kind: CaseInventoryErrorKind

  constructor(kind: CaseInventoryErrorKind, message: string) {
    super(message)
    this.name = 'CaseInventoryClientError'
    this.kind = kind
  }
}

function mapError(status: number): CaseInventoryClientError {
  if (status === 401) return new CaseInventoryClientError('unauthorized', 'session required')
  if (status === 403) return new CaseInventoryClientError('forbidden', 'permission required')
  if (status === 400) return new CaseInventoryClientError('validation', 'request invalid')
  return new CaseInventoryClientError('unavailable', `case inventory HTTP ${status}`)
}

function buildQueryString(query: CaseInventoryQueryRecord): string {
  const params = new URLSearchParams()
  if (query.caseType !== undefined) params.set('caseType', query.caseType)
  if (query.status !== undefined) params.set('status', query.status)
  const value = params.toString()
  return value.length === 0 ? '' : `?${value}`
}

export function createHttpCaseInventoryAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): CaseInventoryDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async preview(query) {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/case-inventory${buildQueryString(query)}`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        })
      } catch {
        throw new CaseInventoryClientError('unavailable', 'case inventory endpoint unreachable')
      }
      if (!response.ok) throw mapError(response.status)
      const { caseInventoryPreviewResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseInventoryPreviewResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new CaseInventoryClientError('unavailable', 'case inventory response invalid')
      return parsed.data
    },

    async exportWorkbook(query) {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/case-inventory/export${buildQueryString(query)}`, {
          credentials: 'include',
        })
      } catch {
        throw new CaseInventoryClientError('unavailable', 'case inventory export endpoint unreachable')
      }
      if (!response.ok) throw mapError(response.status)
      const disposition = response.headers.get('content-disposition') ?? ''
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'Dosya_Envanteri.xlsx'
      return { blob: await response.blob(), filename }
    },
  }
}
