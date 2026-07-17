import type { EmailDraftTypeRecord } from './emailDraftPort'

export type EmailAiProviderIdRecord =
  | 'deterministic-success'
  | 'deterministic-invalid-schema'
  | 'deterministic-timeout'
  | 'deterministic-failure'
  | 'gemini-generate-content'

export interface EmailAiPlanInput {
  readonly draftType: EmailDraftTypeRecord
  readonly instruction: string | null
  readonly providerId: EmailAiProviderIdRecord
}

export interface EmailAiPrivacyRecord {
  readonly externalProvider: boolean
  readonly policyVersion: 'email-ai-pii-redaction/1.0.0' | 'email-ai-pii/local-only'
  readonly outboundPayloadHash: string | null
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly string[]
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly warnings: readonly string[]
}

export interface EmailAiBudgetRecord {
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

export interface EmailAiPlanRecord {
  readonly caseId: string
  readonly caseVersion: number
  readonly draftType: EmailDraftTypeRecord
  readonly providerId: EmailAiProviderIdRecord
  readonly providerVersion: string | null
  readonly modelId: string | null
  readonly promptTemplateVersion: 'email-ai-draft/1.0.0'
  readonly outputSchemaVersion: 'email-ai-suggestion/1.0.0'
  readonly basePreview: {
    readonly subject: string
    readonly body: string
    readonly previewHash: string
  }
  readonly planHash: string
  readonly privacy: EmailAiPrivacyRecord
  readonly budget: EmailAiBudgetRecord
  readonly canStart: boolean
  readonly requiresExplicitEgressConfirmation: boolean
  readonly requiresHumanReview: true
}

export interface EmailAiRunRecord {
  readonly id: string
  readonly caseId: string
  readonly draftType: EmailDraftTypeRecord
  readonly status:
    | 'provider_disabled'
    | 'budget_blocked'
    | 'running'
    | 'review_required'
    | 'failed'
    | 'outcome_unknown'
  readonly providerId: EmailAiProviderIdRecord
  readonly providerVersion: string
  readonly modelId: string
  readonly promptTemplateVersion: 'email-ai-draft/1.0.0'
  readonly outputSchemaVersion: 'email-ai-suggestion/1.0.0'
  readonly basePreviewHash: string
  readonly planHash: string
  readonly version: number
  readonly privacy: EmailAiPrivacyRecord
  readonly budget: EmailAiBudgetRecord
  readonly suggestion: {
    readonly schemaVersion: 'email-ai-suggestion/1.0.0'
    readonly subject: string
    readonly body: string
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

export interface EmailAiRunsRecord {
  readonly caseId: string
  readonly items: readonly EmailAiRunRecord[]
  readonly permissions: { readonly canStart: boolean }
}

export interface EmailAiStartInput extends EmailAiPlanInput {
  readonly expectedCaseVersion: number
  readonly expectedPreviewHash: string
  readonly planHash: string
  readonly confirmed: true
}

export interface EmailAiDataPort {
  list(caseId: string): Promise<EmailAiRunsRecord>
  plan(caseId: string, input: EmailAiPlanInput): Promise<EmailAiPlanRecord>
  start(caseId: string, input: EmailAiStartInput, idempotencyKey?: string): Promise<EmailAiRunRecord>
}

export type EmailAiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class EmailAiError extends Error {
  constructor(
    readonly kind: EmailAiErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'EmailAiError'
  }
}

export interface EmailAiAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureIdempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new EmailAiError('unavailable', 'secure idempotency unavailable')
  return value
}

function mapError(status: number): EmailAiError {
  if (status === 401) return new EmailAiError('unauthorized', 'session required')
  if (status === 403) return new EmailAiError('forbidden', 'permission required')
  if (status === 404) return new EmailAiError('not_found', 'email AI resource not found')
  if (status === 400) return new EmailAiError('validation', 'email AI validation failed')
  if (status === 409) return new EmailAiError('conflict', 'email AI conflict')
  return new EmailAiError('unavailable', `email AI HTTP ${status}`)
}

export function createHttpEmailAiAdapter(options: EmailAiAdapterOptions = {}): EmailAiDataPort {
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
      throw new EmailAiError('unavailable', 'email AI endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new EmailAiError('unavailable', 'email AI response invalid')
    }
  }

  return {
    async list(caseId) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-ai-suggestions`,
        'GET',
      )
      const { emailAiRunsResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailAiRunsResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailAiError('unavailable', 'email AI list response invalid')
      return parsed.data
    },
    async plan(caseId, input) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-ai-suggestions/plan`,
        'POST',
        input,
      )
      const { emailAiPlanResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailAiPlanResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailAiError('unavailable', 'email AI plan response invalid')
      return parsed.data
    },
    async start(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-ai-suggestions`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { emailAiRunResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailAiRunResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailAiError('unavailable', 'email AI run response invalid')
      return parsed.data.run
    },
  }
}
