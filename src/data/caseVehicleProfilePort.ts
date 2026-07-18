export type VehicleClassRecord =
  | 'passenger_car' | 'light_commercial' | 'heavy_commercial'
  | 'motorcycle' | 'trailer' | 'other'

export type VehicleEvidenceSourceRecord =
  | 'registration_document' | 'policy_document' | 'insurer_record' | 'user_statement' | 'other'

export interface CaseVehicleProfileFieldsRecord {
  readonly brand: string
  readonly model: string
  readonly modelYear: number
  readonly variant: string | null
  readonly vehicleClass: VehicleClassRecord
  readonly chassisPrefix: string | null
  readonly engineCode: string | null
  readonly evidenceSource: VehicleEvidenceSourceRecord
  readonly evidenceReference: string | null
}

export interface CaseVehicleProfileVersionRecord extends CaseVehicleProfileFieldsRecord {
  readonly id: string
  readonly profileVersion: number
  readonly revisionReason: string | null
  readonly createdAt: string
}

export interface CaseVehicleProfileRecord {
  readonly caseId: string
  readonly profileId: string | null
  readonly version: number | null
  readonly current: CaseVehicleProfileVersionRecord | null
  readonly history: readonly CaseVehicleProfileVersionRecord[]
  readonly permissions: { readonly canEdit: boolean }
}

export interface CaseVehicleProfileDataPort {
  read(caseId: string): Promise<CaseVehicleProfileRecord>
  save(caseId: string, input: {
    fields: CaseVehicleProfileFieldsRecord
    expectedVersion: number | null
    reason: string | null
  }): Promise<CaseVehicleProfileRecord>
}

export type CaseVehicleProfileErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'

export class CaseVehicleProfileClientError extends Error {
  readonly kind: CaseVehicleProfileErrorKind

  constructor(kind: CaseVehicleProfileErrorKind, message: string) {
    super(message)
    this.name = 'CaseVehicleProfileClientError'
    this.kind = kind
  }
}

function mapError(status: number): CaseVehicleProfileClientError {
  if (status === 401) return new CaseVehicleProfileClientError('unauthorized', 'session required')
  if (status === 403) return new CaseVehicleProfileClientError('forbidden', 'permission required')
  if (status === 404) return new CaseVehicleProfileClientError('not_found', 'not found')
  if (status === 400) return new CaseVehicleProfileClientError('validation', 'request invalid')
  if (status === 409) return new CaseVehicleProfileClientError('conflict', 'version conflict')
  return new CaseVehicleProfileClientError('unavailable', `vehicle profile HTTP ${status}`)
}

export function createHttpCaseVehicleProfileAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): CaseVehicleProfileDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  const request = async (caseId: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/cases/${encodeURIComponent(caseId)}/vehicle-profile`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...init,
      })
    } catch {
      throw new CaseVehicleProfileClientError('unavailable', 'vehicle profile endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new CaseVehicleProfileClientError('unavailable', 'vehicle profile response invalid')
    }
  }

  const parse = async (payload: unknown): Promise<CaseVehicleProfileRecord> => {
    const { caseVehicleProfileResponseSchema } = await import('@hasarbotu/contracts')
    const parsed = caseVehicleProfileResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new CaseVehicleProfileClientError('unavailable', 'vehicle profile response invalid')
    }
    return parsed.data as unknown as CaseVehicleProfileRecord
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
