import type pg from 'pg'
import {
  laborAllocationApplyPreviewResponseSchema,
  laborAllocationRunSchema,
  laborAllocationWorkspaceResponseSchema,
  type LaborAllocationApplyPreviewResponse,
  type LaborAllocationRunDto,
  type LaborAllocationWorkspaceResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
  LABOR_ALLOCATION_RULE_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  buildLaborAllocationEvidenceHash,
  buildLaborAllocationOutboundContext,
  buildLaborAllocationPlanHash,
  validateLaborAllocationSuggestion,
  type LaborAllocationPlanContext,
  type NormalizedLaborItem,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
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

export class LaborAllocationError extends Error {
  constructor(readonly code: LaborAllocationErrorCode, readonly status: number) {
    super(code)
    this.name = 'LaborAllocationError'
  }
}

interface Actor {
  readonly organizationId: string
  readonly userId: string
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
  pool: pg.Pool,
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
  pool: pg.Pool,
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
    `SELECT i.description,i.action,i.part_amount_minor::text AS part,i.labor_amount_minor::text AS labor
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
    })),
  }
}

interface ProviderPolicy {
  readonly enabled: boolean
  readonly allowedProviderIds: readonly string[]
  readonly monthlyBudgetMinor: number
  readonly perRequestBudgetMinor: number
}

async function loadPolicy(pool: pg.Pool, organizationId: string): Promise<ProviderPolicy> {
  const result = await pool.query(
    `SELECT labor_allocation_enabled,labor_allocation_allowed_provider_ids,
            monthly_budget_minor,per_request_budget_minor
       FROM ai_provider_policies WHERE organization_id=$1`,
    [organizationId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) {
    return { enabled: false, allowedProviderIds: [], monthlyBudgetMinor: 0, perRequestBudgetMinor: 0 }
  }
  return {
    enabled: Boolean(row.labor_allocation_enabled),
    allowedProviderIds: (row.labor_allocation_allowed_provider_ids ?? []) as string[],
    monthlyBudgetMinor: safeNumber(row.monthly_budget_minor),
    perRequestBudgetMinor: safeNumber(row.per_request_budget_minor),
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
              conflict_codes,missing_evidence_codes,control_required
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
  privacy_warnings,provider_retention_mode,safe_error_code,version,created_at,started_at,completed_at`

export function createLaborAllocationStore(
  pool: pg.Pool,
  registry: LaborAllocationProviderRegistry,
  providerId = 'deterministic-success',
) {
  const adapter = () => registry.get(providerId)

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
      // Geçmiş dağıtımlar YALNIZ aynı organization içinden okunur.
      const history = await pool.query(
        `SELECT l.source_description AS description,l.source_action AS action,l.allocations
           FROM labor_allocation_line_suggestions l
           JOIN labor_allocation_runs r
             ON r.organization_id=l.organization_id AND r.id=l.run_id AND r.status='review_required'
          WHERE l.organization_id=$1 AND l.control_required=false
          ORDER BY l.created_at DESC LIMIT 50`,
        [actor.organizationId],
      )

      const planContext: LaborAllocationPlanContext = {
        organizationId: actor.organizationId,
        caseId,
        caseVersion: caseRow.version,
        caseType: caseRow.caseType,
        sheetId: sheet.sheetId,
        sheetVersion: sheet.sheetVersion,
        damageDescription: input.damageDescription,
        lines: sheet.lines,
        dictionary: (dictionary.rows as Record<string, unknown>[]).map((row) => ({
          description: String(row.description),
          action: String(row.action),
          usageCount: safeNumber(row.usage_count),
        })),
        approvedHistory: (history.rows as Record<string, unknown>[]).map((row) => ({
          description: String(row.description),
          action: String(row.action),
          operationTypes: ((row.allocations ?? []) as { operationType: string }[])
            .map((allocation) => allocation.operationType) as never,
        })),
        expertBaseline: null,
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
      const evidenceHash = buildLaborAllocationEvidenceHash(planContext)
      const planHash = buildLaborAllocationPlanHash(planContext, outbound)
      const budget = await budgetFor(actor.organizationId, outbound.outboundInputCharacters)

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

      const runId = uuidv7()
      await pool.query(
        `INSERT INTO labor_allocation_runs
           (id,organization_id,case_id,source_sheet_id,source_sheet_version,evidence_hash,plan_hash,
            provider_id,provider_version,model_id,prompt_template_version,output_schema_version,
            operation_types_version,rule_version,external_provider,privacy_policy_version,
            outbound_payload_hash,outbound_input_characters,redacted_value_count,redacted_categories,
            privacy_warnings,provider_retention_mode,pricing_version,estimated_cost_minor,
            created_by_user_id,started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,now())`,
        [
          runId, actor.organizationId, caseId, sheet.sheetId, sheet.sheetVersion, evidenceHash, planHash,
          planContext.providerId, planContext.providerVersion, planContext.modelId,
          LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION, LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
          LABOR_OPERATION_TYPES_VERSION, LABOR_ALLOCATION_RULE_VERSION,
          planContext.externalProvider, outbound.privacyPolicyVersion, outbound.outboundPayloadHash,
          outbound.outboundInputCharacters, outbound.redactedValueCount, outbound.redactedCategories,
          outbound.warnings, planContext.retentionMode, planContext.pricingVersion,
          budget.estimatedCostMinor, actor.userId,
        ],
      )

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
          `INSERT INTO ai_usage_ledger
             (id,organization_id,case_id,usage_module,labor_allocation_run_id,provider_id,model_id,
              request_hash,input_characters,output_characters,estimated_cost_minor,actual_cost_minor,
              status,safe_error_code,started_at,completed_at)
           VALUES ($1,$2,$3,'labor_allocation',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())`,
          [
            uuidv7(), actor.organizationId, caseId, runId, planContext.providerId, planContext.modelId,
            planHash, outbound.outboundInputCharacters, 0, budget.estimatedCostMinor,
            status === 'review_required' ? budget.estimatedCostMinor : null,
            status === 'review_required' ? 'completed'
              : status === 'budget_blocked' ? 'budget_blocked'
                : status === 'provider_disabled' ? 'provider_disabled' : 'failed',
            safeErrorCode,
          ],
        )
      }

      // Bütçe/politika engeli: sahte sonuç veya kural tabanlı fallback YOK.
      if (!budget.allowed) {
        const status = budget.reasonCode === 'AI_BUDGET_EXCEEDED' ? 'budget_blocked' : 'provider_disabled'
        await finalize(status, budget.reasonCode ?? 'AI_PROVIDER_DISABLED', null, null)
        return this.getRun(actor, caseId, runId)
      }
      if (provider === undefined) {
        await finalize('provider_disabled', 'AI_PROVIDER_NOT_CONFIGURED', null, null)
        return this.getRun(actor, caseId, runId)
      }

      let output: unknown
      try {
        const response = await provider.execute({
          accountingInputCharacters: outbound.outboundInputCharacters,
          providerRequestId: runId,
          context: outbound.context,
        })
        output = response.output
      } catch (error) {
        const failure = error instanceof LaborAllocationProviderExecutionError
          ? error
          : new LaborAllocationProviderExecutionError('unknown', 'unknown', 'AI_PROVIDER_FAILED')
        await finalize(
          failure.requestOutcome === 'unknown' ? 'outcome_unknown' : 'failed',
          failure.safeDiagnosticCode ?? 'AI_PROVIDER_FAILED',
          null,
          null,
        )
        return this.getRun(actor, caseId, runId)
      }

      // Domain doğrulamasından geçmeden HİÇBİR satır kaydedilmez.
      const validation = validateLaborAllocationSuggestion(
        output,
        sheet.lines,
        outbound.missingEvidenceCodes,
      )
      if (!validation.allowed) {
        await finalize('failed', validation.code, null, null)
        return this.getRun(actor, caseId, runId)
      }

      let controlRequiredCount = 0
      for (const line of validation.suggestion.lines) {
        const sheetLine = sheet.lines[line.lineOrdinal - 1] as NormalizedLaborItem
        if (line.controlRequired) controlRequiredCount += 1
        await pool.query(
          `INSERT INTO labor_allocation_line_suggestions
             (id,organization_id,case_id,run_id,line_ordinal,source_description,source_action,
              source_part_amount_minor,source_labor_amount_minor,allocations,repair_replace_opinion,
              economic_buckets,economic_repair_total_minor,economic_replace_total_minor,economic_note,
              reasoning,evidence_refs,confidence,conflict_codes,missing_evidence_codes,control_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            uuidv7(), actor.organizationId, caseId, runId, line.lineOrdinal,
            sheetLine.description, sheetLine.action, sheetLine.partAmountMinor, sheetLine.laborAmountMinor,
            JSON.stringify(line.allocations), line.repairReplaceOpinion,
            JSON.stringify(line.economicComparison.buckets),
            line.economicComparison.repairTotalMinor, line.economicComparison.replaceTotalMinor,
            line.economicComparison.note, line.reasoning, line.evidenceRefs, line.confidence,
            line.conflictCodes, line.missingEvidenceCodes, line.controlRequired,
          ],
        )
      }
      await finalize('review_required', null, validation.suggestion.lines.length, controlRequiredCount)
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
  }
}

export type LaborAllocationStore = ReturnType<typeof createLaborAllocationStore>
