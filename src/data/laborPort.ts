export interface LaborItemInputRecord {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  /** Paket 56 kanıt alanları; verilmezse null yazılır. */
  readonly partCode?: string | null
  readonly partCodeSource?: 'user_entered' | 'dictionary_suggested' | null
  readonly damageRegion?: string | null
}

export interface LaborItemRecord extends LaborItemInputRecord {
  readonly ordinal: number
  /** Okuma tarafında alanlar her zaman bulunur; eski sürümlerde null'dır. */
  readonly partCode: string | null
  readonly partCodeSource: 'user_entered' | 'dictionary_suggested' | null
  readonly damageRegion: string | null
}

export interface LaborSheetTotalsRecord {
  readonly partTotalMinor: number
  readonly laborTotalMinor: number
  readonly grandTotalMinor: number
}

export interface LaborSheetVersionRecord {
  readonly id: string
  readonly sheetVersion: number
  readonly previousVersionId: string | null
  readonly items: readonly LaborItemRecord[]
  readonly totals: LaborSheetTotalsRecord
  readonly schemaVersion: 'labor-sheet/1.0.0'
  readonly currency: 'TRY'
  readonly sourceType: 'user_entered' | 'ai_assisted' | 'manual_revision' | 'ai_allocation_applied'
  readonly laborAiSuggestionRunId: string | null
  readonly revisionReason: string | null
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
}

export interface LaborSheetRecord {
  readonly id: string
  readonly caseId: string
  readonly version: number
  readonly currentVersion: LaborSheetVersionRecord
  readonly versions: readonly LaborSheetVersionRecord[]
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LaborSheetWorkspaceRecord {
  readonly caseId: string
  readonly caseVersion: number
  readonly lifecycleStatus: 'open' | 'closed'
  readonly sheet: LaborSheetRecord | null
  readonly permissions: {
    readonly canWrite: boolean
  }
}

export interface LaborSheetCreateInput {
  readonly expectedCaseVersion: number
  readonly items: readonly LaborItemInputRecord[]
  readonly laborAiSuggestionRunId?: string | null
  readonly confirmed: true
}

export interface LaborSheetReviseInput {
  readonly expectedVersion: number
  readonly items: readonly LaborItemInputRecord[]
  readonly reason: string
  readonly laborAiSuggestionRunId?: string | null
  readonly confirmed: true
}

export interface LaborDataPort {
  load(caseId: string): Promise<LaborSheetWorkspaceRecord>
  create(caseId: string, input: LaborSheetCreateInput, idempotencyKey?: string): Promise<LaborSheetRecord>
  revise(caseId: string, input: LaborSheetReviseInput, idempotencyKey?: string): Promise<LaborSheetRecord>
}

export type LaborErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class LaborError extends Error {
  readonly kind: LaborErrorKind

  constructor(kind: LaborErrorKind, message: string) {
    super(message)
    this.name = 'LaborError'
    this.kind = kind
  }
}

export interface LaborAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureIdempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new LaborError('unavailable', 'secure idempotency unavailable')
  return value
}

function mapError(status: number): LaborError {
  if (status === 401) return new LaborError('unauthorized', 'session required')
  if (status === 403) return new LaborError('forbidden', 'permission required')
  if (status === 404) return new LaborError('not_found', 'labor sheet resource not found')
  if (status === 400) return new LaborError('validation', 'labor sheet validation failed')
  if (status === 409) return new LaborError('conflict', 'labor sheet conflict')
  return new LaborError('unavailable', `labor sheet HTTP ${status}`)
}

export function createHttpLaborAdapter(options: LaborAdapterOptions = {}): LaborDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}
  const makeKey = options.idempotencyKeyFactory ?? secureIdempotencyKey

  const request = async (
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new LaborError('unavailable', 'labor sheet endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new LaborError('unavailable', 'labor sheet response invalid')
    }
  }

  return {
    async load(caseId) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/labor-sheet`, 'GET')
      const { laborSheetWorkspaceResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborSheetWorkspaceResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborError('unavailable', 'labor sheet workspace response invalid')
      return parsed.data
    },
    async create(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-sheet`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { laborSheetResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborSheetResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborError('unavailable', 'labor sheet response invalid')
      return parsed.data.sheet
    },
    async revise(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-sheet/versions`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { laborSheetResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborSheetResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborError('unavailable', 'labor sheet response invalid')
      return parsed.data.sheet
    },
  }
}
