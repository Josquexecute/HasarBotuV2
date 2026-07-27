export interface CaseVehicleOwnerRecord {
  readonly name: string
  readonly phone: string | null
}

export interface CaseVehicleOwnersRecord {
  readonly caseId: string
  readonly setVersion: number | null
  readonly owners: readonly CaseVehicleOwnerRecord[]
  readonly updatedByUserId: string | null
  readonly updatedAt: string | null
  readonly permissions: { readonly canEdit: boolean }
}

export interface CaseVehicleOwnersDataPort {
  read(caseId: string): Promise<CaseVehicleOwnersRecord>
  save(caseId: string, input: {
    owners: readonly CaseVehicleOwnerRecord[]
    expectedSetVersion: number | null
  }): Promise<CaseVehicleOwnersRecord>
}

export type CaseVehicleOwnersErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'

export class CaseVehicleOwnersClientError extends Error {
  readonly kind: CaseVehicleOwnersErrorKind

  constructor(kind: CaseVehicleOwnersErrorKind, message: string) {
    super(message)
    this.name = 'CaseVehicleOwnersClientError'
    this.kind = kind
  }
}

function mapError(status: number): CaseVehicleOwnersClientError {
  if (status === 401) return new CaseVehicleOwnersClientError('unauthorized', 'session required')
  if (status === 403) return new CaseVehicleOwnersClientError('forbidden', 'permission required')
  if (status === 404) return new CaseVehicleOwnersClientError('not_found', 'not found')
  if (status === 400) return new CaseVehicleOwnersClientError('validation', 'request invalid')
  if (status === 409) return new CaseVehicleOwnersClientError('conflict', 'version conflict')
  return new CaseVehicleOwnersClientError('unavailable', `vehicle owners HTTP ${status}`)
}

export function createHttpCaseVehicleOwnersAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): CaseVehicleOwnersDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  const request = async (caseId: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/cases/${encodeURIComponent(caseId)}/vehicle-owners`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...init,
      })
    } catch {
      throw new CaseVehicleOwnersClientError('unavailable', 'vehicle owners endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new CaseVehicleOwnersClientError('unavailable', 'vehicle owners response invalid')
    }
  }

  const parse = async (payload: unknown): Promise<CaseVehicleOwnersRecord> => {
    const { caseVehicleOwnersResponseSchema } = await import('@hasarbotu/contracts')
    const parsed = caseVehicleOwnersResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new CaseVehicleOwnersClientError('unavailable', 'vehicle owners response invalid')
    }
    return parsed.data as unknown as CaseVehicleOwnersRecord
  }

  return {
    async read(caseId) {
      return parse(await request(caseId))
    },
    async save(caseId, input) {
      return parse(await request(caseId, {
        method: 'PUT',
        body: JSON.stringify({ ...input, confirmed: true }),
      }))
    },
  }
}
