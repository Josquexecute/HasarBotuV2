export type EmailDraftTypeRecord =
  | 'repair_approval_request'
  | 'missing_document_request'
  | 'preliminary_report_notice'
  | 'service_change_notice'
  | 'deductible_service_part_notice'
  | 'portal_deductible_note'
  | 'closure_documents_request'
  | 'case_status_update'
  | 'recourse_documents_request'
  | 'pert_evaluation_notice'
  | 'custom_instruction'

export interface EmailDraftAttachmentInput {
  readonly resourceType: 'document_version' | 'photo'
  readonly resourceId: string
}

export interface EmailDraftAttachmentRecord extends EmailDraftAttachmentInput {
  readonly documentType: string | null
  readonly displayName: string
  readonly mimeType: string
  readonly byteSize: number
  readonly status: 'ready'
}

export interface EmailDraftAttachmentOptionRecord extends EmailDraftAttachmentRecord {
  readonly preferred: boolean
}

export interface EmailDraftPreviewRecord {
  readonly caseId: string
  readonly caseVersion: number
  readonly draftType: EmailDraftTypeRecord
  readonly templateVersion: 'email-draft-template/1.0.0'
  readonly subject: string
  readonly body: string
  readonly sourceRule: string
  readonly recipientStatus: 'control_required'
  readonly recipientReason: string
  readonly missingRequirementCodes: readonly string[]
  readonly controlRequiredRequirementCodes: readonly string[]
  readonly attachmentOptions: readonly EmailDraftAttachmentOptionRecord[]
  readonly previewHash: string
  readonly requiresHumanReview: true
}

export interface EmailDraftVersionRecord {
  readonly id: string
  readonly draftVersion: number
  readonly previousVersionId: string | null
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
  readonly attachments: readonly EmailDraftAttachmentRecord[]
  readonly templateVersion: 'email-draft-template/1.0.0'
  readonly sourceType: 'deterministic_template' | 'ai_assisted' | 'manual_revision'
  readonly emailAiSuggestionRunId: string | null
  readonly previewHash: string
  readonly revisionReason: string | null
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
}

export interface EmailDraftHandoffHistoryRecord {
  readonly id: string
  readonly draftVersionId: string
  readonly provider: 'gmail_web'
  readonly preparedByUserId: string
  readonly preparedByDisplayName: string
  readonly preparedAt: string
}

export interface EmailDraftRecord {
  readonly id: string
  readonly caseId: string
  readonly draftType: EmailDraftTypeRecord
  readonly version: number
  readonly currentVersion: EmailDraftVersionRecord
  readonly versions: readonly EmailDraftVersionRecord[]
  readonly handoffs: readonly EmailDraftHandoffHistoryRecord[]
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EmailDraftWorkspaceRecord {
  readonly caseId: string
  readonly lifecycleStatus: 'open' | 'closed'
  readonly drafts: readonly EmailDraftRecord[]
  readonly permissions: {
    readonly canWrite: boolean
    readonly canPrepareHandoff: boolean
  }
}

export interface EmailDraftHandoffRecord {
  readonly draft: EmailDraftRecord
  readonly handoff: EmailDraftHandoffHistoryRecord
  readonly compose: {
    readonly to: readonly string[]
    readonly cc: readonly string[]
    readonly subject: string
    readonly body: string
    readonly attachments: readonly EmailDraftAttachmentRecord[]
  }
  readonly deliveryStatus: 'not_sent'
}

export interface EmailDraftPreviewInput {
  readonly draftType: EmailDraftTypeRecord
  readonly instruction: string | null
}

export interface EmailDraftCreateInput {
  readonly expectedCaseVersion: number
  readonly draftType: EmailDraftTypeRecord
  readonly instruction: string | null
  readonly previewHash: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
  readonly emailAiSuggestionRunId?: string | null
  readonly attachments: readonly EmailDraftAttachmentInput[]
  readonly confirmed: true
}

export interface EmailDraftReviseInput {
  readonly expectedVersion: number
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
  readonly attachments: readonly EmailDraftAttachmentInput[]
  readonly reason: string
  readonly confirmed: true
}

export interface EmailDraftDataPort {
  load(caseId: string): Promise<EmailDraftWorkspaceRecord>
  preview(caseId: string, input: EmailDraftPreviewInput): Promise<EmailDraftPreviewRecord>
  create(caseId: string, input: EmailDraftCreateInput, idempotencyKey?: string): Promise<EmailDraftRecord>
  revise(
    caseId: string,
    draftId: string,
    input: EmailDraftReviseInput,
    idempotencyKey?: string,
  ): Promise<EmailDraftRecord>
  prepareHandoff(
    caseId: string,
    draftId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<EmailDraftHandoffRecord>
}

export type EmailDraftErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class EmailDraftError extends Error {
  readonly kind: EmailDraftErrorKind

  constructor(kind: EmailDraftErrorKind, message: string) {
    super(message)
    this.name = 'EmailDraftError'
    this.kind = kind
  }
}

export interface EmailDraftAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureIdempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new EmailDraftError('unavailable', 'secure idempotency unavailable')
  return value
}

function mapError(status: number): EmailDraftError {
  if (status === 401) return new EmailDraftError('unauthorized', 'session required')
  if (status === 403) return new EmailDraftError('forbidden', 'permission required')
  if (status === 404) return new EmailDraftError('not_found', 'email draft resource not found')
  if (status === 400) return new EmailDraftError('validation', 'email draft validation failed')
  if (status === 409) return new EmailDraftError('conflict', 'email draft conflict')
  return new EmailDraftError('unavailable', `email draft HTTP ${status}`)
}

export function buildGmailWebComposeUrl(input: {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
}): string {
  const parameters: [string, string][] = [
    ['view', 'cm'],
    ['fs', '1'],
    ['tf', '1'],
    ['to', input.to.join(',')],
  ]
  if (input.cc.length > 0) parameters.push(['cc', input.cc.join(',')])
  parameters.push(['su', input.subject], ['body', input.body])
  return `https://mail.google.com/mail/?${parameters
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`
}

export function createHttpEmailDraftAdapter(options: EmailDraftAdapterOptions = {}): EmailDraftDataPort {
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
      throw new EmailDraftError('unavailable', 'email draft endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new EmailDraftError('unavailable', 'email draft response invalid')
    }
  }

  return {
    async load(caseId) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/email-drafts`, 'GET')
      const { emailDraftWorkspaceResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailDraftWorkspaceResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailDraftError('unavailable', 'email draft workspace response invalid')
      return parsed.data
    },
    async preview(caseId, input) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-drafts/preview`,
        'POST',
        input,
      )
      const { emailDraftPreviewResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailDraftPreviewResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailDraftError('unavailable', 'email draft preview response invalid')
      return parsed.data
    },
    async create(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-drafts`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { emailDraftResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailDraftResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailDraftError('unavailable', 'email draft response invalid')
      return parsed.data.draft
    },
    async revise(caseId, draftId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-drafts/${encodeURIComponent(draftId)}/versions`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { emailDraftResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailDraftResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailDraftError('unavailable', 'email draft response invalid')
      return parsed.data.draft
    },
    async prepareHandoff(caseId, draftId, expectedVersion, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/email-drafts/${encodeURIComponent(draftId)}/handoffs`,
        'POST',
        { expectedVersion, confirmed: true },
        key ?? makeKey(),
      )
      const { emailDraftHandoffResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = emailDraftHandoffResponseSchema.safeParse(value)
      if (!parsed.success) throw new EmailDraftError('unavailable', 'email handoff response invalid')
      return parsed.data
    },
  }
}
