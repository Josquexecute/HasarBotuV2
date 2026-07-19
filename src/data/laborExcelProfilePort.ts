import type { LaborOperationTypeRecord } from './laborAllocationPort'

/**
 * Paket 60 — Excel şablon profili portu.
 *
 * Projeksiyon SALT OKUNURDUR: `written: false` sözleşme literalidir ve bu
 * uçtan hiçbir dosya yazımı yapılmaz.
 */
export interface LaborExcelColumnRecord {
  readonly key: string
  readonly label: string
}

export type LaborExcelMappingRecord = Readonly<Record<LaborOperationTypeRecord, string | null>>

export interface LaborExcelProfileFieldsRecord {
  readonly name: string
  readonly insurerId: string | null
  readonly columns: readonly LaborExcelColumnRecord[]
  readonly mapping: LaborExcelMappingRecord
}

export interface LaborExcelProfileVersionRecord extends LaborExcelProfileFieldsRecord {
  readonly id: string
  readonly profileVersion: number
  readonly revisionReason: string | null
  readonly createdAt: string
}

export interface LaborExcelProfileRecord {
  readonly id: string
  readonly schemaVersion: string
  readonly version: number
  readonly current: LaborExcelProfileVersionRecord
  readonly history: readonly LaborExcelProfileVersionRecord[]
  readonly createdByDisplayName: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LaborExcelProjectionLineRecord {
  readonly lineOrdinal: number
  readonly description: string
  readonly status: 'projected' | 'manual_entry_required'
  readonly reviewRequired: boolean
  readonly cells: Readonly<Record<string, number>>
  readonly unmappedAmountMinor: number
  readonly totalMinor: number
}

export interface LaborExcelProjectionRecord {
  readonly caseId: string
  readonly applicationId: string
  readonly profileId: string
  readonly profileVersion: number
  readonly columns: readonly LaborExcelColumnRecord[]
  readonly lines: readonly LaborExcelProjectionLineRecord[]
  readonly columnTotals: Readonly<Record<string, number>>
  readonly projectedLineCount: number
  readonly manualEntryLineCount: number
  readonly reviewRequiredLineCount: number
  readonly unmappedTotalMinor: number
  /** Sözleşme literali: bu uç dosyaya yazmaz. */
  readonly written: false
}

export interface LaborExcelProfileDataPort {
  list(): Promise<{
    readonly profiles: readonly LaborExcelProfileRecord[]
    readonly permissions: { readonly canWrite: boolean }
  }>
  save(input: {
    readonly profileId: string | null
    readonly fields: LaborExcelProfileFieldsRecord
    readonly expectedVersion: number | null
    readonly reason: string | null
  }): Promise<LaborExcelProfileRecord>
  project(
    caseId: string,
    applicationId: string,
    profileId: string,
  ): Promise<LaborExcelProjectionRecord>
}

export type LaborExcelProfileErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'

export class LaborExcelProfileClientError extends Error {
  readonly kind: LaborExcelProfileErrorKind

  constructor(kind: LaborExcelProfileErrorKind, message: string) {
    super(message)
    this.name = 'LaborExcelProfileClientError'
    this.kind = kind
  }
}

function mapError(status: number): LaborExcelProfileClientError {
  if (status === 401) return new LaborExcelProfileClientError('unauthorized', 'session required')
  if (status === 403) return new LaborExcelProfileClientError('forbidden', 'permission required')
  if (status === 404) return new LaborExcelProfileClientError('not_found', 'not found')
  if (status === 400) return new LaborExcelProfileClientError('validation', 'request invalid')
  if (status === 409) return new LaborExcelProfileClientError('conflict', 'version conflict')
  return new LaborExcelProfileClientError('unavailable', `labor excel profile HTTP ${status}`)
}

export function createHttpLaborExcelProfileAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): LaborExcelProfileDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      })
    } catch {
      throw new LaborExcelProfileClientError('unavailable', 'labor excel profile endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new LaborExcelProfileClientError('unavailable', 'labor excel profile response invalid')
    }
  }

  return {
    async list() {
      const { laborExcelProfilesResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborExcelProfilesResponseSchema.safeParse(
        await request('/api/v1/labor-excel-profiles'),
      )
      if (!parsed.success) {
        throw new LaborExcelProfileClientError('unavailable', 'profiles response invalid')
      }
      return parsed.data as unknown as {
        profiles: readonly LaborExcelProfileRecord[]
        permissions: { canWrite: boolean }
      }
    },
    async save(input) {
      const { laborExcelProfileResponseSchema } = await import('@hasarbotu/contracts')
      const path = input.profileId === null
        ? '/api/v1/labor-excel-profiles'
        : `/api/v1/labor-excel-profiles/${encodeURIComponent(input.profileId)}`
      const parsed = laborExcelProfileResponseSchema.safeParse(await request(path, {
        method: 'POST',
        body: JSON.stringify({
          fields: input.fields,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          confirmed: true,
        }),
      }))
      if (!parsed.success) {
        throw new LaborExcelProfileClientError('unavailable', 'profile response invalid')
      }
      return parsed.data.profile as unknown as LaborExcelProfileRecord
    },
    async project(caseId, applicationId, profileId) {
      const { laborExcelProjectionResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborExcelProjectionResponseSchema.safeParse(await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-applications`
        + `/${encodeURIComponent(applicationId)}/excel-projection`
        + `?profileId=${encodeURIComponent(profileId)}`,
      ))
      if (!parsed.success) {
        throw new LaborExcelProfileClientError('unavailable', 'projection response invalid')
      }
      return parsed.data as unknown as LaborExcelProjectionRecord
    },
  }
}
