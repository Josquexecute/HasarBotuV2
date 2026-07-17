import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  laborAiPlanResponseSchema,
  laborAiRunSchema,
  laborAiRunsResponseSchema,
  type LaborAiPlanRequest,
  type LaborAiPlanResponse,
  type LaborAiRun,
  type LaborAiRunsResponse,
  type LaborAiStartRequest,
} from '@hasarbotu/contracts'
import {
  LABOR_AI_OUTPUT_SCHEMA_VERSION,
  LABOR_AI_PROMPT_TEMPLATE_VERSION,
  buildLaborAiOutboundContext,
  buildLaborAiPlanHash,
  evaluatePolicyAiBudget,
  validateLaborAiSuggestion,
  type LaborAiOutboundContext,
  type LaborAiProviderId,
  type NormalizedLaborItem,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction, type Queryable } from '../db/executor.js'
import {
  LaborAiProviderExecutionError,
  executeLaborAiProvider,
  isLaborAiProviderDescriptorCompatible,
  type LaborAiProviderAdapter,
  type LaborAiProviderRegistry,
  type LaborAiProviderResponse,
} from './providers.js'

interface Actor {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface IdempotencyContext {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

interface CaseRow {
  readonly id: string
  readonly case_type: 'traffic' | 'casco'
  readonly lifecycle_status: 'open' | 'closed'
  readonly version: number
}

interface SheetBase {
  readonly sheetVersion: number | null
  readonly items: readonly NormalizedLaborItem[]
}

interface ProviderPolicy {
  readonly laborEnabled: boolean
  readonly laborAllowedProviderIds: readonly string[]
  readonly monthlyBudgetMinor: number
  readonly perRequestBudgetMinor: number
  readonly monthlyHardStop: boolean
  readonly requestTimeoutMs: number
}

interface RunRow {
  readonly id: string
  readonly case_id: string
  readonly base_sheet_version: number | null
  readonly plan_hash: string
  readonly provider_id: LaborAiProviderId
  readonly provider_version: string
  readonly model_id: string
  readonly prompt_template_version: string
  readonly output_schema_version: string
  readonly status: LaborAiRun['status']
  readonly external_provider: boolean
  readonly privacy_policy_version: string
  readonly outbound_payload_hash: string | null
  readonly outbound_input_characters: number
  readonly redacted_value_count: number
  readonly redacted_categories: string[]
  readonly privacy_warnings: string[]
  readonly provider_retention_mode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricing_version: string
  readonly estimated_cost_minor: string | number
  readonly actual_cost_minor: string | number | null
  readonly suggestion_items: unknown
  readonly reasoning: string | null
  readonly output_warnings: string[] | null
  readonly confidence: string | number | null
  readonly safe_error_code: string | null
  readonly version: number
  readonly created_at: Date
  readonly started_at: Date | null
  readonly completed_at: Date | null
}

interface ReceiptRow {
  readonly id: string
  readonly status: 'dispatch_reserved' | 'response_recorded' | 'outcome_unknown' | 'finalized'
  readonly result_kind: 'success' | 'failure' | null
  readonly request_hash: string
  readonly idempotency_request_hash: string
  readonly canonical_output: unknown
  readonly canonical_output_hash: string | null
  readonly input_characters: number
  readonly output_characters: number | null
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly estimated_cost_minor: string | number
  readonly actual_cost_minor: string | number | null
  readonly safe_error_code: string | null
  readonly provider_response_id: string | null
  readonly provider_request_id: string | null
  readonly dispatch_started_at: Date
}

interface ComputedPlan {
  readonly response: LaborAiPlanResponse
  readonly caseRow: CaseRow
  readonly base: SheetBase
  readonly providerVersionForIdentity: string
  readonly modelIdForIdentity: string
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
  readonly externalProvider: boolean
  readonly outbound: LaborAiOutboundContext
  readonly adapter: LaborAiProviderAdapter | undefined
  readonly policy: ProviderPolicy
}

type StoreResult<T> = {
  readonly replay: boolean
  readonly status: number
  readonly body: T | unknown
}

export type LaborAiStoreErrorCode =
  | 'not_found'
  | 'case_closed'
  | 'version_conflict'
  | 'state_conflict'
  | 'idempotency_conflict'

export class LaborAiStoreError extends Error {
  constructor(readonly code: LaborAiStoreErrorCode) {
    super(code)
  }
}

const audit = createAuditService()
const DEFAULT_UNCONFIGURED_PROVIDER_VERSION = 'unconfigured/1.0.0'
const DEFAULT_UNCONFIGURED_MODEL_ID = 'unconfigured'

function safeNumber(value: unknown): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('unsafe_integer')
  return result
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function providerRequestHash(runId: string, planHash: string, providerId: string): string {
  return createHash('sha256')
    .update(`labor-ai-request/1|${runId}|${planHash}|${providerId}`)
    .digest('hex')
}

function safeProviderFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'provider_timeout') return 'AI_PROVIDER_TIMEOUT'
  if (message === 'provider_authentication_failed') return 'AI_PROVIDER_AUTHENTICATION_FAILED'
  if (message === 'provider_rate_limited') return 'AI_PROVIDER_RATE_LIMITED'
  if (message === 'provider_request_rejected') return 'AI_PROVIDER_REQUEST_REJECTED'
  if (message === 'provider_unavailable') return 'AI_PROVIDER_UNAVAILABLE'
  if (message === 'provider_network_failure') return 'AI_PROVIDER_NETWORK_FAILURE'
  if (message === 'provider_usage_invalid') return 'AI_PROVIDER_USAGE_INVALID'
  if (['provider_response_invalid', 'provider_response_incomplete', 'provider_response_too_large'].includes(message)) {
    return 'AI_PROVIDER_RESPONSE_INVALID'
  }
  return 'AI_PROVIDER_FAILURE'
}

