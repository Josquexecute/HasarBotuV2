export type LaborOperationTypeRecord =
  | 'repair' | 'replace' | 'remove_install' | 'paint'
  | 'consumable' | 'calibration' | 'related_operation' | 'other'

export type LaborEconomicBucketRecord =
  | 'repair_labor' | 'new_part_or_ownership' | 'remove_install'
  | 'paint_and_consumable' | 'calibration' | 'related_operations'

export type LaborRepairReplaceOpinionRecord =
  | 'repair_indicated' | 'replace_indicated' | 'comparable' | 'insufficient_evidence'

export interface LaborAllocationLineRecord {
  readonly lineOrdinal: number
  readonly sourceDescription: string
  readonly sourceAction: string
  readonly sourcePartAmountMinor: number
  readonly sourceLaborAmountMinor: number
  readonly allocations: readonly { operationType: LaborOperationTypeRecord; amountMinor: number }[]
  readonly repairReplaceOpinion: LaborRepairReplaceOpinionRecord
  readonly economicComparison: {
    readonly buckets: Readonly<Record<LaborEconomicBucketRecord, number>>
    readonly repairTotalMinor: number
    readonly replaceTotalMinor: number
    readonly note: string
  }
  readonly reasoning: string
  readonly evidenceRefs: readonly string[]
  readonly confidence: number
  readonly conflictCodes: readonly string[]
  readonly missingEvidenceCodes: readonly string[]
  readonly controlRequired: boolean
  /**
   * Paket 57: eşleşen eksper baseline karşılaştırması. Baseline yoksa veya
   * satır belirsiz eşleştiyse null; bu durumda karşılaştırma gösterilmez.
   */
  readonly baseline: {
    readonly comparisonVersion: string
    readonly baselineSheetVersion: number
    readonly baselinePartAmountMinor: number
    readonly baselineLaborAmountMinor: number
    readonly baselinePartRatio: number
    readonly suggestedPartRatio: number
    readonly deltaRatio: number
    readonly conflicts: boolean
  } | null
}

export interface LaborAllocationRunRecord {
  readonly id: string
  readonly caseId: string
  readonly status:
    | 'provider_disabled' | 'budget_blocked' | 'running'
    | 'review_required' | 'failed' | 'outcome_unknown'
  readonly providerId: string
  readonly modelId: string
  readonly promptTemplateVersion: string
  readonly outputSchemaVersion: string
  readonly operationTypesVersion: string
  readonly ruleVersion: string
  readonly sourceSheetId: string
  readonly sourceSheetVersion: number
  /** Kanıt olarak kullanılan önceki onaylı föy sürümü; yoksa null. */
  readonly baselineSheetVersion: number | null
  readonly baselineMatchVersion: string | null
  readonly baselineMatchedLineCount: number
  readonly evidenceHash: string
  readonly suggestion: {
    readonly lines: readonly LaborAllocationLineRecord[]
  } | null
  readonly safeErrorCode: string | null
  readonly stale: boolean
  readonly createdAt: string
}

export interface LaborAllocationWorkspaceRecord {
  readonly caseId: string
  readonly caseClosed: boolean
  readonly sourceSheetId: string | null
  readonly sourceSheetVersion: number | null
  readonly sourceLineCount: number
  readonly operationTypesVersion: string
  readonly runs: readonly LaborAllocationRunRecord[]
  readonly permissions: {
    readonly canAnalyze: boolean
    readonly requiresExplicitEgressConfirmation: boolean
  }
}

export interface LaborAllocationApplyPreviewRecord {
  readonly runId: string
  readonly selectedCount: number
  readonly controlRequiredCount: number
  readonly applied: false
  readonly lines: readonly {
    readonly lineOrdinal: number
    readonly description: string
    readonly action: string
    readonly allocations: readonly { operationType: LaborOperationTypeRecord; amountMinor: number }[]
    readonly controlRequired: boolean
  }[]
}

export interface LaborAllocationDataPort {
  workspace(caseId: string): Promise<LaborAllocationWorkspaceRecord>
  analyze(caseId: string, input: {
    expectedSheetVersion: number
    damageDescription: string
    confirmedEgress: boolean
  }): Promise<LaborAllocationRunRecord>
  applyPreview(caseId: string, runId: string, input: {
    expectedSheetVersion: number
    selectedLineOrdinals: readonly number[]
  }): Promise<LaborAllocationApplyPreviewRecord>
}

export type LaborAllocationErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'

export class LaborAllocationClientError extends Error {
  readonly kind: LaborAllocationErrorKind

  constructor(kind: LaborAllocationErrorKind, message: string) {
    super(message)
    this.name = 'LaborAllocationClientError'
    this.kind = kind
  }
}

function mapError(status: number): LaborAllocationClientError {
  if (status === 401) return new LaborAllocationClientError('unauthorized', 'session required')
  if (status === 403) return new LaborAllocationClientError('forbidden', 'permission required')
  if (status === 404) return new LaborAllocationClientError('not_found', 'not found')
  if (status === 400) return new LaborAllocationClientError('validation', 'request invalid')
  if (status === 409) return new LaborAllocationClientError('conflict', 'state conflict')
  return new LaborAllocationClientError('unavailable', `labor allocation HTTP ${status}`)
}

export interface LaborAllocationAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

/** Gerçek uç adaptörü. Hata halinde sahte sonuç üretmez. */
export function createHttpLaborAllocationAdapter(
  options: LaborAllocationAdapterOptions = {},
): LaborAllocationDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...init,
      })
    } catch {
      throw new LaborAllocationClientError('unavailable', 'labor allocation endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new LaborAllocationClientError('unavailable', 'labor allocation response invalid')
    }
  }

  return {
    async workspace(caseId) {
      const { laborAllocationWorkspaceResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationWorkspaceResponseSchema.safeParse(
        await request(`/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai`),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'workspace response invalid')
      return parsed.data as unknown as LaborAllocationWorkspaceRecord
    },
    async analyze(caseId, input) {
      const { laborAllocationRunResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationRunResponseSchema.safeParse(
        await request(`/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai/analyze`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'run response invalid')
      return parsed.data.run as unknown as LaborAllocationRunRecord
    },
    async applyPreview(caseId, runId, input) {
      const { laborAllocationApplyPreviewResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationApplyPreviewResponseSchema.safeParse(
        await request(
          `/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai/${encodeURIComponent(runId)}/apply-preview`,
          { method: 'POST', body: JSON.stringify(input) },
        ),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'preview response invalid')
      return parsed.data as unknown as LaborAllocationApplyPreviewRecord
    },
  }
}
