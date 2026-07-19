import type pg from 'pg'
import {
  laborAllocationApplicationsResponseSchema,
  laborAllocationApplyPreviewResponseSchema,
  laborAllocationApplyResponseSchema,
  laborAllocationRunSchema,
  laborAllocationWorkspaceResponseSchema,
  type LaborAllocationApplicationsResponse,
  type LaborAllocationApplyPreviewResponse,
  type LaborAllocationApplyRequest,
  type LaborAllocationApplyResponse,
  type LaborAllocationRunDto,
  type LaborAllocationWorkspaceResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
  LABOR_ALLOCATION_RULE_VERSION,
  LABOR_ALLOCATION_APPLY_SCHEMA_VERSION,
  LABOR_BASELINE_COMPARISON_VERSION,
  LABOR_BASELINE_MATCH_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  baselineMatches,
  mergeLaborAllocationChunks,
  planLaborAllocationChunks,
  LABOR_ALLOCATION_CHUNK_SIZE,
  sha256Text,
  buildLaborAllocationEvidenceHash,
  buildLaborAllocationOutboundContext,
  buildLaborAllocationPlanHash,
  deriveApprovedHistory,
  mergeAppliedLinesIntoSheet,
  validateLaborAllocationApply,
  validateLaborAllocationSuggestion,
  validateLaborSheetItems,
  type LaborAllocationApprovedRecord,
  type LaborAllocationEvidenceLine,
  type LaborAllocationExpertBaseline,
  type LaborAllocationLineSuggestion,
  type LaborAllocationSuggestedLine,
  type LaborAllocationPlanContext,
  type NormalizedLaborItem,
  type OutboundVehicleProfile,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { createLaborSheetVersion } from '../labor/sheet-version.js'
import { loadSheet as loadLaborSheetDto } from '../labor/store.js'
import type { Queryable } from '../db/executor.js'
import {
  LaborAllocationProviderExecutionError,
  type LaborAllocationProviderRegistry,
} from './providers.js'

/**
 * Paket 54 dilim 2 — AI işçilik dağıtımı store'u.
 *
 * Öneri föy sürümünden ayrı aggregate'te saklanır ve föyü DEĞİŞTİRMEZ.
 * Sağlayıcı çıktısı domain doğrulamasından geçmeden hiçbir satır yazılmaz.
 * Sağlayıcı hatası, bütçe aşımı veya egress engelinde gizli fallback yoktur.
 */
export type LaborAllocationErrorCode =
  | 'CASE_NOT_FOUND'
  | 'CASE_CLOSED'
  | 'LABOR_SHEET_NOT_FOUND'
  | 'SHEET_VERSION_STALE'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_REVIEWABLE'
  | 'RUN_STALE'
  | 'LINE_SELECTION_INVALID'
  | 'EGRESS_CONFIRMATION_REQUIRED'
  // Paket 58: uygulama yolu.
  | 'RUN_ALREADY_APPLIED'
  | 'APPLY_LINES_INVALID'
  | 'IDEMPOTENCY_CONFLICT'
  // Paket 62: ilerleme ve iptal.
  | 'ANALYSIS_ALREADY_RUNNING'
  | 'RUN_NOT_CANCELLABLE'

export class LaborAllocationError extends Error {
  constructor(readonly code: LaborAllocationErrorCode, readonly status: number) {
    super(code)
    this.name = 'LaborAllocationError'
  }
}

interface Actor {
  readonly organizationId: string
  readonly userId: string
  /** Audit kaydı için istek kimliği; yalnız yazma yollarında gerekir. */
  readonly requestId?: string
}

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

interface SheetSnapshot {
  readonly sheetId: string
  readonly sheetVersion: number
  readonly lines: readonly NormalizedLaborItem[]
}

async function loadCase(
  pool: Queryable,
  organizationId: string,
  caseId: string,
): Promise<{ caseType: 'traffic' | 'casco'; version: number; closed: boolean }> {
  const result = await pool.query(
    `SELECT case_type,version,lifecycle_status FROM cases
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, caseId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) throw new LaborAllocationError('CASE_NOT_FOUND', 404)
  return {
    caseType: row.case_type as 'traffic' | 'casco',
    version: safeNumber(row.version),
    closed: row.lifecycle_status === 'closed',
  }
}

async function loadSheet(
  pool: Queryable,
  organizationId: string,
  caseId: string,
): Promise<SheetSnapshot | null> {
  const sheet = await pool.query(
    `SELECT s.id::text AS sheet_id, v.sheet_version
       FROM labor_sheets s
       JOIN labor_sheet_versions v ON v.organization_id=s.organization_id AND v.id=s.current_version_id
      WHERE s.organization_id=$1 AND s.case_id=$2`,
    [organizationId, caseId],
  )
  const row = sheet.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) return null
  const items = await pool.query(
    `SELECT i.description,i.action,i.part_amount_minor::text AS part,i.labor_amount_minor::text AS labor,
            i.part_code,i.part_code_source,i.damage_region
       FROM labor_sheet_items i
       JOIN labor_sheets s ON s.organization_id=i.organization_id AND s.current_version_id=i.sheet_version_id
      WHERE i.organization_id=$1 AND i.case_id=$2
      ORDER BY i.ordinal`,
    [organizationId, caseId],
  )
  return {
    sheetId: String(row.sheet_id),
    sheetVersion: safeNumber(row.sheet_version),
    lines: (items.rows as Record<string, unknown>[]).map((item) => ({
      description: String(item.description),
      action: String(item.action),
      partAmountMinor: safeNumber(item.part),
      laborAmountMinor: safeNumber(item.labor),
      partCode: item.part_code === null ? null : String(item.part_code),
      partCodeSource: item.part_code_source === null
        ? null
        : String(item.part_code_source) as 'user_entered' | 'dictionary_suggested',
      damageRegion: item.damage_region === null ? null : String(item.damage_region),
    })),
  }
}

/**
 * Eksper baseline: aynı dosyanın bir önceki onaylı föy sürümü.
 *
 * Kaynak yalnız `labor_sheet_versions`tir. Bu tablodaki her sürüm açık
 * kullanıcı onayıyla (`confirmed: true`) oluşur ve immutable'dır; AI önerileri
 * `labor_allocation_*` aggregate'inde durur ve buraya asla giremez.
 *
 * Tenant sınırı sorgunun kendisinde uygulanır: organization dışındaki hiçbir
 * dosyanın sonucu okunmaz.
 */
async function loadExpertBaseline(
  pool: pg.Pool,
  organizationId: string,
  caseId: string,
  currentSheetVersion: number,
): Promise<LaborAllocationExpertBaseline | null> {
  if (currentSheetVersion <= 1) return null
  const version = await pool.query(
    `SELECT v.id::text AS version_id, v.sheet_version
       FROM labor_sheet_versions v
      WHERE v.organization_id=$1 AND v.case_id=$2 AND v.sheet_version=$3`,
    [organizationId, caseId, currentSheetVersion - 1],
  )
  const row = version.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) return null
  const items = await pool.query(
    `SELECT i.ordinal,i.description,i.action,
            i.part_amount_minor::text AS part,i.labor_amount_minor::text AS labor,
            i.part_code,i.damage_region
       FROM labor_sheet_items i
      WHERE i.organization_id=$1 AND i.case_id=$2 AND i.sheet_version_id=$3
      ORDER BY i.ordinal`,
    [organizationId, caseId, String(row.version_id)],
  )
  if (items.rows.length === 0) return null
  return {
    sheetVersion: safeNumber(row.sheet_version),
    lines: (items.rows as Record<string, unknown>[]).map((item) => ({
      ordinal: safeNumber(item.ordinal),
      description: String(item.description),
      action: String(item.action),
      partAmountMinor: safeNumber(item.part),
      laborAmountMinor: safeNumber(item.labor),
      partCode: item.part_code === null ? null : String(item.part_code),
      damageRegion: item.damage_region === null ? null : String(item.damage_region),
    })),
  }
}

/** Uygulama kaydını satır snapshot'larıyla birlikte okur. */
async function readApplication(
  executor: Queryable,
  organizationId: string,
  caseId: string,
  applicationId: string,
): Promise<LaborAllocationApplyResponse> {
  const row = await executor.query(
    `SELECT a.id::text,a.case_id::text,a.run_id::text,a.apply_schema_version,a.status,
            a.source_sheet_version,a.target_sheet_version,a.selected_line_count,
            a.rejected_line_count,a.modified_line_count,a.control_required_line_count,
            a.created_at,a.completed_at,u.display_name
       FROM labor_allocation_applications a
       JOIN users u ON u.id=a.applied_by_user_id
      WHERE a.organization_id=$1 AND a.case_id=$2 AND a.id=$3`,
    [organizationId, caseId, applicationId],
  )
  const application = row.rows[0] as Record<string, unknown> | undefined
  if (application === undefined) throw new LaborAllocationError('RUN_NOT_FOUND', 404)
  const lines = await executor.query(
    `SELECT line_ordinal,suggestion_line_ordinal,target_line_ordinal,
            suggested_description,suggested_action,
            suggested_part_amount_minor::text AS suggested_part,
            suggested_labor_amount_minor::text AS suggested_labor,
            suggested_operation_types,applied_description,applied_action,
            applied_part_amount_minor::text AS applied_part,
            applied_labor_amount_minor::text AS applied_labor,
            modified,control_required
       FROM labor_allocation_applied_lines
      WHERE organization_id=$1 AND application_id=$2
      ORDER BY line_ordinal`,
    [organizationId, applicationId],
  )
  const sheet = await loadLaborSheetDto(executor, organizationId, caseId)
  if (sheet === undefined) throw new LaborAllocationError('LABOR_SHEET_NOT_FOUND', 404)
  return laborAllocationApplyResponseSchema.parse({
    application: {
      id: String(application.id),
      caseId: String(application.case_id),
      runId: String(application.run_id),
      applySchemaVersion: LABOR_ALLOCATION_APPLY_SCHEMA_VERSION,
      status: String(application.status),
      sourceSheetVersion: safeNumber(application.source_sheet_version),
      targetSheetVersion: application.target_sheet_version === null
        ? null
        : safeNumber(application.target_sheet_version),
      selectedLineCount: safeNumber(application.selected_line_count),
      rejectedLineCount: safeNumber(application.rejected_line_count),
      modifiedLineCount: safeNumber(application.modified_line_count),
      controlRequiredLineCount: safeNumber(application.control_required_line_count),
      appliedByDisplayName: String(application.display_name),
      createdAt: new Date(String(application.created_at)).toISOString(),
      completedAt: application.completed_at === null
        ? null
        : new Date(String(application.completed_at)).toISOString(),
      lines: (lines.rows as Record<string, unknown>[]).map((line) => ({
        lineOrdinal: safeNumber(line.line_ordinal),
        suggestionLineOrdinal: safeNumber(line.suggestion_line_ordinal),
        targetLineOrdinal: safeNumber(line.target_line_ordinal),
        suggestedDescription: String(line.suggested_description),
        suggestedAction: String(line.suggested_action),
        suggestedPartAmountMinor: safeNumber(line.suggested_part),
        suggestedLaborAmountMinor: safeNumber(line.suggested_labor),
        suggestedOperationTypes: (line.suggested_operation_types ?? []) as never,
        appliedDescription: String(line.applied_description),
        appliedAction: String(line.applied_action),
        appliedPartAmountMinor: safeNumber(line.applied_part),
        appliedLaborAmountMinor: safeNumber(line.applied_labor),
        modified: Boolean(line.modified),
        controlRequired: Boolean(line.control_required),
      })),
    },
    sheet,
  })
}

interface ProviderPolicy {
  readonly enabled: boolean
  readonly allowedProviderIds: readonly string[]
  readonly monthlyBudgetMinor: number
  readonly perRequestBudgetMinor: number
  readonly requestTimeoutMs: number
}

/**
 * Politika YALNIZ organization satırından okunur. Satır yoksa sağlayıcı
 * kapalıdır: opt-in olmadan hiçbir dış çağrı yapılmaz.
 */
async function loadPolicy(pool: pg.Pool, organizationId: string): Promise<ProviderPolicy> {
  const result = await pool.query(
    `SELECT labor_allocation_enabled,labor_allocation_allowed_provider_ids,
            monthly_budget_minor,per_request_budget_minor,request_timeout_ms
       FROM ai_provider_policies WHERE organization_id=$1`,
    [organizationId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) {
    return {
      enabled: false,
      allowedProviderIds: [],
      monthlyBudgetMinor: 0,
      perRequestBudgetMinor: 0,
      requestTimeoutMs: 5_000,
    }
  }
  return {
    enabled: Boolean(row.labor_allocation_enabled),
    allowedProviderIds: (row.labor_allocation_allowed_provider_ids ?? []) as string[],
    monthlyBudgetMinor: safeNumber(row.monthly_budget_minor),
    perRequestBudgetMinor: safeNumber(row.per_request_budget_minor),
    requestTimeoutMs: safeNumber(row.request_timeout_ms) || 5_000,
  }
}

async function currentMonthCost(pool: pg.Pool, organizationId: string): Promise<number> {
  const result = await pool.query(
    `SELECT coalesce(sum(actual_cost_minor),0)::text AS total
       FROM ai_usage_ledger
      WHERE organization_id=$1 AND actual_cost_minor IS NOT NULL
        AND started_at>=date_trunc('month',now())`,
    [organizationId],
  )
  return safeNumber((result.rows[0] as Record<string, unknown>).total)
}

function budgetView(
  policy: ProviderPolicy,
  providerAvailable: boolean,
  providerAllowed: boolean,
  estimatedCostMinor: number,
  monthCost: number,
) {
  const reasonCode = !providerAvailable
    ? 'AI_PROVIDER_NOT_CONFIGURED' as const
    : !policy.enabled || !providerAllowed
      ? 'AI_PROVIDER_DISABLED' as const
      : (monthCost + estimatedCostMinor > policy.monthlyBudgetMinor
        || estimatedCostMinor > policy.perRequestBudgetMinor)
        ? 'AI_BUDGET_EXCEEDED' as const
        : null
  return {
    enabled: policy.enabled,
    providerAvailable,
    providerAllowed,
    estimatedCostMinor,
    currentMonthCostMinor: monthCost,
    monthlyBudgetMinor: policy.monthlyBudgetMinor,
    perRequestBudgetMinor: policy.perRequestBudgetMinor,
    allowed: reasonCode === null,
    reasonCode,
  }
}

type RunRow = Record<string, unknown>

/**
 * İlerlemeyi mevcut kayıtlardan TÜRETİR (Paket 62).
 *
 * Sahte yüzde veya tahmini kalan süre üretilmez. Tamamlanan chunk sayısı
 * sağlayıcı makbuzlarından sayılır; chunk'lar sırayla işlendiği ve yalnız son
 * chunk kısmi olabildiği için `tamamlanan × boyut` işlenen satırı tam verir
 * (toplam satırla sınırlanır).
 */
function buildProgress(row: RunRow) {
  const totalLineCount = row.total_line_count === null ? 0 : safeNumber(row.total_line_count)
  const totalChunkCount = row.total_chunk_count === null ? 0 : safeNumber(row.total_chunk_count)
  const chunkSize = row.chunk_size === null ? 0 : safeNumber(row.chunk_size)
  const completedChunkCount = Math.min(safeNumber(row.completed_chunk_count), totalChunkCount)
  const status = String(row.status)
  // Tamamlanmış run'da ilerleme sonucu yansıtır; makbuz sayımına bağlı kalmaz.
  const processedLineCount = status === 'review_required'
    ? totalLineCount
    : Math.min(completedChunkCount * chunkSize, totalLineCount)
  return {
    totalLineCount,
    processedLineCount,
    totalChunkCount,
    completedChunkCount,
    startedAt: row.started_at === null ? null : (row.started_at as Date).toISOString(),
    updatedAt: row.progress_updated_at === null
      ? null
      : (row.progress_updated_at as Date).toISOString(),
    cancelRequestedAt: row.cancel_requested_at === null
      ? null
      : (row.cancel_requested_at as Date).toISOString(),
  }
}

async function mapRun(
  pool: pg.Pool,
  organizationId: string,
  row: RunRow,
  currentSheetVersion: number | null,
  budget: ReturnType<typeof budgetView>,
): Promise<LaborAllocationRunDto> {
  const runId = String(row.id)
  const status = String(row.status)
  let suggestion: LaborAllocationRunDto['suggestion'] = null
  if (status === 'review_required') {
    const lines = await pool.query(
      `SELECT line_ordinal,source_description,source_action,
              source_part_amount_minor::text AS part,source_labor_amount_minor::text AS labor,
              allocations,repair_replace_opinion,economic_buckets,
              economic_repair_total_minor::text AS repair_total,
              economic_replace_total_minor::text AS replace_total,
              economic_note,reasoning,evidence_refs,confidence,
              conflict_codes,missing_evidence_codes,control_required,
              baseline_part_amount_minor::text AS baseline_part,
              baseline_labor_amount_minor::text AS baseline_labor,
              baseline_part_ratio,baseline_suggested_part_ratio,baseline_conflict
         FROM labor_allocation_line_suggestions
        WHERE organization_id=$1 AND run_id=$2
        ORDER BY line_ordinal`,
      [organizationId, runId],
    )
    suggestion = {
      schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
      operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
      ruleVersion: LABOR_ALLOCATION_RULE_VERSION,
      requiresHumanReview: true,
      lines: (lines.rows as Record<string, unknown>[]).map((line) => ({
        lineOrdinal: safeNumber(line.line_ordinal),
        sourceDescription: String(line.source_description),
        sourceAction: String(line.source_action),
        sourcePartAmountMinor: safeNumber(line.part),
        sourceLaborAmountMinor: safeNumber(line.labor),
        allocations: line.allocations as LaborAllocationRunDto['suggestion'] extends null ? never
          : { operationType: (typeof LABOR_OPERATION_TYPES)[number]; amountMinor: number }[],
        repairReplaceOpinion: line.repair_replace_opinion as 'repair_indicated',
        economicComparison: {
          buckets: line.economic_buckets as Record<(typeof LABOR_ECONOMIC_BUCKETS)[number], number>,
          repairTotalMinor: safeNumber(line.repair_total),
          replaceTotalMinor: safeNumber(line.replace_total),
          note: String(line.economic_note),
        },
        reasoning: String(line.reasoning),
        evidenceRefs: (line.evidence_refs ?? []) as string[],
        confidence: Number(line.confidence),
        conflictCodes: (line.conflict_codes ?? []) as never,
        missingEvidenceCodes: (line.missing_evidence_codes ?? []) as never,
        controlRequired: Boolean(line.control_required),
        // Baseline eşleşmemişse tüm alanlar birlikte null'dır (DB CHECK).
        // Not: sütun `baseline_part` olarak takma adlandırıldı; ham sütun adı
        // burada undefined olur ve kontrolü sessizce bozar.
        baseline: line.baseline_part === null ? null : {
          comparisonVersion: LABOR_BASELINE_COMPARISON_VERSION,
          baselineSheetVersion: safeNumber(row.baseline_sheet_version),
          baselinePartAmountMinor: safeNumber(line.baseline_part),
          baselineLaborAmountMinor: safeNumber(line.baseline_labor),
          baselinePartRatio: Number(line.baseline_part_ratio),
          suggestedPartRatio: Number(line.baseline_suggested_part_ratio),
          deltaRatio: Math.abs(
            Number(line.baseline_part_ratio) - Number(line.baseline_suggested_part_ratio),
          ),
          conflicts: Boolean(line.baseline_conflict),
        },
      })),
    }
  }
  return laborAllocationRunSchema.parse({
    id: runId,
    caseId: String(row.case_id),
    status,
    providerId: String(row.provider_id),
    providerVersion: String(row.provider_version),
    modelId: String(row.model_id),
    promptTemplateVersion: LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
    outputSchemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    ruleVersion: LABOR_ALLOCATION_RULE_VERSION,
    baselineSheetVersion: row.baseline_sheet_version === null
      ? null
      : safeNumber(row.baseline_sheet_version),
    baselineMatchVersion: row.baseline_match_version === null
      ? null
      : LABOR_BASELINE_MATCH_VERSION,
    baselineMatchedLineCount: safeNumber(row.baseline_matched_line_count),
    progress: buildProgress(row),
    sourceSheetId: String(row.source_sheet_id),
    sourceSheetVersion: safeNumber(row.source_sheet_version),
    evidenceHash: String(row.evidence_hash),
    planHash: String(row.plan_hash),
    version: safeNumber(row.version),
    privacy: {
      externalProvider: Boolean(row.external_provider),
      policyVersion: String(row.privacy_policy_version),
      outboundPayloadHash: row.outbound_payload_hash === null ? null : String(row.outbound_payload_hash),
      outboundInputCharacters: safeNumber(row.outbound_input_characters),
      redactedValueCount: safeNumber(row.redacted_value_count),
      redactedCategories: (row.redacted_categories ?? []) as never,
      retentionMode: String(row.provider_retention_mode) as 'local_only',
      warnings: (row.privacy_warnings ?? []) as string[],
    },
    budget,
    suggestion,
    safeErrorCode: row.safe_error_code === null ? null : String(row.safe_error_code),
    // Kaynak föy öneriden sonra değiştiyse öneri uygulanamaz.
    stale: currentSheetVersion === null || safeNumber(row.source_sheet_version) !== currentSheetVersion,
    createdAt: (row.created_at as Date).toISOString(),
    startedAt: row.started_at === null ? null : (row.started_at as Date).toISOString(),
    completedAt: row.completed_at === null ? null : (row.completed_at as Date).toISOString(),
  })
}

const RUN_COLUMNS = `id::text,case_id::text,source_sheet_id::text,source_sheet_version,evidence_hash,
  plan_hash,provider_id,provider_version,model_id,status,external_provider,privacy_policy_version,
  outbound_payload_hash,outbound_input_characters,redacted_value_count,redacted_categories,
  privacy_warnings,provider_retention_mode,safe_error_code,version,created_at,started_at,completed_at,
  baseline_sheet_version,baseline_match_version,baseline_matched_line_count,
  total_line_count,total_chunk_count,chunk_size,cancel_requested_at,progress_updated_at,
  /*
   * Paket 62: ilerleme İKİNCİ BİR KAYIT SİSTEMİNDEN değil, mevcut sağlayıcı
   * makbuzlarından türetilir. Chunk'lar sırayla işlendiği için tamamlanmış
   * chunk sayısı × chunk boyutu işlenen satırı verir (son chunk hariç hepsi
   * tam boyuttur; toplam satırla sınırlanır).
   */
  (SELECT count(*)::int FROM labor_allocation_provider_receipts r
     WHERE r.run_id=labor_allocation_runs.id
       -- Yalnız BAŞARILI alt çağrılar tamamlanmış sayılır; başarısız bir
       -- grubun makbuzu da 'response_recorded' olur ve sayılsaydı ilerleme
       -- olduğundan fazla görünürdü.
       AND r.result_kind='success') AS completed_chunk_count`

export function createLaborAllocationStore(
  pool: pg.Pool,
  registry: LaborAllocationProviderRegistry,
  providerId = 'deterministic-success',
) {
  const adapter = () => registry.get(providerId)
  const audit = createAuditService()
  /**
   * Süreç içi aktif analizler. İptal isteği buradan abort edilir.
   * Kayıt yoksa (ör. run başka bir süreçte) iptal BAŞARILI SAYILMAZ;
   * run  durumunda kalır.
   */
  const activeRuns = new Map<string, AbortController>()

  async function budgetFor(organizationId: string, inputCharacters: number) {
    const policy = await loadPolicy(pool, organizationId)
    const provider = adapter()
    const estimated = provider === undefined ? 0 : provider.estimateCostMinor(inputCharacters)
    return budgetView(
      policy,
      provider !== undefined,
      provider !== undefined && policy.allowedProviderIds.includes(provider.providerId),
      estimated,
      await currentMonthCost(pool, organizationId),
    )
  }

  return {
    async workspace(actor: Actor, caseId: string): Promise<LaborAllocationWorkspaceResponse> {
      const caseRow = await loadCase(pool, actor.organizationId, caseId)
      const sheet = await loadSheet(pool, actor.organizationId, caseId)
      const budget = await budgetFor(actor.organizationId, 1)
      const runs = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at DESC LIMIT 200`,
        [actor.organizationId, caseId],
      )
      const provider = adapter()
      return laborAllocationWorkspaceResponseSchema.parse({
        caseId,
        caseVersion: caseRow.version,
        caseClosed: caseRow.closed,
        sourceSheetId: sheet?.sheetId ?? null,
        sourceSheetVersion: sheet?.sheetVersion ?? null,
        sourceLineCount: sheet?.lines.length ?? 0,
        promptTemplateVersion: LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
        outputSchemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
        operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
        ruleVersion: LABOR_ALLOCATION_RULE_VERSION,
        operationTypes: LABOR_OPERATION_TYPES,
        economicBuckets: LABOR_ECONOMIC_BUCKETS,
        budget,
        runs: await Promise.all((runs.rows as RunRow[]).map(
          (row) => mapRun(pool, actor.organizationId, row, sheet?.sheetVersion ?? null, budget),
        )),
        permissions: {
          canAnalyze: !caseRow.closed && sheet !== null && sheet.lines.length > 0 && budget.allowed,
          requiresExplicitEgressConfirmation: provider?.externalProvider ?? false,
        },
      })
    },

    async getRun(actor: Actor, caseId: string, runId: string): Promise<LaborAllocationRunDto> {
      const sheet = await loadSheet(pool, actor.organizationId, caseId)
      const result = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
        [actor.organizationId, caseId, runId],
      )
      const row = result.rows[0] as RunRow | undefined
      if (row === undefined) throw new LaborAllocationError('RUN_NOT_FOUND', 404)
      const budget = await budgetFor(actor.organizationId, safeNumber(row.outbound_input_characters))
      return mapRun(pool, actor.organizationId, row, sheet?.sheetVersion ?? null, budget)
    },

    async analyze(
      actor: Actor,
      caseId: string,
      input: { expectedSheetVersion: number; damageDescription: string; confirmedEgress: boolean },
    ): Promise<LaborAllocationRunDto> {
      const caseRow = await loadCase(pool, actor.organizationId, caseId)
      if (caseRow.closed) throw new LaborAllocationError('CASE_CLOSED', 409)
      const sheet = await loadSheet(pool, actor.organizationId, caseId)
      if (sheet === null || sheet.lines.length === 0) {
        throw new LaborAllocationError('LABOR_SHEET_NOT_FOUND', 404)
      }
      if (sheet.sheetVersion !== input.expectedSheetVersion) {
        throw new LaborAllocationError('SHEET_VERSION_STALE', 409)
      }
      const provider = adapter()
      const dictionary = await pool.query(
        `SELECT i.description,i.action,count(*)::int AS usage_count
           FROM labor_sheet_items i
           JOIN labor_sheets s ON s.organization_id=i.organization_id AND s.current_version_id=i.sheet_version_id
          WHERE i.organization_id=$1
          GROUP BY i.description,i.action ORDER BY count(*) DESC LIMIT 50`,
        [actor.organizationId],
      )
      /*
       * Paket 58: onaylı geçmiş artık GERÇEK provenance'tan beslenir.
       *
       * Yalnız `completed` uygulama kayıtları okunur: ham öneri, önizleme ve
       * reddedilen satırlar kanıt değildir. Kullanıcı öneriyi değiştirerek
       * uyguladıysa öğrenme örneği UYGULANAN değerdir, AI'nin ilk önerisi
       * değil — bu yüzden `applied_*` sütunları okunur.
       *
       * Organization sınırı sorguda uygulanır; mevcut run domain tarafında
       * ayrıca dışlanır (kendi çıktısı kendi girdisine geçmiş olamaz).
       */
      const approvedRows = await pool.query(
        `SELECT a.run_id::text AS run_id,l.applied_description AS description,
                l.applied_action AS action,
                l.applied_part_amount_minor::text AS part,
                l.applied_labor_amount_minor::text AS labor,
                l.suggested_operation_types AS operation_types
           FROM labor_allocation_applied_lines l
           JOIN labor_allocation_applications a
             ON a.id=l.application_id AND a.organization_id=l.organization_id
          WHERE l.organization_id=$1 AND a.status='completed'
          ORDER BY a.completed_at DESC LIMIT 200`,
        [actor.organizationId],
      )
      const approvedRecords: readonly LaborAllocationApprovedRecord[] =
        (approvedRows.rows as Record<string, unknown>[]).map((row) => ({
          runId: String(row.run_id),
          description: String(row.description),
          action: String(row.action),
          partAmountMinor: safeNumber(row.part),
          laborAmountMinor: safeNumber(row.labor),
          partCode: null,
          damageRegion: null,
          operationTypes: (row.operation_types ?? []) as never,
        }))
      const history = deriveApprovedHistory(
        sheet.lines.map((line, index) => ({
          ordinal: index + 1,
          description: line.description,
          action: line.action,
          partAmountMinor: line.partAmountMinor,
          laborAmountMinor: line.laborAmountMinor,
          partCode: line.partCode ?? null,
          damageRegion: line.damageRegion ?? null,
        })),
        approvedRecords,
        null,
      )

      // Paket 57: eksper baseline = aynı dosyanın ÖNCEKİ onaylı föy sürümü.
      // Föy sürümleri yalnız açık kullanıcı onayıyla oluşur ve immutable'dır;
      // AI önerileri ayrı aggregate'te durduğu için buraya karışamaz.
      const expertBaseline = await loadExpertBaseline(
        pool, actor.organizationId, caseId, sheet.sheetVersion,
      )

      // Paket 56: dosya düzeyinde araç profili kanıt olarak okunur.
      const vehicleRow = await pool.query(
        `SELECT v.brand,v.model,v.model_year,v.variant,v.vehicle_class,
                v.chassis_prefix,v.engine_code,v.evidence_source
           FROM case_vehicle_profiles p
           JOIN case_vehicle_profile_versions v
             ON v.organization_id=p.organization_id AND v.id=p.current_version_id
          WHERE p.organization_id=$1 AND p.case_id=$2`,
        [actor.organizationId, caseId],
      )
      const vehicle = vehicleRow.rows[0] as Record<string, unknown> | undefined
      const vehicleProfile = vehicle === undefined ? null : {
        brand: String(vehicle.brand),
        model: String(vehicle.model),
        modelYear: safeNumber(vehicle.model_year),
        variant: vehicle.variant === null ? null : String(vehicle.variant),
        vehicleClass: String(vehicle.vehicle_class) as OutboundVehicleProfile['vehicleClass'],
        chassisPrefix: vehicle.chassis_prefix === null ? null : String(vehicle.chassis_prefix),
        engineCode: vehicle.engine_code === null ? null : String(vehicle.engine_code),
        evidenceSource: String(vehicle.evidence_source) as OutboundVehicleProfile['evidenceSource'],
      }

      const planContext: LaborAllocationPlanContext = {
        organizationId: actor.organizationId,
        caseId,
        caseVersion: caseRow.version,
        caseType: caseRow.caseType,
        sheetId: sheet.sheetId,
        sheetVersion: sheet.sheetVersion,
        damageDescription: input.damageDescription,
        lines: sheet.lines,
        vehicleProfile,
        dictionary: (dictionary.rows as Record<string, unknown>[]).map((row) => ({
          description: String(row.description),
          action: String(row.action),
          usageCount: safeNumber(row.usage_count),
        })),
        approvedHistory: history.entries.map((entry) => ({
          description: entry.description,
          action: entry.action,
          operationTypes: entry.operationTypes,
        })),
        approvedHistoryComplete: history.complete,
        expertBaseline,
        providerId: provider?.providerId ?? 'deterministic-success',
        providerVersion: provider?.providerVersion ?? '1.0.0',
        modelId: provider?.modelId ?? 'deterministic',
        externalProvider: provider?.externalProvider ?? false,
        retentionMode: provider?.retentionMode ?? 'local_only',
        pricingVersion: provider?.pricingVersion ?? 'labor-allocation-deterministic/1.0.0',
      }
      const outbound = buildLaborAllocationOutboundContext(planContext)
      if (outbound.privacyPolicyVersion !== 'labor-allocation-pii/local-only' && !input.confirmedEgress) {
        throw new LaborAllocationError('EGRESS_CONFIRMATION_REQUIRED', 409)
      }
      // Baseline eşleşmeleri sağlayıcı çağrısından ÖNCE hesaplanır: hangi
      // baseline'ın kullanıldığı run kimliğinin parçasıdır ve sonradan
      // değiştirilemez.
      const matched = new Map(
        baselineMatches(planContext)
          .filter((match) => match.baseline !== null)
          .map((match) => [match.ordinal, match.baseline as LaborAllocationEvidenceLine]),
      )
      const baselineMatchedCount = matched.size
      const evidenceHash = buildLaborAllocationEvidenceHash(planContext)
      const planHash = buildLaborAllocationPlanHash(planContext, outbound)
      const budget = await budgetFor(actor.organizationId, outbound.outboundInputCharacters)
      const requestTimeoutMs = (await loadPolicy(pool, actor.organizationId)).requestTimeoutMs

      // Aynı analiz anahtarı için tekrar koruması: BAŞARILI sonuç yeniden
      // hesaplanmaz. Başarısız/engellenmiş çalıştırma yeniden denenebilir.
      const existing = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 AND plan_hash=$3
            AND provider_id=$4 AND provider_version=$5 AND model_id=$6
            AND prompt_template_version=$7 AND output_schema_version=$8 AND operation_types_version=$9
            AND status='review_required'`,
        [
          actor.organizationId, caseId, planHash, planContext.providerId, planContext.providerVersion,
          planContext.modelId, LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
          LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION, LABOR_OPERATION_TYPES_VERSION,
        ],
      )
      if (existing.rows.length > 0) {
        return mapRun(pool, actor.organizationId, existing.rows[0] as RunRow, sheet.sheetVersion, budget)
      }

      /*
       * Paket 62: aynı föy sürümü için ikinci analiz başlatılamaz. Kullanıcı
       * yanlışlıkla tekrar tetiklerse mevcut aktif run döner; ikinci maliyet
       * ve ikinci ilerleme akışı oluşmaz.
       */
      const active = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 AND source_sheet_version=$3
            AND status IN ('queued','running','cancel_requested')
          ORDER BY created_at DESC LIMIT 1`,
        [actor.organizationId, caseId, sheet.sheetVersion],
      )
      if (active.rows.length > 0) {
        throw new LaborAllocationError('ANALYSIS_ALREADY_RUNNING', 409)
      }

      const chunkPlan = planLaborAllocationChunks(sheet.lines.length)
      const runId = uuidv7()
      await pool.query(
        `INSERT INTO labor_allocation_runs
           (id,organization_id,case_id,source_sheet_id,source_sheet_version,evidence_hash,plan_hash,
            provider_id,provider_version,model_id,prompt_template_version,output_schema_version,
            operation_types_version,rule_version,external_provider,privacy_policy_version,
            outbound_payload_hash,outbound_input_characters,redacted_value_count,redacted_categories,
            privacy_warnings,provider_retention_mode,pricing_version,estimated_cost_minor,
            created_by_user_id,baseline_sheet_version,baseline_match_version,
            baseline_matched_line_count,status,
            total_line_count,total_chunk_count,chunk_size,progress_updated_at,started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                 $26,$27,$28,'queued',$29,$30,$31,now(),now())`,
        [
          runId, actor.organizationId, caseId, sheet.sheetId, sheet.sheetVersion, evidenceHash, planHash,
          planContext.providerId, planContext.providerVersion, planContext.modelId,
          LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION, LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
          LABOR_OPERATION_TYPES_VERSION, LABOR_ALLOCATION_RULE_VERSION,
          planContext.externalProvider, outbound.privacyPolicyVersion, outbound.outboundPayloadHash,
          outbound.outboundInputCharacters, outbound.redactedValueCount, outbound.redactedCategories,
          outbound.warnings, planContext.retentionMode, planContext.pricingVersion,
          budget.estimatedCostMinor, actor.userId,
          expertBaseline?.sheetVersion ?? null,
          expertBaseline === null ? null : LABOR_BASELINE_MATCH_VERSION,
          baselineMatchedCount,
          sheet.lines.length,
          chunkPlan.length,
          LABOR_ALLOCATION_CHUNK_SIZE,
        ],
      )

      /*
       * Paket 62 — analiz ARKA PLANDA çalışır.
       *
       * Uç, run kimliğini ve `queued` durumunu hemen döndürür; kullanıcı
       * sayfadan ayrılsa bile iş devam eder ve geri döndüğünde mevcut durum
       * okunabilir. Bu, 100 satırlık föyde ~85 sn boyunca donmuş görünen
       * ekranı ortadan kaldırır.
       */
      const executeRun = async (): Promise<void> => {
      /*
       * Sağlayıcı kullanımı `finalize` closure'ından okunduğu için bildirim
       * closure'dan ÖNCE yapılır. Aksi halde sağlayıcı çağrılmadan sonlanan
       * yollarda (provider_disabled, budget_blocked) temporal dead zone
       * hatası oluşur; eski kod bundan yalnız ternary kısa devresi sayesinde
       * kazara kaçınıyordu.
       */
      let providerUsage: {
        inputTokens: number | null
        outputTokens: number | null
        outputCharacters: number
        actualCostMinor: number
      } | null = null

      const finalize = async (
        status: string,
        safeErrorCode: string | null,
        lineCount: number | null,
        controlRequiredCount: number | null,
      ) => {
        await pool.query(
          `UPDATE labor_allocation_runs
              SET status=$2,safe_error_code=$3,line_count=$4,control_required_count=$5,
                  completed_at=now(),version=version+1
            WHERE id=$1`,
          [runId, status, safeErrorCode, lineCount, controlRequiredCount],
        )
        await pool.query(
          /*
           * Paket 61: gerçekleşen çıktı karakteri ve TOKEN sayıları da ledger'a
           * yazılır. Önceden yalnız karakter/maliyet vardı ve `output_characters`
           * sabit 0 geçiliyordu; yük ölçümünde ledger gerçek kullanımı
           * taşımadığı için maliyet takibi eksik kalıyordu.
           *
           * Token alanları DB kısıtı gereği birlikte null ya da birlikte dolu
           * olmalıdır; sağlayıcı kullanım bildirmediyse ikisi de null kalır.
           */
          `INSERT INTO ai_usage_ledger
             (id,organization_id,case_id,usage_module,labor_allocation_run_id,provider_id,model_id,
              request_hash,input_characters,output_characters,estimated_cost_minor,actual_cost_minor,
              status,safe_error_code,input_tokens,output_tokens,started_at,completed_at)
           VALUES ($1,$2,$3,'labor_allocation',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())`,
          [
            uuidv7(), actor.organizationId, caseId, runId, planContext.providerId, planContext.modelId,
            planHash, outbound.outboundInputCharacters,
            providerUsage?.outputCharacters ?? 0,
            budget.estimatedCostMinor,
            // Gerçek maliyet sağlayıcı kullanımından gelir; yoksa tahmin kullanılır.
            status === 'review_required'
              ? (providerUsage?.actualCostMinor ?? budget.estimatedCostMinor)
              : null,
            status === 'review_required' ? 'completed'
              : status === 'budget_blocked' ? 'budget_blocked'
                : status === 'provider_disabled' ? 'provider_disabled' : 'failed',
            safeErrorCode,
            // DB kısıtı: ikisi birlikte null ya da birlikte dolu.
            providerUsage?.inputTokens ?? null,
            providerUsage?.inputTokens === null || providerUsage?.inputTokens === undefined
              ? null
              : (providerUsage.outputTokens ?? null),
          ],
        )
      }

      // Bütçe/politika engeli: sahte sonuç veya kural tabanlı fallback YOK.
      if (!budget.allowed) {
        const status = budget.reasonCode === 'AI_BUDGET_EXCEEDED' ? 'budget_blocked' : 'provider_disabled'
        await finalize(status, budget.reasonCode ?? 'AI_PROVIDER_DISABLED', null, null)
        return
      }
      if (provider === undefined) {
        await finalize('provider_disabled', 'AI_PROVIDER_NOT_CONFIGURED', null, null)
        return
      }

      /*
       * Paket 61 — büyük föylerde deterministik chunking (HB-2026-068).
       *
       * Gerçek Gemini yük ölçümü (2026-07-19) tek çağrının 50+ satırda 30 sn'lik
       * politika tavanına çarptığını gösterdi. Tavan YÜKSELTİLMEDİ; iş sabit ve
       * sürümlü gruplara bölünüyor. Her grup:
       *  - dosya bağlamını (araç profili, baseline, sözlük, hasar tarifi) taşır,
       *  - kendi sağlayıcı makbuzunu ve kendi timeout'unu alır,
       *  - domain doğrulamasından AYRI geçer.
       * Sonuçlar sunucuda birleşir; tek bir eksik/tekrarlı satır bile TÜM run'ı
       * başarısız kılar. Gizli tek-çağrı fallback YOKTUR.
       */
      // Satır önerileri yalnız `running` run'a eklenebilir (0036 guard).
      await pool.query(
        `UPDATE labor_allocation_runs
            SET status='running',progress_updated_at=now(),version=version+1
          WHERE id=$1 AND status='queued'`,
        [runId],
      )
      const cancelled = async (): Promise<boolean> => {
        const state = await pool.query('SELECT status FROM labor_allocation_runs WHERE id=$1', [runId])
        return String((state.rows[0] as Record<string, unknown>).status) === 'cancel_requested'
      }

      const chunks = planLaborAllocationChunks(sheet.lines.length)
      const chunkResults: (readonly LaborAllocationLineSuggestion[] | null)[] = []
      let usageInputTokens: number | null = null
      let usageOutputTokens: number | null = null
      let usageOutputCharacters = 0
      let usageActualCostMinor = 0

      for (const chunk of chunks) {
        // Her grup öncesi iptal kontrolü: iptal edilen run yeni maliyet üretmez.
        if (await cancelled()) {
          await finalize('cancelled', 'AI_RUN_CANCELLED', null, null)
          return
        }
        const chunkLines = sheet.lines.slice(
          chunk.startOrdinal - 1,
          chunk.startOrdinal - 1 + chunk.lineCount,
        )
        // Dosya bağlamı korunur; yalnız satır alt kümesi değişir.
        const chunkOutbound = buildLaborAllocationOutboundContext({
          ...planContext,
          lines: chunkLines,
        })

        const receiptId = uuidv7()
        /*
         * Makbuz kimlikleri sözleşme gereği 64 hex karakterdir (0031 CHECK) ve
         * `(organization_id, run_id, request_hash)` ile `(organization_id,
         * client_request_id)` üzerinde tekildir. Chunk başına ayrı makbuz
         * gerektiği için ikisi de plan hash'inden DETERMİNİSTİK türetilir;
         * kısıtlar gevşetilmez ve aynı analiz anahtarı aynı chunk kimliklerini
         * üretmeye devam eder. Tek gruplu föyde davranış değişmez.
         */
        /*
         * Paket 62: kimlik RUN'dan türetilir, plan hash'inden değil.
         *
         * Plan hash'i kullanıldığında başarısız bir run'dan sonra YENİDEN
         * DENEME aynı makbuz kimliğine çarpıp yeni run'ı da düşürüyordu.
         * Mükerrer maliyet koruması run seviyesindeki idempotency indeksinde
         * (yalnız `review_required`) durur; makbuz kimliği ise bir run
         * içindeki alt çağrıları ayırır.
         */
        const chunkHash = sha256Text(`${runId}:chunk:${chunk.index}`)
        await pool.query(
          `INSERT INTO labor_allocation_provider_receipts
             (id,organization_id,case_id,run_id,request_hash,client_request_id,provider_id,
              provider_version,model_id,input_characters,estimated_cost_minor,pricing_version,
              created_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,$14,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            receiptId, actor.organizationId, caseId, runId, chunkHash,
            planContext.providerId, planContext.providerVersion, planContext.modelId,
            chunkOutbound.outboundInputCharacters, budget.estimatedCostMinor,
            planContext.pricingVersion, actor.userId,
            // `request_id` metindir; run kimliğiyle aynı parametreyi paylaşamaz
            // (PostgreSQL uuid/text tipini tek parametreden çıkaramaz).
            String(runId),
            chunkHash,
          ],
        )

        const controller = new AbortController()
        // İptal isteği aktif çağrıyı abort edebilsin diye kayda alınır.
        activeRuns.set(runId, controller)
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
        let chunkOutput: unknown
        try {
          const response = await provider.execute({
            accountingInputCharacters: chunkOutbound.outboundInputCharacters,
            providerRequestId: `${runId}:${chunk.index}`,
            context: chunkOutbound.context,
          }, controller.signal)
          chunkOutput = response.output
          // Ledger bütün alt çağrıların GERÇEK toplamını taşır.
          if (response.usage.inputTokens !== null) {
            usageInputTokens = (usageInputTokens ?? 0) + response.usage.inputTokens
            usageOutputTokens = (usageOutputTokens ?? 0) + (response.usage.outputTokens ?? 0)
          }
          usageOutputCharacters += response.usage.outputCharacters
          usageActualCostMinor += response.usage.actualCostMinor
          await pool.query(
            `UPDATE labor_allocation_provider_receipts
                SET status='response_recorded',result_kind='success',
                    output_characters=$2,input_tokens=$3,output_tokens=$4,
                    actual_cost_minor=$5,response_received_at=now()
              WHERE id=$1`,
            [
              receiptId, response.usage.outputCharacters,
              response.usage.inputTokens, response.usage.outputTokens,
              response.usage.actualCostMinor,
            ],
          )
        } catch (error) {
          const failure = error instanceof LaborAllocationProviderExecutionError
            ? error
            : new LaborAllocationProviderExecutionError('unknown', 'unknown', 'AI_PROVIDER_FAILED')
          const safeCode = failure.safeDiagnosticCode ?? 'AI_PROVIDER_FAILED'
          // İptal nedeniyle abort edildiyse hata değil iptal olarak sonlanır.
          const cancelRequested = await cancelled()
          await pool.query(
            `UPDATE labor_allocation_provider_receipts
                SET status=$2,result_kind='failure',safe_error_code=$3,
                    response_received_at=CASE WHEN $2='response_recorded' THEN now() ELSE NULL END,
                    finalized_at=CASE WHEN $2='outcome_unknown' THEN now() ELSE NULL END
              WHERE id=$1`,
            [
              receiptId,
              failure.requestOutcome === 'unknown' ? 'outcome_unknown' : 'response_recorded',
              failure.requestOutcome === 'unknown' ? 'AI_PROVIDER_OUTCOME_UNKNOWN' : safeCode,
            ],
          )
          providerUsage = {
            inputTokens: usageInputTokens,
            outputTokens: usageOutputTokens,
            outputCharacters: usageOutputCharacters,
            actualCostMinor: usageActualCostMinor,
          }
          // Bir grup düşerse TÜM run düşer; kısmi sonuç kaydedilmez.
          await finalize(
            cancelRequested
              ? 'cancelled'
              : (failure.requestOutcome === 'unknown' ? 'outcome_unknown' : 'failed'),
            cancelRequested ? 'AI_RUN_CANCELLED' : safeCode,
            null,
            null,
          )
          return
        } finally {
          clearTimeout(timeout)
          activeRuns.delete(runId)
        }

        // Grup tamamlandı: ilerleme zaman damgası tazelenir. Tamamlanan chunk
        // sayısı makbuzlardan sayıldığı için ayrı sayaç tutulmaz.
        await pool.query(
          `UPDATE labor_allocation_runs SET progress_updated_at=now(),version=version+1
            WHERE id=$1 AND status IN ('running','cancel_requested')`,
          [runId],
        )

        // Her grup domain doğrulamasından AYRI geçer.
        const chunkValidation = validateLaborAllocationSuggestion(
          chunkOutput,
          chunkLines,
          chunkOutbound.missingEvidenceCodes,
          // Baseline ve geçmiş eşlemeleri global sıradadır; grup yerel sırasına
          // çevrilir ki doğrulama doğru satırla karşılaştırsın.
          new Map([...matched]
            .filter(([ordinal]) => ordinal >= chunk.startOrdinal
              && ordinal < chunk.startOrdinal + chunk.lineCount)
            .map(([ordinal, value]) => [ordinal - chunk.startOrdinal + 1, value])),
          new Map([...history.byOrdinal]
            .filter(([ordinal]) => ordinal >= chunk.startOrdinal
              && ordinal < chunk.startOrdinal + chunk.lineCount)
            .map(([ordinal, entry]) => [ordinal - chunk.startOrdinal + 1, entry.operationTypes])),
        )
        if (!chunkValidation.allowed) {
          providerUsage = {
            inputTokens: usageInputTokens,
            outputTokens: usageOutputTokens,
            outputCharacters: usageOutputCharacters,
            actualCostMinor: usageActualCostMinor,
          }
          await finalize('failed', chunkValidation.code, null, null)
          return
        }
        chunkResults.push(chunkValidation.suggestion.lines)
      }

      providerUsage = {
        inputTokens: usageInputTokens,
        outputTokens: usageOutputTokens,
        outputCharacters: usageOutputCharacters,
        actualCostMinor: usageActualCostMinor,
      }

      // Sunucuda deterministik birleştirme; eksik/tekrarlı satırda run düşer.
      const mergeResult = mergeLaborAllocationChunks(chunks, chunkResults, sheet.lines.length)
      if (!mergeResult.merged) {
        await finalize('failed', `AI_OUTPUT_${mergeResult.code}`, null, null)
        return
      }
      const validation = { suggestion: { lines: mergeResult.lines } }

      let controlRequiredCount = 0
      for (const line of validation.suggestion.lines) {
        const sheetLine = sheet.lines[line.lineOrdinal - 1] as NormalizedLaborItem
        const baselineLine = matched.get(line.lineOrdinal) ?? null
        if (line.controlRequired) controlRequiredCount += 1
        await pool.query(
          `INSERT INTO labor_allocation_line_suggestions
             (id,organization_id,case_id,run_id,line_ordinal,source_description,source_action,
              source_part_amount_minor,source_labor_amount_minor,allocations,repair_replace_opinion,
              economic_buckets,economic_repair_total_minor,economic_replace_total_minor,economic_note,
              reasoning,evidence_refs,confidence,conflict_codes,missing_evidence_codes,control_required,
              baseline_part_amount_minor,baseline_labor_amount_minor,
              baseline_part_ratio,baseline_suggested_part_ratio,baseline_conflict)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                   $22,$23,$24,$25,$26)`,
          [
            uuidv7(), actor.organizationId, caseId, runId, line.lineOrdinal,
            sheetLine.description, sheetLine.action, sheetLine.partAmountMinor, sheetLine.laborAmountMinor,
            JSON.stringify(line.allocations), line.repairReplaceOpinion,
            JSON.stringify(line.economicComparison.buckets),
            line.economicComparison.repairTotalMinor, line.economicComparison.replaceTotalMinor,
            line.economicComparison.note, line.reasoning, line.evidenceRefs, line.confidence,
            line.conflictCodes, line.missingEvidenceCodes, line.controlRequired,
            baselineLine?.partAmountMinor ?? null, baselineLine?.laborAmountMinor ?? null,
            line.baselineComparison?.baselinePartRatio ?? null,
            line.baselineComparison?.suggestedPartRatio ?? null,
            line.baselineComparison?.conflicts ?? false,
          ],
        )
      }
      await finalize('review_required', null, validation.suggestion.lines.length, controlRequiredCount)
      // Chunking'de run başına birden çok makbuz vardır; başarıyla yanıt veren
      // TÜM alt çağrılar kesinleştirilir.
      await pool.query(
        `UPDATE labor_allocation_provider_receipts SET status='finalized',finalized_at=now()
          WHERE run_id=$1 AND status='response_recorded'`,
        [runId],
      )
      }

      /*
       * Fire-and-forget: hata sessizce yutulmaz, run'a `failed` olarak yazılır.
       * Çağıran beklemez; durum `getRun` üzerinden okunur.
       */
      void executeRun().catch(async () => {
        await pool.query(
          `UPDATE labor_allocation_runs
              SET status='failed',safe_error_code='AI_RUN_UNEXPECTED_FAILURE',
                  completed_at=now(),progress_updated_at=now(),version=version+1
            WHERE id=$1 AND status IN ('queued','running','cancel_requested')`,
          [runId],
        ).catch(() => undefined)
        activeRuns.delete(runId)
      })

      return this.getRun(actor, caseId, runId)
    },

    /**
     * Aktif analizi iptal etmeyi DENER (Paket 62).
     *
     * İptal isteği kaydedilir ve süreç içi çağrı abort edilir. Abort
     * denenemiyorsa (ör. run başka bir süreçte) durum `cancel_requested`
     * kalır: sonuç belirsizken kullanıcıya "iptal edildi" DENMEZ.
     */
    async cancel(actor: Actor, caseId: string, runId: string): Promise<LaborAllocationRunDto> {
      const existing = await pool.query(
        `SELECT status FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
        [actor.organizationId, caseId, runId],
      )
      const row = existing.rows[0] as Record<string, unknown> | undefined
      if (row === undefined) throw new LaborAllocationError('RUN_NOT_FOUND', 404)
      const status = String(row.status)
      if (!['queued', 'running', 'cancel_requested'].includes(status)) {
        throw new LaborAllocationError('RUN_NOT_CANCELLABLE', 409)
      }
      if (status !== 'cancel_requested') {
        await pool.query(
          `UPDATE labor_allocation_runs
              SET status='cancel_requested',cancel_requested_at=now(),
                  progress_updated_at=now(),version=version+1
            WHERE id=$1 AND status IN ('queued','running')`,
          [runId],
        )
      }
      // Süreç içi çağrıyı abort etmeyi dene; başarısı garanti edilmez.
      activeRuns.get(runId)?.abort()
      return this.getRun(actor, caseId, runId)
    },

    /**
     * Seçili satırlardan ÖNİZLEME üretir. Föy bu dilimde revize EDİLMEZ;
     * yanıt `applied: false` taşır ve kullanıcının açık onayına gider.
     */
    async applyPreview(
      actor: Actor,
      caseId: string,
      runId: string,
      input: { expectedSheetVersion: number; selectedLineOrdinals: readonly number[] },
    ): Promise<LaborAllocationApplyPreviewResponse> {
      const caseRow = await loadCase(pool, actor.organizationId, caseId)
      if (caseRow.closed) throw new LaborAllocationError('CASE_CLOSED', 409)
      const sheet = await loadSheet(pool, actor.organizationId, caseId)
      if (sheet === null) throw new LaborAllocationError('LABOR_SHEET_NOT_FOUND', 404)
      if (sheet.sheetVersion !== input.expectedSheetVersion) {
        throw new LaborAllocationError('SHEET_VERSION_STALE', 409)
      }
      const run = await pool.query(
        `SELECT status,source_sheet_id::text,source_sheet_version FROM labor_allocation_runs
          WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
        [actor.organizationId, caseId, runId],
      )
      const runRow = run.rows[0] as Record<string, unknown> | undefined
      if (runRow === undefined) throw new LaborAllocationError('RUN_NOT_FOUND', 404)
      if (runRow.status !== 'review_required') throw new LaborAllocationError('RUN_NOT_REVIEWABLE', 409)
      // Kaynak föy öneriden sonra değiştiyse yeniden analiz gerekir.
      if (safeNumber(runRow.source_sheet_version) !== sheet.sheetVersion) {
        throw new LaborAllocationError('RUN_STALE', 409)
      }

      const lines = await pool.query(
        `SELECT line_ordinal,source_description,source_action,
                source_part_amount_minor::text AS part,source_labor_amount_minor::text AS labor,
                allocations,control_required
           FROM labor_allocation_line_suggestions
          WHERE organization_id=$1 AND run_id=$2 AND line_ordinal=ANY($3::int[])
          ORDER BY line_ordinal`,
        [actor.organizationId, runId, [...input.selectedLineOrdinals]],
      )
      if (lines.rows.length !== input.selectedLineOrdinals.length) {
        throw new LaborAllocationError('LINE_SELECTION_INVALID', 400)
      }
      const previewLines = (lines.rows as Record<string, unknown>[]).map((line) => ({
        lineOrdinal: safeNumber(line.line_ordinal),
        description: String(line.source_description),
        action: String(line.source_action),
        partAmountMinor: safeNumber(line.part),
        laborAmountMinor: safeNumber(line.labor),
        allocations: line.allocations as { operationType: string; amountMinor: number }[],
        controlRequired: Boolean(line.control_required),
      }))
      return laborAllocationApplyPreviewResponseSchema.parse({
        runId,
        caseId,
        sourceSheetId: String(runRow.source_sheet_id),
        sourceSheetVersion: sheet.sheetVersion,
        operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
        outputSchemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
        lines: previewLines,
        selectedCount: previewLines.length,
        controlRequiredCount: previewLines.filter((line) => line.controlRequired).length,
        applied: false,
        requiresHumanReview: true,
      })
    },

    /**
     * Paket 58 — seçilen satırları TEK transaction içinde föye uygular.
     *
     * Yeni föy sürümü ve provenance kaydı birlikte kesinleşir; herhangi bir
     * adım başarısızsa hiçbiri uygulanmış sayılmaz. AI önerisi bu ucun dışında
     * föyü değiştiremez.
     */
    async apply(
      actor: Actor,
      caseId: string,
      runId: string,
      input: LaborAllocationApplyRequest,
      idempotencyKey: string,
    ): Promise<LaborAllocationApplyResponse> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        // Aynı anahtar aynı sonucu döndürür; ikinci uygulama üretmez.
        const replay = await client.query(
          `SELECT id::text,run_id::text FROM labor_allocation_applications
            WHERE organization_id=$1 AND idempotency_key=$2`,
          [actor.organizationId, idempotencyKey],
        )
        const replayRow = replay.rows[0] as Record<string, unknown> | undefined
        if (replayRow !== undefined) {
          if (String(replayRow.run_id) !== runId) {
            await client.query('ROLLBACK')
            throw new LaborAllocationError('IDEMPOTENCY_CONFLICT', 409)
          }
          const response = await readApplication(client, actor.organizationId, caseId, String(replayRow.id))
          await client.query('COMMIT')
          return response
        }

        const caseRow = await loadCase(client, actor.organizationId, caseId)
        if (caseRow.closed) throw new LaborAllocationError('CASE_CLOSED', 409)

        // Föyü kilitle: eşzamanlı revizyon sürüm zincirini bozamaz.
        const sheetRow = await client.query(
          `SELECT id::text,version,current_version_id::text
             FROM labor_sheets WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const sheetHeader = sheetRow.rows[0] as Record<string, unknown> | undefined
        if (sheetHeader === undefined) throw new LaborAllocationError('LABOR_SHEET_NOT_FOUND', 404)
        const sheet = await loadSheet(client, actor.organizationId, caseId)
        if (sheet === null) throw new LaborAllocationError('LABOR_SHEET_NOT_FOUND', 404)
        if (sheet.sheetVersion !== input.expectedSheetVersion) {
          throw new LaborAllocationError('SHEET_VERSION_STALE', 409)
        }

        const run = await client.query(
          `SELECT status,source_sheet_id::text,source_sheet_version
             FROM labor_allocation_runs
            WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
          [actor.organizationId, caseId, runId],
        )
        const runRow = run.rows[0] as Record<string, unknown> | undefined
        if (runRow === undefined) throw new LaborAllocationError('RUN_NOT_FOUND', 404)
        if (runRow.status !== 'review_required') throw new LaborAllocationError('RUN_NOT_REVIEWABLE', 409)
        if (safeNumber(runRow.source_sheet_version) !== sheet.sheetVersion) {
          throw new LaborAllocationError('RUN_STALE', 409)
        }

        // Aynı run ikinci kez uygulanamaz.
        const alreadyApplied = await client.query(
          `SELECT 1 FROM labor_allocation_applications
            WHERE organization_id=$1 AND run_id=$2 AND status='completed'`,
          [actor.organizationId, runId],
        )
        if (alreadyApplied.rowCount !== null && alreadyApplied.rowCount > 0) {
          throw new LaborAllocationError('RUN_ALREADY_APPLIED', 409)
        }

        const suggestionRows = await client.query(
          `SELECT line_ordinal,source_description,source_action,
                  source_part_amount_minor::text AS part,source_labor_amount_minor::text AS labor,
                  allocations,control_required
             FROM labor_allocation_line_suggestions
            WHERE organization_id=$1 AND run_id=$2
            ORDER BY line_ordinal`,
          [actor.organizationId, runId],
        )
        const suggestedLines: LaborAllocationSuggestedLine[] =
          (suggestionRows.rows as Record<string, unknown>[]).map((line) => ({
            lineOrdinal: safeNumber(line.line_ordinal),
            description: String(line.source_description),
            action: String(line.source_action),
            partAmountMinor: safeNumber(line.part),
            laborAmountMinor: safeNumber(line.labor),
            operationTypes: [...new Set(
              ((line.allocations ?? []) as { operationType: string }[])
                .map((allocation) => allocation.operationType),
            )] as LaborAllocationSuggestedLine['operationTypes'],
            controlRequired: Boolean(line.control_required),
          }))

        const validation = validateLaborAllocationApply(suggestedLines, input.lines)
        if (!validation.allowed) throw new LaborAllocationError('APPLY_LINES_INVALID', 400)

        const applicationId = uuidv7()
        await client.query(
          `INSERT INTO labor_allocation_applications
             (id,organization_id,case_id,run_id,source_sheet_id,source_sheet_version,
              apply_schema_version,status,selected_line_count,rejected_line_count,
              modified_line_count,control_required_line_count,idempotency_key,applied_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,$9,$10,$11,$12,$13)`,
          [
            applicationId, actor.organizationId, caseId, runId,
            String(runRow.source_sheet_id), sheet.sheetVersion,
            LABOR_ALLOCATION_APPLY_SCHEMA_VERSION,
            validation.lines.length,
            suggestedLines.length - validation.lines.length,
            validation.modifiedCount,
            validation.controlRequiredCount,
            idempotencyKey, actor.userId,
          ],
        )

        // Seçilmeyen satırlar föyde olduğu gibi korunur.
        const mergedItems = mergeAppliedLinesIntoSheet(sheet.lines, validation.lines)
        const itemValidation = validateLaborSheetItems(mergedItems)
        if (!itemValidation.valid) throw new LaborAllocationError('APPLY_LINES_INVALID', 400)

        const nextVersion = sheet.sheetVersion + 1
        const targetVersionId = await createLaborSheetVersion(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          caseId,
          sheetId: String(sheetHeader.id),
          sheetVersion: nextVersion,
          previousVersionId: String(sheetHeader.current_version_id),
          sourceType: 'ai_allocation_applied',
          laborAiSuggestionRunId: null,
          revisionReason: input.reason,
          items: itemValidation.items,
        })
        await client.query(
          'UPDATE labor_sheets SET current_version_id=$1,version=$2,updated_at=now() WHERE id=$3',
          [targetVersionId, nextVersion, String(sheetHeader.id)],
        )

        for (const line of validation.lines) {
          await client.query(
            `INSERT INTO labor_allocation_applied_lines
               (id,organization_id,application_id,line_ordinal,suggestion_line_ordinal,target_line_ordinal,
                suggested_description,suggested_action,suggested_part_amount_minor,
                suggested_labor_amount_minor,suggested_operation_types,
                applied_description,applied_action,applied_part_amount_minor,
                applied_labor_amount_minor,modified,control_required)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              uuidv7(), actor.organizationId, applicationId, line.lineOrdinal,
              line.suggested.lineOrdinal, line.lineOrdinal,
              line.suggested.description, line.suggested.action,
              line.suggested.partAmountMinor, line.suggested.laborAmountMinor,
              line.suggested.operationTypes,
              line.applied.description.trim(), line.applied.action.trim(),
              line.applied.partAmountMinor, line.applied.laborAmountMinor,
              line.modified, line.suggested.controlRequired,
            ],
          )
        }

        await client.query(
          `UPDATE labor_allocation_applications
              SET status='completed',target_sheet_version_id=$2,target_sheet_version=$3,
                  completed_at=now()
            WHERE id=$1`,
          [applicationId, targetVersionId, nextVersion],
        )

        // Audit: ham kalem açıklaması ve tutar YAZILMAZ; yalnız sayımlar.
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          requestId: actor.requestId ?? applicationId,
          action: 'labor_allocation.applied',
          entityType: 'labor_allocation_application',
          entityId: applicationId,
          details: {
            caseId,
            runId,
            sourceSheetVersion: sheet.sheetVersion,
            targetSheetVersion: nextVersion,
            selectedLineCount: validation.lines.length,
            rejectedLineCount: suggestedLines.length - validation.lines.length,
            modifiedLineCount: validation.modifiedCount,
            controlRequiredLineCount: validation.controlRequiredCount,
          },
        })

        const response = await readApplication(client, actor.organizationId, caseId, applicationId)
        await client.query('COMMIT')
        return response
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async listApplications(
      actor: Actor,
      caseId: string,
    ): Promise<LaborAllocationApplicationsResponse> {
      await loadCase(pool, actor.organizationId, caseId)
      const rows = await pool.query(
        `SELECT id::text FROM labor_allocation_applications
          WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at DESC LIMIT 200`,
        [actor.organizationId, caseId],
      )
      const applications = []
      for (const row of rows.rows as Record<string, unknown>[]) {
        const detail = await readApplication(pool, actor.organizationId, caseId, String(row.id))
        applications.push(detail.application)
      }
      return laborAllocationApplicationsResponseSchema.parse({ caseId, applications })
    },
  }
}

export type LaborAllocationStore = ReturnType<typeof createLaborAllocationStore>