async function readCase(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  forUpdate = false,
): Promise<CaseRow | undefined> {
  const result = await exec.query(
    `SELECT id,case_type,lifecycle_status,version
       FROM cases
      WHERE organization_id=$1 AND id=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId],
  )
  return result.rows[0] as CaseRow | undefined
}

async function readSheetBase(
  exec: Queryable,
  organizationId: string,
  caseId: string,
): Promise<SheetBase> {
  const sheetResult = await exec.query(
    'SELECT id,version,current_version_id FROM labor_sheets WHERE organization_id=$1 AND case_id=$2',
    [organizationId, caseId],
  )
  const sheet = sheetResult.rows[0] as { id: string; version: number; current_version_id: string } | undefined
  if (sheet === undefined) return { sheetVersion: null, items: [] }
  const itemsResult = await exec.query(
    `SELECT description,action,part_amount_minor::text AS part,labor_amount_minor::text AS labor
       FROM labor_sheet_items
      WHERE organization_id=$1 AND sheet_version_id=$2
      ORDER BY ordinal`,
    [organizationId, sheet.current_version_id],
  )
  return {
    sheetVersion: sheet.version,
    items: (itemsResult.rows as Array<{ description: string; action: string; part: string; labor: string }>)
      .map((row) => ({
        description: row.description,
        action: row.action,
        partAmountMinor: safeNumber(row.part),
        laborAmountMinor: safeNumber(row.labor),
      })),
  }
}

async function loadPolicy(exec: Queryable, organizationId: string): Promise<ProviderPolicy> {
  const result = await exec.query(
    `SELECT labor_enabled,labor_allowed_provider_ids,monthly_budget_minor,
            per_request_budget_minor,monthly_hard_stop,request_timeout_ms
       FROM ai_provider_policies WHERE organization_id=$1`,
    [organizationId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) {
    return {
      laborEnabled: false,
      laborAllowedProviderIds: [],
      monthlyBudgetMinor: 0,
      perRequestBudgetMinor: 0,
      monthlyHardStop: true,
      requestTimeoutMs: 5_000,
    }
  }
  return {
    laborEnabled: Boolean(row.labor_enabled),
    laborAllowedProviderIds: row.labor_allowed_provider_ids as string[],
    monthlyBudgetMinor: safeNumber(row.monthly_budget_minor),
    perRequestBudgetMinor: safeNumber(row.per_request_budget_minor),
    monthlyHardStop: Boolean(row.monthly_hard_stop),
    requestTimeoutMs: Number(row.request_timeout_ms),
  }
}

async function currentMonthCost(exec: Queryable, organizationId: string): Promise<number> {
  const result = await exec.query(
    `SELECT (
       (SELECT coalesce(sum(actual_cost_minor),0)
          FROM ai_usage_ledger
         WHERE organization_id=$1 AND actual_cost_minor IS NOT NULL
           AND started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       +
       (SELECT coalesce(sum(coalesce(actual_cost_minor,estimated_cost_minor)),0)
          FROM ai_provider_call_receipts
         WHERE organization_id=$1
           AND status IN ('dispatch_reserved','response_recorded','outcome_unknown')
           AND dispatch_started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       +
       (SELECT coalesce(sum(coalesce(actual_cost_minor,estimated_cost_minor)),0)
          FROM email_ai_provider_receipts
         WHERE organization_id=$1
           AND status IN ('dispatch_reserved','response_recorded','outcome_unknown')
           AND dispatch_started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       +
       (SELECT coalesce(sum(coalesce(actual_cost_minor,estimated_cost_minor)),0)
          FROM labor_ai_provider_receipts
         WHERE organization_id=$1
           AND status IN ('dispatch_reserved','response_recorded','outcome_unknown')
           AND dispatch_started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
     )::text AS value`,
    [organizationId],
  )
  return safeNumber((result.rows[0] as { value: string }).value)
}

async function lockIdempotency(
  exec: Queryable,
  actor: Actor,
  idempotency: IdempotencyContext,
): Promise<void> {
  await exec.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`labor-ai-idem|${actor.organizationId}|${idempotency.scope}|${idempotency.key}`],
  )
}

async function lockMonthlyBudget(exec: Queryable, organizationId: string): Promise<void> {
  await exec.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`policy-ai-budget|${organizationId}|${new Date().toISOString().slice(0, 7)}`],
  )
}

function fallbackProviderFacts(providerId: LaborAiProviderId) {
  const externalProvider = providerId === 'gemini-generate-content'
  return {
    providerVersion: DEFAULT_UNCONFIGURED_PROVIDER_VERSION,
    modelId: DEFAULT_UNCONFIGURED_MODEL_ID,
    externalProvider,
    retentionMode: externalProvider ? 'free_tier_product_improvement' as const : 'local_only' as const,
    pricingVersion: externalProvider ? 'unconfigured' : 'deterministic-cost/1.0.0',
  }
}

async function computePlan(
  exec: Queryable,
  registry: LaborAiProviderRegistry,
  actor: Actor,
  caseId: string,
  input: LaborAiPlanRequest,
  caseRow?: CaseRow,
): Promise<ComputedPlan> {
  const target = caseRow ?? await readCase(exec, actor.organizationId, caseId)
  if (target === undefined) throw new LaborAiStoreError('not_found')
  const base = await readSheetBase(exec, actor.organizationId, caseId)
  const adapter = registry.get(input.providerId)
  const fallback = fallbackProviderFacts(input.providerId)
  const descriptor = adapter?.descriptor
  const providerVersionForIdentity = descriptor?.providerVersion ?? fallback.providerVersion
  const modelIdForIdentity = descriptor?.modelId ?? fallback.modelId
  const externalProvider = descriptor?.externalProvider ?? fallback.externalProvider
  const retentionMode = descriptor?.retentionMode ?? fallback.retentionMode
  const pricingVersion = descriptor?.pricingVersion ?? fallback.pricingVersion
  const planContext = {
    organizationId: actor.organizationId,
    caseId,
    caseVersion: target.version,
    caseType: target.case_type,
    baseSheetVersion: base.sheetVersion,
    damageDescription: input.damageDescription,
    currentItems: base.items,
    providerId: input.providerId,
    providerVersion: providerVersionForIdentity,
    modelId: modelIdForIdentity,
    externalProvider,
    retentionMode,
    pricingVersion,
  }
  const outbound = buildLaborAiOutboundContext(planContext)
  const planHash = buildLaborAiPlanHash(planContext, outbound)
  const policy = await loadPolicy(exec, actor.organizationId)
  const currentMonthCostMinor = await currentMonthCost(exec, actor.organizationId)
  const configured = adapter !== undefined && isLaborAiProviderDescriptorCompatible(adapter.descriptor)
  const providerAllowed = policy.laborAllowedProviderIds.includes(input.providerId)
  const estimatedCostMinor = descriptor?.estimateCostMinor(outbound.outboundInputCharacters) ?? 0
  const decision = evaluatePolicyAiBudget({
    enabled: policy.laborEnabled,
    providerAllowed: configured && providerAllowed,
    monthlyBudgetMinor: policy.monthlyBudgetMinor,
    perRequestBudgetMinor: policy.perRequestBudgetMinor,
    monthlyHardStop: policy.monthlyHardStop,
    currentMonthCostMinor,
    estimatedCostMinor,
  })
  const reasonCode = !configured
    ? 'AI_PROVIDER_NOT_CONFIGURED' as const
    : decision.allowed
      ? null
      : decision.code
  const budgetAllowed = configured && decision.allowed
  const response = laborAiPlanResponseSchema.parse({
    caseId,
    caseVersion: target.version,
    baseSheetVersion: base.sheetVersion,
    providerId: input.providerId,
    providerVersion: configured ? (descriptor?.providerVersion ?? null) : null,
    modelId: configured ? (descriptor?.modelId ?? null) : null,
    promptTemplateVersion: LABOR_AI_PROMPT_TEMPLATE_VERSION,
    outputSchemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
    planHash,
    privacy: {
      externalProvider,
      policyVersion: outbound.privacyPolicyVersion,
      outboundPayloadHash: outbound.outboundPayloadHash,
      outboundInputCharacters: outbound.outboundInputCharacters,
      redactedValueCount: outbound.redactedValueCount,
      redactedCategories: outbound.redactedCategories,
      retentionMode,
      warnings: outbound.warnings,
    },
    budget: {
      enabled: policy.laborEnabled,
      providerAvailable: configured,
      providerAllowed,
      estimatedCostMinor,
      currentMonthCostMinor,
      monthlyBudgetMinor: policy.monthlyBudgetMinor,
      perRequestBudgetMinor: policy.perRequestBudgetMinor,
      allowed: budgetAllowed,
      reasonCode,
    },
    canStart: target.lifecycle_status === 'open' && budgetAllowed,
    requiresExplicitEgressConfirmation: externalProvider,
    requiresHumanReview: true,
  })
  return {
    response,
    caseRow: target,
    base,
    providerVersionForIdentity,
    modelIdForIdentity,
    retentionMode,
    pricingVersion,
    externalProvider,
    outbound,
    adapter,
    policy,
  }
}

async function loadRun(
  exec: Queryable,
  registry: LaborAiProviderRegistry,
  organizationId: string,
  caseId: string,
  runId: string,
): Promise<LaborAiRun | undefined> {
  const result = await exec.query(
    `SELECT * FROM labor_ai_suggestion_runs
      WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
    [organizationId, caseId, runId],
  )
  const row = result.rows[0] as RunRow | undefined
  if (row === undefined) return undefined
  const policy = await loadPolicy(exec, organizationId)
  const currentMonthCostMinor = await currentMonthCost(exec, organizationId)
  const adapter = registry.get(row.provider_id)
  const configured = adapter !== undefined && isLaborAiProviderDescriptorCompatible(adapter.descriptor)
  const providerAllowed = policy.laborAllowedProviderIds.includes(row.provider_id)
  const decision = evaluatePolicyAiBudget({
    enabled: policy.laborEnabled,
    providerAllowed: configured && providerAllowed,
    monthlyBudgetMinor: policy.monthlyBudgetMinor,
    perRequestBudgetMinor: policy.perRequestBudgetMinor,
    monthlyHardStop: policy.monthlyHardStop,
    currentMonthCostMinor,
    estimatedCostMinor: safeNumber(row.estimated_cost_minor),
  })
  const budgetReason = !configured
    ? 'AI_PROVIDER_NOT_CONFIGURED' as const
    : decision.allowed
      ? null
      : decision.code
  return laborAiRunSchema.parse({
    id: row.id,
    caseId: row.case_id,
    status: row.status,
    providerId: row.provider_id,
    providerVersion: row.provider_version,
    modelId: row.model_id,
    promptTemplateVersion: row.prompt_template_version,
    outputSchemaVersion: row.output_schema_version,
    baseSheetVersion: row.base_sheet_version,
    planHash: row.plan_hash,
    version: row.version,
    privacy: {
      externalProvider: row.external_provider,
      policyVersion: row.privacy_policy_version,
      outboundPayloadHash: row.outbound_payload_hash,
      outboundInputCharacters: row.outbound_input_characters,
      redactedValueCount: row.redacted_value_count,
      redactedCategories: row.redacted_categories,
      retentionMode: row.provider_retention_mode,
      warnings: row.privacy_warnings,
    },
    budget: {
      enabled: policy.laborEnabled,
      providerAvailable: configured,
      providerAllowed,
      estimatedCostMinor: safeNumber(row.estimated_cost_minor),
      currentMonthCostMinor,
      monthlyBudgetMinor: policy.monthlyBudgetMinor,
      perRequestBudgetMinor: policy.perRequestBudgetMinor,
      allowed: configured && decision.allowed,
      reasonCode: budgetReason,
    },
    suggestion: row.status === 'review_required'
      ? {
          schemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
          items: row.suggestion_items,
          reasoning: row.reasoning,
          warnings: row.output_warnings,
          confidence: Number(row.confidence),
          requiresHumanReview: true,
        }
      : null,
    safeErrorCode: row.safe_error_code,
    createdAt: row.created_at.toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
  })
}

async function insertUsage(
  client: pg.PoolClient,
  input: {
    readonly actor: Actor
    readonly caseId: string
    readonly runId: string
    readonly providerId: string
    readonly modelId: string
    readonly requestHash: string
    readonly inputCharacters: number
    readonly outputCharacters: number
    readonly inputTokens: number | null
    readonly outputTokens: number | null
    readonly estimatedCostMinor: number
    readonly actualCostMinor: number | null
    readonly status: 'provider_disabled' | 'budget_blocked' | 'completed' | 'failed'
    readonly safeErrorCode: string | null
    readonly pricingVersion: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO ai_usage_ledger
       (id,organization_id,case_id,run_id,email_suggestion_run_id,labor_suggestion_run_id,usage_module,
        provider_id,model_id,request_hash,input_characters,output_characters,
        input_tokens,output_tokens,estimated_cost_minor,actual_cost_minor,status,
        safe_error_code,pricing_version,started_at,completed_at)
     VALUES ($1,$2,$3,NULL,NULL,$4,'labor_sheet',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())`,
    [
      uuidv7(),
      input.actor.organizationId,
      input.caseId,
      input.runId,
      input.providerId,
      input.modelId,
      input.requestHash,
      input.inputCharacters,
      input.outputCharacters,
      input.inputTokens,
      input.outputTokens,
      input.estimatedCostMinor,
      input.actualCostMinor,
      input.status,
      input.safeErrorCode,
      input.pricingVersion,
    ],
  )
}

async function finalizeBlocked(
  client: pg.PoolClient,
  registry: LaborAiProviderRegistry,
  actor: Actor,
  caseId: string,
  plan: ComputedPlan,
  code: 'AI_PROVIDER_DISABLED' | 'AI_BUDGET_EXCEEDED' | 'AI_PROVIDER_NOT_CONFIGURED',
  requestHash: string,
): Promise<LaborAiRun> {
  const runId = uuidv7()
  const status = code === 'AI_BUDGET_EXCEEDED' ? 'budget_blocked' : 'provider_disabled'
  await client.query(
    `INSERT INTO labor_ai_suggestion_runs
       (id,organization_id,case_id,base_sheet_version,plan_hash,
        provider_id,provider_version,model_id,prompt_template_version,output_schema_version,
        status,external_provider,privacy_policy_version,outbound_payload_hash,
        outbound_input_characters,redacted_value_count,redacted_categories,privacy_warnings,
        provider_retention_mode,pricing_version,estimated_cost_minor,safe_error_code,
        created_by_user_id,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,now())`,
    [
      runId,
      actor.organizationId,
      caseId,
      plan.response.baseSheetVersion,
      plan.response.planHash,
      plan.response.providerId,
      plan.providerVersionForIdentity,
      plan.modelIdForIdentity,
      LABOR_AI_PROMPT_TEMPLATE_VERSION,
      LABOR_AI_OUTPUT_SCHEMA_VERSION,
      status,
      plan.externalProvider,
      plan.outbound.privacyPolicyVersion,
      plan.outbound.outboundPayloadHash,
      plan.outbound.outboundInputCharacters,
      plan.outbound.redactedValueCount,
      plan.outbound.redactedCategories,
      plan.outbound.warnings,
      plan.retentionMode,
      plan.pricingVersion,
      plan.response.budget.estimatedCostMinor,
      code,
      actor.actorUserId,
    ],
  )
  await insertUsage(client, {
    actor,
    caseId,
    runId,
    providerId: plan.response.providerId,
    modelId: plan.modelIdForIdentity,
    requestHash,
    inputCharacters: plan.outbound.outboundInputCharacters,
    outputCharacters: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostMinor: plan.response.budget.estimatedCostMinor,
    actualCostMinor: null,
    status: status === 'budget_blocked' ? 'budget_blocked' : 'provider_disabled',
    safeErrorCode: code,
    pricingVersion: plan.pricingVersion,
  })
  await audit.record(client, {
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    requestId: actor.requestId,
    action: status === 'budget_blocked'
      ? 'labor_ai_suggestion.budget_blocked'
      : 'labor_ai_suggestion.provider_disabled',
    entityType: 'labor_ai_suggestion',
    entityId: runId,
    details: {
      caseId,
      runId,
      providerId: plan.response.providerId,
      modelId: plan.modelIdForIdentity,
      baseSheetVersion: plan.response.baseSheetVersion,
      status,
      resultCode: code,
      estimatedCostMinor: plan.response.budget.estimatedCostMinor,
    },
  })
  const run = await loadRun(client, registry, actor.organizationId, caseId, runId)
  if (run === undefined) throw new Error('labor_ai_blocked_run_missing')
  return run
}

async function recordProviderResult(
  pool: pg.Pool,
  receiptId: string,
  result:
    | {
        readonly kind: 'success'
        readonly output: unknown
        readonly usage: LaborAiProviderResponse['usage']
        readonly providerResponseId: string | null
        readonly providerRequestId: string | null
      }
    | {
        readonly kind: 'failure'
        readonly code: string
        readonly usage?: LaborAiProviderResponse['usage']
        readonly providerResponseId: string | null
        readonly providerRequestId: string | null
      },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const receiptResult = await client.query(
      'SELECT status FROM labor_ai_provider_receipts WHERE id=$1 FOR UPDATE',
      [receiptId],
    )
    const current = receiptResult.rows[0] as { status: string } | undefined
    if (current === undefined) throw new Error('labor_ai_receipt_missing')
    if (current.status !== 'dispatch_reserved') return
    if (result.kind === 'success') {
      await client.query(
        `UPDATE labor_ai_provider_receipts
            SET status='response_recorded',result_kind='success',
                provider_response_id=$1,provider_request_id=$2,
                canonical_output=$3::jsonb,canonical_output_hash=$4,
                output_characters=$5,input_tokens=$6,output_tokens=$7,
                actual_cost_minor=$8,response_received_at=now()
          WHERE id=$9`,
        [
          result.providerResponseId,
          result.providerRequestId,
          JSON.stringify(result.output),
          hash(result.output),
          result.usage.outputCharacters,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.actualCostMinor,
          receiptId,
        ],
      )
    } else {
      await client.query(
        `UPDATE labor_ai_provider_receipts
            SET status='response_recorded',result_kind='failure',
                provider_response_id=$1,provider_request_id=$2,
                output_characters=$3,input_tokens=$4,output_tokens=$5,
                actual_cost_minor=$6,safe_error_code=$7,response_received_at=now()
          WHERE id=$8`,
        [
          result.providerResponseId,
          result.providerRequestId,
          result.usage?.outputCharacters ?? null,
          result.usage?.inputTokens ?? null,
          result.usage?.outputTokens ?? null,
          result.usage?.actualCostMinor ?? null,
          result.code,
          receiptId,
        ],
      )
    }
  })
}

async function finalizeOutcomeUnknown(
  pool: pg.Pool,
  registry: LaborAiProviderRegistry,
  actor: Actor,
  caseId: string,
  runId: string,
  receiptId: string,
  idempotency: IdempotencyContext,
): Promise<StoreResult<{ run: LaborAiRun }>> {
  return withTransaction(pool, async (client) => {
    await lockIdempotency(client, actor, idempotency)
    const receiptResult = await client.query(
      'SELECT * FROM labor_ai_provider_receipts WHERE id=$1 FOR UPDATE',
      [receiptId],
    )
    const receipt = receiptResult.rows[0] as ReceiptRow | undefined
    if (receipt === undefined) throw new Error('labor_ai_receipt_missing')
    if (receipt.idempotency_request_hash !== idempotency.requestHash) {
      throw new LaborAiStoreError('idempotency_conflict')
    }
    if (receipt.status === 'dispatch_reserved') {
      await client.query(
        `UPDATE labor_ai_provider_receipts
            SET status='outcome_unknown',result_kind='failure',
                safe_error_code='AI_PROVIDER_OUTCOME_UNKNOWN',finalized_at=now()
          WHERE id=$1`,
        [receiptId],
      )
      await client.query(
        `UPDATE labor_ai_suggestion_runs
            SET status='outcome_unknown',safe_error_code='AI_PROVIDER_OUTCOME_UNKNOWN',
                version=version+1,completed_at=now()
          WHERE id=$1 AND status='running'`,
        [runId],
      )
      const runRow = await client.query(
        'SELECT provider_id,model_id,pricing_version,estimated_cost_minor,outbound_input_characters FROM labor_ai_suggestion_runs WHERE id=$1',
        [runId],
      )
      const row = runRow.rows[0] as Record<string, unknown>
      await insertUsage(client, {
        actor,
        caseId,
        runId,
        providerId: String(row.provider_id),
        modelId: String(row.model_id),
        requestHash: receipt.request_hash,
        inputCharacters: Number(row.outbound_input_characters),
        outputCharacters: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostMinor: safeNumber(row.estimated_cost_minor),
        actualCostMinor: null,
        status: 'failed',
        safeErrorCode: 'AI_PROVIDER_OUTCOME_UNKNOWN',
        pricingVersion: String(row.pricing_version),
      })
      await audit.record(client, {
        organizationId: actor.organizationId,
        actorUserId: actor.actorUserId,
        requestId: actor.requestId,
        action: 'labor_ai_suggestion.outcome_unknown',
        entityType: 'labor_ai_suggestion',
        entityId: runId,
        details: {
          caseId,
          runId,
          status: 'outcome_unknown',
          resultCode: 'AI_PROVIDER_OUTCOME_UNKNOWN',
          providerCallReceiptId: receiptId,
        },
      })
    }
    const run = await loadRun(client, registry, actor.organizationId, caseId, runId)
    if (run === undefined) throw new LaborAiStoreError('not_found')
    const body = { run }
    const replay = await findIdempotent(client, actor.organizationId, idempotency.scope, idempotency.key)
    if (replay === undefined) {
      await insertIdempotent(client, {
        organizationId: actor.organizationId,
        scope: idempotency.scope,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        responseStatus: 200,
        responseBody: body,
        caseId,
      })
    }
    return { replay: false, status: 200, body }
  })
}

async function finalizeRecordedReceipt(
  pool: pg.Pool,
  registry: LaborAiProviderRegistry,
  actor: Actor,
  caseId: string,
  runId: string,
  receiptId: string,
  idempotency: IdempotencyContext,
): Promise<StoreResult<{ run: LaborAiRun }>> {
  return withTransaction(pool, async (client) => {
    await lockIdempotency(client, actor, idempotency)
    const replay = await findIdempotent(client, actor.organizationId, idempotency.scope, idempotency.key)
    if (replay !== undefined) {
      if (replay.requestHash !== idempotency.requestHash) {
        throw new LaborAiStoreError('idempotency_conflict')
      }
      return {
        replay: true,
        status: replay.responseStatus,
        body: replay.responseBody,
      }
    }
    const receiptResult = await client.query(
      'SELECT * FROM labor_ai_provider_receipts WHERE id=$1 FOR UPDATE',
      [receiptId],
    )
    const receipt = receiptResult.rows[0] as ReceiptRow | undefined
    if (receipt === undefined) throw new Error('labor_ai_receipt_missing')
    if (receipt.idempotency_request_hash !== idempotency.requestHash) {
      throw new LaborAiStoreError('idempotency_conflict')
    }
    if (receipt.status === 'response_recorded') {
      const runResult = await client.query(
        'SELECT * FROM labor_ai_suggestion_runs WHERE id=$1 FOR UPDATE',
        [runId],
      )
      const row = runResult.rows[0] as RunRow | undefined
      if (row === undefined) throw new LaborAiStoreError('not_found')
      if (row.status !== 'running') throw new LaborAiStoreError('state_conflict')
      const validated = receipt.result_kind === 'success'
        ? validateLaborAiSuggestion(receipt.canonical_output)
        : undefined
      if (receipt.result_kind === 'success' && validated?.allowed === true) {
        await client.query(
          `UPDATE labor_ai_suggestion_runs
              SET status='review_required',suggestion_items=$1::jsonb,reasoning=$2,
                  output_warnings=$3,confidence=$4,actual_cost_minor=$5,
                  version=version+1,completed_at=now()
            WHERE id=$6`,
          [
            JSON.stringify(validated.suggestion.items),
            validated.suggestion.reasoning,
            validated.suggestion.warnings,
            validated.suggestion.confidence,
            receipt.actual_cost_minor,
            runId,
          ],
        )
        await insertUsage(client, {
          actor,
          caseId,
          runId,
          providerId: row.provider_id,
          modelId: row.model_id,
          requestHash: receipt.request_hash,
          inputCharacters: receipt.input_characters,
          outputCharacters: receipt.output_characters ?? 0,
          inputTokens: receipt.input_tokens,
          outputTokens: receipt.output_tokens,
          estimatedCostMinor: safeNumber(receipt.estimated_cost_minor),
          actualCostMinor: receipt.actual_cost_minor === null ? null : safeNumber(receipt.actual_cost_minor),
          status: 'completed',
          safeErrorCode: null,
          pricingVersion: row.pricing_version,
        })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'labor_ai_suggestion.review_required',
          entityType: 'labor_ai_suggestion',
          entityId: runId,
          details: {
            caseId,
            runId,
            providerId: row.provider_id,
            modelId: row.model_id,
            baseSheetVersion: row.base_sheet_version,
            status: 'review_required',
            redactedValueCount: row.redacted_value_count,
            suggestedItemCount: validated.suggestion.items.length,
            warningCount: validated.suggestion.warnings.length,
            confidenceBand: validated.suggestion.confidence >= 0.8 ? 'high' : validated.suggestion.confidence >= 0.5 ? 'medium' : 'low',
            providerCallReceiptId: receiptId,
          },
        })
      } else {
        const safeErrorCode = validated !== undefined && !validated.allowed
          ? validated.code
          : receipt.safe_error_code ?? 'AI_PROVIDER_FAILURE'
        await client.query(
          `UPDATE labor_ai_suggestion_runs
              SET status='failed',safe_error_code=$1,actual_cost_minor=$2,
                  version=version+1,completed_at=now()
            WHERE id=$3`,
          [safeErrorCode, receipt.actual_cost_minor, runId],
        )
        await insertUsage(client, {
          actor,
          caseId,
          runId,
          providerId: row.provider_id,
          modelId: row.model_id,
          requestHash: receipt.request_hash,
          inputCharacters: receipt.input_characters,
          outputCharacters: receipt.output_characters ?? 0,
          inputTokens: receipt.input_tokens,
          outputTokens: receipt.output_tokens,
          estimatedCostMinor: safeNumber(receipt.estimated_cost_minor),
          actualCostMinor: receipt.actual_cost_minor === null ? null : safeNumber(receipt.actual_cost_minor),
          status: 'failed',
          safeErrorCode,
          pricingVersion: row.pricing_version,
        })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'labor_ai_suggestion.failed',
          entityType: 'labor_ai_suggestion',
          entityId: runId,
          details: {
            caseId,
            runId,
            providerId: row.provider_id,
            modelId: row.model_id,
            baseSheetVersion: row.base_sheet_version,
            status: 'failed',
            resultCode: safeErrorCode,
            providerCallReceiptId: receiptId,
          },
        })
      }
      await client.query(
        `UPDATE labor_ai_provider_receipts
            SET status='finalized',finalized_at=now()
          WHERE id=$1`,
        [receiptId],
      )
    }
    const run = await loadRun(client, registry, actor.organizationId, caseId, runId)
    if (run === undefined) throw new LaborAiStoreError('not_found')
    const body = { run }
    await insertIdempotent(client, {
      organizationId: actor.organizationId,
      scope: idempotency.scope,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      responseStatus: 201,
      responseBody: body,
      caseId,
    })
    return { replay: false, status: 201, body }
  })
}

export function createLaborAiStore(pool: pg.Pool, registry: LaborAiProviderRegistry) {
  return {
    plan(
      actor: Actor,
      caseId: string,
      input: LaborAiPlanRequest,
    ): Promise<LaborAiPlanResponse> {
      return computePlan(pool, registry, actor, caseId, input)
        .then((result) => result.response)
    },

    async get(
      organizationId: string,
      caseId: string,
      runId: string,
    ): Promise<LaborAiRun | undefined> {
      return loadRun(pool, registry, organizationId, caseId, runId)
    },

    async list(
      organizationId: string,
      caseId: string,
      canStart: boolean,
    ): Promise<LaborAiRunsResponse | undefined> {
      const target = await readCase(pool, organizationId, caseId)
      if (target === undefined) return undefined
      const result = await pool.query(
        `SELECT id FROM labor_ai_suggestion_runs
          WHERE organization_id=$1 AND case_id=$2
          ORDER BY created_at DESC,id DESC
          LIMIT 100`,
        [organizationId, caseId],
      )
      const items: LaborAiRun[] = []
      for (const row of result.rows as Array<{ id: string }>) {
        const run = await loadRun(pool, registry, organizationId, caseId, row.id)
        if (run !== undefined) items.push(run)
      }
      return laborAiRunsResponseSchema.parse({
        caseId,
        items,
        permissions: { canStart: canStart && target.lifecycle_status === 'open' },
      })
    },

    async start(
      actor: Actor,
      caseId: string,
      input: LaborAiStartRequest,
      evaluatedAt: string,
      idempotency: IdempotencyContext,
    ): Promise<StoreResult<{ run: LaborAiRun }>> {
      const prepared = await withTransaction(pool, async (client) => {
        await lockIdempotency(client, actor, idempotency)
        const replay = await findIdempotent(
          client,
          actor.organizationId,
          idempotency.scope,
          idempotency.key,
        )
        if (replay !== undefined) {
          if (replay.requestHash !== idempotency.requestHash) {
            throw new LaborAiStoreError('idempotency_conflict')
          }
          return {
            kind: 'result' as const,
            result: {
              replay: true,
              status: replay.responseStatus,
              body: replay.responseBody,
            },
          }
        }
        const target = await readCase(client, actor.organizationId, caseId, true)
        if (target === undefined) throw new LaborAiStoreError('not_found')
        if (target.lifecycle_status !== 'open') throw new LaborAiStoreError('case_closed')
        if (target.version !== input.expectedCaseVersion) {
          throw new LaborAiStoreError('version_conflict')
        }
        await lockMonthlyBudget(client, actor.organizationId)
        const plan = await computePlan(
          client,
          registry,
          actor,
          caseId,
          {
            damageDescription: input.damageDescription,
            providerId: input.providerId,
          },
          target,
        )
        if (
          plan.base.sheetVersion !== input.expectedSheetVersion
          || plan.response.planHash !== input.planHash
        ) {
          throw new LaborAiStoreError('version_conflict')
        }
        const existingResult = await client.query(
          `SELECT * FROM labor_ai_suggestion_runs
            WHERE organization_id=$1 AND case_id=$2 AND plan_hash=$3
              AND provider_id=$4 AND provider_version=$5 AND model_id=$6
              AND prompt_template_version=$7 AND output_schema_version=$8
            FOR UPDATE`,
          [
            actor.organizationId,
            caseId,
            plan.response.planHash,
            plan.response.providerId,
            plan.providerVersionForIdentity,
            plan.modelIdForIdentity,
            LABOR_AI_PROMPT_TEMPLATE_VERSION,
            LABOR_AI_OUTPUT_SCHEMA_VERSION,
          ],
        )
        const existing = existingResult.rows[0] as RunRow | undefined
        if (existing !== undefined) {
          const receiptResult = await client.query(
            `SELECT * FROM labor_ai_provider_receipts
              WHERE labor_suggestion_run_id=$1
              ORDER BY dispatch_started_at DESC,id DESC LIMIT 1 FOR UPDATE`,
            [existing.id],
          )
          const receipt = receiptResult.rows[0] as ReceiptRow | undefined
          if (receipt?.status === 'response_recorded') {
            if (receipt.idempotency_request_hash !== idempotency.requestHash) {
              throw new LaborAiStoreError('idempotency_conflict')
            }
            return { kind: 'recover' as const, runId: existing.id, receiptId: receipt.id }
          }
          const run = await loadRun(client, registry, actor.organizationId, caseId, existing.id)
          if (run === undefined) throw new LaborAiStoreError('not_found')
          if (receipt?.status === 'dispatch_reserved') {
            const elapsedMs = new Date(evaluatedAt).getTime() - receipt.dispatch_started_at.getTime()
            const recoveryThresholdMs = Math.max(1_000, plan.policy.requestTimeoutMs * 2)
            if (elapsedMs >= recoveryThresholdMs) {
              if (receipt.idempotency_request_hash !== idempotency.requestHash) {
                throw new LaborAiStoreError('idempotency_conflict')
              }
              return {
                kind: 'recoverUnknown' as const,
                runId: existing.id,
                receiptId: receipt.id,
              }
            }
            return {
              kind: 'result' as const,
              result: {
                replay: true,
                status: 202,
                body: { run },
              },
            }
          }
          const body = { run }
          await insertIdempotent(client, {
            organizationId: actor.organizationId,
            scope: idempotency.scope,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            responseStatus: 200,
            responseBody: body,
            caseId,
          })
          return {
            kind: 'result' as const,
            result: { replay: true, status: 200, body },
          }
        }
        const providerRequestDigest = hash({
          caseId,
          planHash: plan.response.planHash,
          providerId: plan.response.providerId,
        })
        if (!plan.response.budget.providerAvailable) {
          const run = await finalizeBlocked(
            client,
            registry,
            actor,
            caseId,
            plan,
            'AI_PROVIDER_NOT_CONFIGURED',
            providerRequestDigest,
          )
          const body = { run }
          await insertIdempotent(client, {
            organizationId: actor.organizationId,
            scope: idempotency.scope,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            responseStatus: 201,
            responseBody: body,
            caseId,
          })
          return {
            kind: 'result' as const,
            result: { replay: false, status: 201, body },
          }
        }
        if (!plan.response.budget.allowed) {
          const code = plan.response.budget.reasonCode === 'AI_BUDGET_EXCEEDED'
            ? 'AI_BUDGET_EXCEEDED'
            : 'AI_PROVIDER_DISABLED'
          const run = await finalizeBlocked(
            client,
            registry,
            actor,
            caseId,
            plan,
            code,
            providerRequestDigest,
          )
          const body = { run }
          await insertIdempotent(client, {
            organizationId: actor.organizationId,
            scope: idempotency.scope,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            responseStatus: 201,
            responseBody: body,
            caseId,
          })
          return {
            kind: 'result' as const,
            result: { replay: false, status: 201, body },
          }
        }
        if (
          plan.adapter === undefined
          || !isLaborAiProviderDescriptorCompatible(plan.adapter.descriptor, {
            providerId: plan.response.providerId,
            providerVersion: plan.providerVersionForIdentity,
            modelId: plan.modelIdForIdentity,
            inputCharacters: plan.outbound.outboundInputCharacters,
          })
        ) {
          throw new LaborAiStoreError('state_conflict')
        }
        const runId = uuidv7()
        const requestDigest = providerRequestHash(
          runId,
          plan.response.planHash,
          plan.response.providerId,
        )
        const receiptId = uuidv7()
        await client.query(
          `INSERT INTO labor_ai_suggestion_runs
             (id,organization_id,case_id,base_sheet_version,plan_hash,
              provider_id,provider_version,model_id,prompt_template_version,output_schema_version,
              status,external_provider,privacy_policy_version,outbound_payload_hash,
              outbound_input_characters,redacted_value_count,redacted_categories,privacy_warnings,
              provider_retention_mode,pricing_version,estimated_cost_minor,created_by_user_id,
              started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'running',$11,$12,$13,$14,
                   $15,$16,$17,$18,$19,$20,$21,now())`,
          [
            runId,
            actor.organizationId,
            caseId,
            plan.response.baseSheetVersion,
            plan.response.planHash,
            plan.response.providerId,
            plan.providerVersionForIdentity,
            plan.modelIdForIdentity,
            LABOR_AI_PROMPT_TEMPLATE_VERSION,
            LABOR_AI_OUTPUT_SCHEMA_VERSION,
            plan.externalProvider,
            plan.outbound.privacyPolicyVersion,
            plan.outbound.outboundPayloadHash,
            plan.outbound.outboundInputCharacters,
            plan.outbound.redactedValueCount,
            plan.outbound.redactedCategories,
            plan.outbound.warnings,
            plan.retentionMode,
            plan.pricingVersion,
            plan.response.budget.estimatedCostMinor,
            actor.actorUserId,
          ],
        )
        await client.query(
          `INSERT INTO labor_ai_provider_receipts
             (id,organization_id,case_id,labor_suggestion_run_id,request_hash,
              idempotency_request_hash,client_request_id,provider_id,provider_version,
              model_id,input_characters,estimated_cost_minor,pricing_version,
              created_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            receiptId,
            actor.organizationId,
            caseId,
            runId,
            requestDigest,
            idempotency.requestHash,
            plan.response.providerId,
            plan.providerVersionForIdentity,
            plan.modelIdForIdentity,
            plan.outbound.outboundInputCharacters,
            plan.response.budget.estimatedCostMinor,
            plan.pricingVersion,
            actor.actorUserId,
            actor.requestId,
          ],
        )
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'labor_ai_suggestion.started',
          entityType: 'labor_ai_suggestion',
          entityId: runId,
          details: {
            caseId,
            runId,
            providerId: plan.response.providerId,
            providerVersion: plan.providerVersionForIdentity,
            modelId: plan.modelIdForIdentity,
            baseSheetVersion: plan.response.baseSheetVersion,
            promptTemplateVersion: LABOR_AI_PROMPT_TEMPLATE_VERSION,
            outputSchemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
            externalProvider: plan.externalProvider,
            redactedValueCount: plan.outbound.redactedValueCount,
            redactedCategories: plan.outbound.redactedCategories,
            retentionMode: plan.retentionMode,
            providerCallReceiptId: receiptId,
          },
        })
        return {
          kind: 'dispatch' as const,
          runId,
          receiptId,
          adapter: plan.adapter,
          requestDigest,
          context: plan.outbound.context,
          inputCharacters: plan.outbound.outboundInputCharacters,
          timeoutMs: plan.policy.requestTimeoutMs,
          externalProvider: plan.externalProvider,
        }
      })
      if (prepared.kind === 'result') return prepared.result
      if (prepared.kind === 'recover') {
        return finalizeRecordedReceipt(
          pool,
          registry,
          actor,
          caseId,
          prepared.runId,
          prepared.receiptId,
          idempotency,
        )
      }
      if (prepared.kind === 'recoverUnknown') {
        return finalizeOutcomeUnknown(
          pool,
          registry,
          actor,
          caseId,
          prepared.runId,
          prepared.receiptId,
          idempotency,
        )
      }
      let response: LaborAiProviderResponse
      try {
        response = await executeLaborAiProvider(
          prepared.adapter,
          {
            accountingInputCharacters: prepared.inputCharacters,
            providerRequestId: prepared.requestDigest,
            context: prepared.context,
          },
          prepared.timeoutMs,
        )
      } catch (error) {
        const knownResponse = error instanceof LaborAiProviderExecutionError
          && error.requestOutcome === 'response_received'
        if (prepared.externalProvider && !knownResponse) {
          return finalizeOutcomeUnknown(
            pool,
            registry,
            actor,
            caseId,
            prepared.runId,
            prepared.receiptId,
            idempotency,
          )
        }
        await recordProviderResult(pool, prepared.receiptId, {
          kind: 'failure',
          code: safeProviderFailureCode(error),
          providerResponseId: null,
          providerRequestId: error instanceof LaborAiProviderExecutionError
            ? error.providerRequestId
            : null,
        })
        return finalizeRecordedReceipt(
          pool,
          registry,
          actor,
          caseId,
          prepared.runId,
          prepared.receiptId,
          idempotency,
        )
      }
      const validated = validateLaborAiSuggestion(response.output)
      if (!validated.allowed) {
        await recordProviderResult(pool, prepared.receiptId, {
          kind: 'failure',
          code: validated.code,
          usage: response.usage,
          providerResponseId: response.responseMetadata?.providerResponseId ?? null,
          providerRequestId: response.responseMetadata?.providerRequestId ?? null,
        })
      } else {
        await recordProviderResult(pool, prepared.receiptId, {
          kind: 'success',
          output: validated.suggestion,
          usage: response.usage,
          providerResponseId: response.responseMetadata?.providerResponseId ?? null,
          providerRequestId: response.responseMetadata?.providerRequestId ?? null,
        })
      }
      return finalizeRecordedReceipt(
        pool,
        registry,
        actor,
        caseId,
        prepared.runId,
        prepared.receiptId,
        idempotency,
      )
    },
  }
}

export type LaborAiStore = ReturnType<typeof createLaborAiStore>
