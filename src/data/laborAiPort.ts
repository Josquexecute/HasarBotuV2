export type LaborAiProviderIdRecord =
  | 'deterministic-success'
  | 'deterministic-invalid-schema'
  | 'deterministic-timeout'
  | 'deterministic-failure'
  | 'gemini-generate-content'

export interface LaborAiPlanInput {
  readonly damageDescription: string
  readonly providerId: LaborAiProviderIdRecord
}

export interface LaborAiPrivacyRecord {
  readonly externalProvider: boolean
  readonly policyVersion: 'labor-ai-pii-redaction/1.0.0' | 'labor-ai-pii/local-only'
  readonly outboundPayloadHash: string | null
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly string[]
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly warnings: readonly string[]
}

export interface LaborAiBudgetRecord {
  readonly enabled: boolean
  readonly providerAvailable: boolean
  readonly providerAllowed: boolean
  readonly estimatedCostMinor: number
  readonly currentMonthCostMinor: number
  readonly monthlyBudgetMinor: number
  readonly perRequestBudgetMinor: number
  readonly allowed: boolean
  readonly reasonCode:
    | 'AI_PROVIDER_DISABLED'
    | 'AI_BUDGET_EXCEEDED'
    | 'AI_PROVIDER_NOT_CONFIGURED'
    | null
}

export interface LaborAiSuggestedItemRecord {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
}

export interface LaborAiPlanRecord {
  readonly caseId: string
  readonly caseVersion: number
  readonly baseSheetVersion: number | null
  readonly providerId: LaborAiProviderIdRecord
  readonly providerVersion: string | null
  readonly modelId: string | null
  readonly promptTemplateVersion: 'labor-ai-draft/1.0.0'
  readonly outputSchemaVersion: 'labor-ai-suggestion/1.0.0'
  readonly planHash: string
  readonly privacy: LaborAiPrivacyRecord
  readonly budget: LaborAiBudgetRecord
  readonly canStart: boolean
  readonly requiresExplicitEgressConfirmation: boolean
  readonly requiresHumanReview: true
}

export interface LaborAiRunRecord {
  readonly id: string
  readonly caseId: string
  readonly status:
    | 'provider_disabled'
    | 'budget_blocked'
    | 'running'
    | 'review_required'
    | 'failed'
    | 'outcome_unknown'
  readonly providerId: LaborAiProviderIdRecord
  readonly providerVersion: string
  readonly modelId: string
  readonly promptTemplateVersion: 'labor-ai-draft/1.0.0'
  readonly outputSchemaVersion: 'labor-ai-suggestion/1.0.0'
  readonly baseSheetVersion: number | null
  readonly planHash: string
  readonly version: number
  readonly privacy: LaborAiPrivacyRecord
  readonly budget: LaborAiBudgetRecord
  readonly suggestion: {
    readonly schemaVersion: 'labor-ai-suggestion/1.0.0'
    readonly items: readonly LaborAiSuggestedItemRecord[]
    readonly reasoning: string
    readonly warnings: readonly string[]
    readonly confidence: number
    readonly requiresHumanReview: true
  } | null
  readonly safeErrorCode: string | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface LaborAiRunsRecord {
  readonly caseId: string
  readonly items: readonly LaborAiRunRecord[]
  readonly permissions: { readonly canStart: boolean }
}

export interface LaborAiStartInput extends LaborAiPlanInput {
  readonly expectedCaseVersion: number
  readonly expectedSheetVersion: number | null
  readonly planHash: string
  readonly confirmed: true
}

export interface LaborAiDataPort {
  list(caseId: string): Promise<LaborAiRunsRecord>
  plan(caseId: string, input: LaborAiPlanInput): Promise<LaborAiPlanRecord>
  start(caseId: string, input: LaborAiStartInput, idempotencyKey?: string): Promise<LaborAiRunRecord>
}

export type LaborAiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class LaborAiError extends Error {
  constructor(
    readonly kind: LaborAiErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'LaborAiError'
  }
}

export interface LaborAiAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureIdempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new LaborAiError('unavailable', 'secure idempotency unavailable')
  return value
}

function mapError(status: number): LaborAiError {
  if (status === 401) return new LaborAiError('unauthorized', 'session required')
  if (status === 403) return new LaborAiError('forbidden', 'permission required')
  if (status === 404) return new LaborAiError('not_found', 'labor AI resource not found')
  if (status === 400) return new LaborAiError('validation', 'labor AI validation failed')
  if (status === 409) return new LaborAiError('conflict', 'labor AI conflict')
  return new LaborAiError('unavailable', `labor AI HTTP ${status}`)
}

export function createHttpLaborAiAdapter(options: LaborAiAdapterOptions = {}): LaborAiDataPort {
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
      throw new LaborAiError('unavailable', 'labor AI endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new LaborAiError('unavailable', 'labor AI response invalid')
    }
  }

  return {
    async list(caseId) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-ai-suggestions`,
        'GET',
      )
      const { laborAiRunsResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAiRunsResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborAiError('unavailable', 'labor AI list response invalid')
      return parsed.data
    },
    async plan(caseId, input) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-ai-suggestions/plan`,
        'POST',
        input,
      )
      const { laborAiPlanResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAiPlanResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborAiError('unavailable', 'labor AI plan response invalid')
      return parsed.data
    },
    async start(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/labor-ai-suggestions`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { laborAiRunResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = laborAiRunResponseSchema.safeParse(value)
      if (!parsed.success) throw new LaborAiError('unavailable', 'labor AI run response invalid')
      return parsed.data.run
    },
  }
}
