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
  /**
   * Paket 64: işçilik DAĞITIM KATEGORİSİ (branş) ekseni.
   *
   * Kategori provenance yoksa null olur; bu satırda dağılım uydurulmaz ve
   * manuel giriş istenir. `baselineAmounts`/`historyAmounts` null ise
   * karşılaştırılacak referans YOKTU — sıfır dağılım onaylandı demek değildir.
   */
  readonly categoryAllocation: {
    readonly schemaVersion: string
    readonly amounts: readonly { readonly category: string; readonly amountMinor: number }[]
    readonly confidence: number
    readonly conflictCodes: readonly string[]
    readonly baselineAmounts:
      readonly { readonly category: string; readonly amountMinor: number }[] | null
    readonly historyAmounts:
      readonly { readonly category: string; readonly amountMinor: number }[] | null
  } | null
}

export interface LaborAllocationRunRecord {
  readonly id: string
  readonly caseId: string
  readonly status:
    | 'provider_disabled' | 'budget_blocked' | 'queued' | 'running'
    | 'review_required' | 'failed' | 'outcome_unknown'
    | 'cancel_requested' | 'cancelled'
  /** Paket 62: gerçek ilerleme; sahte yüzde veya kalan süre yoktur. */
  readonly progress: {
    readonly totalLineCount: number
    readonly processedLineCount: number
    readonly totalChunkCount: number
    readonly completedChunkCount: number
    readonly startedAt: string | null
    readonly updatedAt: string | null
    readonly cancelRequestedAt: string | null
  }
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

/** Paket 58: gerçekten uygulanmış dağıtımın provenance kaydı. */
export interface LaborAllocationAppliedLineRecord {
  readonly lineOrdinal: number
  readonly suggestedDescription: string
  readonly suggestedAction: string
  readonly suggestedPartAmountMinor: number
  readonly suggestedLaborAmountMinor: number
  readonly suggestedOperationTypes: readonly LaborOperationTypeRecord[]
  readonly appliedDescription: string
  readonly appliedAction: string
  readonly appliedPartAmountMinor: number
  readonly appliedLaborAmountMinor: number
  readonly modified: boolean
  readonly controlRequired: boolean
}

export interface LaborAllocationApplicationRecord {
  readonly id: string
  readonly caseId: string
  readonly runId: string
  readonly status: 'running' | 'completed' | 'failed'
  readonly sourceSheetVersion: number
  readonly targetSheetVersion: number | null
  readonly selectedLineCount: number
  readonly rejectedLineCount: number
  readonly modifiedLineCount: number
  readonly controlRequiredLineCount: number
  readonly lines: readonly LaborAllocationAppliedLineRecord[]
  readonly appliedByDisplayName: string
  readonly createdAt: string
  readonly completedAt: string | null
}

export interface LaborAllocationApplyInput {
  readonly expectedSheetVersion: number
  readonly reason: string
  readonly confirmed: true
  readonly lines: readonly {
    readonly lineOrdinal: number
    readonly description: string
    readonly action: string
    readonly partAmountMinor: number
    readonly laborAmountMinor: number
  }[]
}

export interface LaborAllocationDataPort {
  workspace(caseId: string): Promise<LaborAllocationWorkspaceRecord>
  analyze(caseId: string, input: {
    expectedSheetVersion: number
    damageDescription: string
    confirmedEgress: boolean
  }): Promise<LaborAllocationRunRecord>
  /** Paket 62: tek run durumunu okur (ilerleme takibi). */
  readRun(caseId: string, runId: string): Promise<LaborAllocationRunRecord>
  /** Aktif analizi iptal etmeyi DENER; sonuç belirsizse başarı denmez. */
  cancel(caseId: string, runId: string): Promise<LaborAllocationRunRecord>
  applyPreview(caseId: string, runId: string, input: {
    expectedSheetVersion: number
    selectedLineOrdinals: readonly number[]
  }): Promise<LaborAllocationApplyPreviewRecord>
  /** Föyü gerçekten değiştirir; açık kullanıcı onayı zorunludur. */
  apply(
    caseId: string,
    runId: string,
    input: LaborAllocationApplyInput,
    idempotencyKey?: string,
  ): Promise<LaborAllocationApplicationRecord>
  listApplications(caseId: string): Promise<readonly LaborAllocationApplicationRecord[]>
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
        ...init,
        // Başlıklar BİRLEŞTİRİLİR; init'in kendi başlığı varsayılanları
        // (accept/content-type) düşürmemelidir.
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(init?.headers as Record<string, string> | undefined),
        },
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
    async readRun(caseId, runId) {
      const { laborAllocationRunResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationRunResponseSchema.safeParse(
        await request(
          `/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai/${encodeURIComponent(runId)}`,
        ),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'run response invalid')
      return parsed.data.run as unknown as LaborAllocationRunRecord
    },
    async cancel(caseId, runId) {
      const { laborAllocationRunResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationRunResponseSchema.safeParse(
        await request(
          `/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai`
          + `/${encodeURIComponent(runId)}/cancel`,
          // Gövde taşımayan istek de `content-type: application/json` ile
          // gider; boş gövde sunucuda ayrıştırma hatası üretir. Uç gövdeyi
          // okumaz, bu yüzden boş nesne gönderilir.
          { method: 'POST', body: '{}' },
        ),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'cancel response invalid')
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
    async apply(caseId, runId, input, idempotencyKey) {
      const key = idempotencyKey ?? globalThis.crypto?.randomUUID?.()
      if (key === undefined) {
        throw new LaborAllocationClientError('unavailable', 'secure idempotency unavailable')
      }
      const { laborAllocationApplyResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationApplyResponseSchema.safeParse(
        await request(
          `/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-ai/${encodeURIComponent(runId)}/apply`,
          { method: 'POST', body: JSON.stringify(input), headers: { 'idempotency-key': key } },
        ),
      )
      if (!parsed.success) throw new LaborAllocationClientError('unavailable', 'apply response invalid')
      return parsed.data.application as unknown as LaborAllocationApplicationRecord
    },
    async listApplications(caseId) {
      const { laborAllocationApplicationsResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAllocationApplicationsResponseSchema.safeParse(
        await request(`/api/v1/cases/${encodeURIComponent(caseId)}/labor-allocation-applications`),
      )
      if (!parsed.success) {
        throw new LaborAllocationClientError('unavailable', 'applications response invalid')
      }
      return parsed.data.applications as unknown as readonly LaborAllocationApplicationRecord[]
    },
  }
}
