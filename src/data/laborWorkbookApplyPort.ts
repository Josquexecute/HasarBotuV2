export interface LaborWorkbookApplyRowRecord {
  readonly lineOrdinal: number
  readonly rowNumber: number
  readonly cell: string
  readonly sourceRowHash: string
  readonly partCode: string | null
  readonly partName: string
  readonly operationType: string
  readonly previousValue: string | null
  readonly newValue: string
  readonly valueSource: 'approved_final'
  readonly manuallyModified: boolean
  readonly matchConfidence: 'exact_source_row' | 'control_required'
  readonly conflictCodes: readonly string[]
}

export interface LaborWorkbookApplyRecord {
  readonly id: string
  readonly caseId: string
  readonly applicationId: string
  readonly revisionId: string
  readonly revisionVersion: number
  readonly profileId: string
  readonly workbookReference: string
  readonly sheetName: string
  readonly status:
    | 'preview_pending' | 'preview_ready' | 'approved' | 'applying'
    | 'completed' | 'control_required' | 'failed'
  readonly version: number
  readonly approvedRevisionSnapshotHash: string
  readonly sourceWorkbookHash: string | null
  readonly planHash: string | null
  readonly resultWorkbookHash: string | null
  readonly backupReference: string | null
  readonly previousTotalMinor: number | null
  readonly newTotalMinor: number
  readonly changedRowCount: number
  readonly unchangedRowCount: number
  readonly controlRequiredRowCount: number
  readonly rows: readonly LaborWorkbookApplyRowRecord[]
  readonly jobId: string | null
  readonly safeErrorCode: string | null
}

export interface LaborWorkbookApplyResponseRecord {
  readonly operation: LaborWorkbookApplyRecord
  readonly permissions: {
    readonly canPreview: boolean
    readonly canApprove: boolean
  }
}

export interface LaborWorkbookApplyDataPort {
  preview(caseId: string, input: {
    readonly applicationId: string
    readonly profileId: string
    readonly workbookRelativePath: string
    readonly expectedSourceSha256: string | null
    readonly headers: readonly { readonly cell: string; readonly text: string }[]
    readonly identityCellReferences: {
      readonly plateCell: string | null
      readonly officeNumberCell: string | null
    }
    readonly sourceRows: readonly {
      readonly lineOrdinal: number
      readonly rowNumber: number
    }[]
    readonly idempotencyKey: string
  }): Promise<LaborWorkbookApplyResponseRecord>
  approve(caseId: string, operation: LaborWorkbookApplyRecord, idempotencyKey: string):
    Promise<LaborWorkbookApplyResponseRecord>
  get(caseId: string, operationId: string): Promise<LaborWorkbookApplyResponseRecord>
}

export class LaborWorkbookApplyClientError extends Error {
  constructor(
    readonly kind:
      | 'unauthorized' | 'forbidden' | 'not_found'
      | 'validation' | 'conflict' | 'unavailable',
  ) {
    super(kind)
    this.name = 'LaborWorkbookApplyClientError'
  }
}

function errorFor(status: number): LaborWorkbookApplyClientError {
  if (status === 401) return new LaborWorkbookApplyClientError('unauthorized')
  if (status === 403) return new LaborWorkbookApplyClientError('forbidden')
  if (status === 404) return new LaborWorkbookApplyClientError('not_found')
  if (status === 400) return new LaborWorkbookApplyClientError('validation')
  if (status === 409) return new LaborWorkbookApplyClientError('conflict')
  return new LaborWorkbookApplyClientError('unavailable')
}

export function createHttpLaborWorkbookApplyAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): LaborWorkbookApplyDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const request = async (
    path: string,
    init?: RequestInit,
  ): Promise<LaborWorkbookApplyResponseRecord> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: {
          accept: 'application/json',
          ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init?.headers,
        },
      })
    } catch {
      throw new LaborWorkbookApplyClientError('unavailable')
    }
    if (!response.ok) throw errorFor(response.status)
    const { laborWorkbookApplyResponseSchema } = await import(
      '@hasarbotu/contracts'
    )
    const parsed = laborWorkbookApplyResponseSchema.safeParse(
      await response.json(),
    )
    if (!parsed.success) throw new LaborWorkbookApplyClientError('unavailable')
    return parsed.data as unknown as LaborWorkbookApplyResponseRecord
  }
  const base = (caseId: string) =>
    `/api/v1/cases/${encodeURIComponent(caseId)}/labor-workbook-applies`

  return {
    preview(caseId, input) {
      const { idempotencyKey, ...body } = input
      return request(`${base(caseId)}/preview`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify(body),
      })
    },
    approve(caseId, operation, idempotencyKey) {
      return request(
        `${base(caseId)}/${encodeURIComponent(operation.id)}/approve`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify({
            expectedVersion: operation.version,
            planHash: operation.planHash,
            approvedRevisionSnapshotHash:
              operation.approvedRevisionSnapshotHash,
            confirmed: true,
          }),
        },
      )
    },
    get(caseId, operationId) {
      return request(`${base(caseId)}/${encodeURIComponent(operationId)}`)
    },
  }
}

