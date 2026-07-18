export type PertWorkflowStatusRecord =
  | 'review_not_started'
  | 'data_missing'
  | 'under_review'
  | 'repair_indicated'
  | 'pert_candidate'
  | 'expert_opinion_issued'
  | 'center_decision_pending'
  | 'repair_decided'
  | 'pert_decided'

export type PertDecisionRecord = 'repair' | 'pert'

export interface PertAssessmentPayloadRecord {
  readonly workflowStatus: PertWorkflowStatusRecord
  readonly estimatedDamageMinor: number | null
  readonly marketValueMinor: number | null
  readonly structuralNote: string | null
  readonly expertOpinion: PertDecisionRecord | null
  readonly expertRationale: string | null
  readonly centerDecision: PertDecisionRecord | null
  readonly centerNote: string | null
}

export interface PertAssessmentVersionRecord extends PertAssessmentPayloadRecord {
  readonly id: string
  readonly assessmentVersion: number
  readonly previousVersionId: string | null
  readonly damageRatioPercent: number | null
  readonly schemaVersion: 'pert-assessment/1.0.0'
  readonly currency: 'TRY'
  readonly sourceType: 'user_entered' | 'manual_revision'
  readonly revisionReason: string | null
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
}

export interface PertAssessmentRecord {
  readonly id: string
  readonly caseId: string
  readonly version: number
  readonly currentVersion: PertAssessmentVersionRecord
  readonly versions: readonly PertAssessmentVersionRecord[]
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PertWorkspaceRecord {
  readonly caseId: string
  readonly caseVersion: number
  readonly lifecycleStatus: 'open' | 'closed'
  readonly assessment: PertAssessmentRecord | null
  readonly permissions: {
    readonly canWrite: boolean
  }
}

export interface PertCreateInput extends PertAssessmentPayloadRecord {
  readonly expectedCaseVersion: number
  readonly confirmed: true
}

export interface PertReviseInput extends PertAssessmentPayloadRecord {
  readonly expectedVersion: number
  readonly reason: string
  readonly confirmed: true
}

export interface PertDataPort {
  load(caseId: string): Promise<PertWorkspaceRecord>
  create(caseId: string, input: PertCreateInput, idempotencyKey?: string): Promise<PertAssessmentRecord>
  revise(caseId: string, input: PertReviseInput, idempotencyKey?: string): Promise<PertAssessmentRecord>
}

export type PertErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class PertError extends Error {
  readonly kind: PertErrorKind

  constructor(kind: PertErrorKind, message: string) {
    super(message)
    this.name = 'PertError'
    this.kind = kind
  }
}

export interface PertAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureIdempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new PertError('unavailable', 'secure idempotency unavailable')
  return value
}

function mapError(status: number): PertError {
  if (status === 401) return new PertError('unauthorized', 'session required')
  if (status === 403) return new PertError('forbidden', 'permission required')
  if (status === 404) return new PertError('not_found', 'pert assessment resource not found')
  if (status === 400) return new PertError('validation', 'pert assessment validation failed')
  if (status === 409) return new PertError('conflict', 'pert assessment conflict')
  return new PertError('unavailable', `pert assessment HTTP ${status}`)
}

export function createHttpPertAdapter(options: PertAdapterOptions = {}): PertDataPort {
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
      throw new PertError('unavailable', 'pert assessment endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new PertError('unavailable', 'pert assessment response invalid')
    }
  }

  return {
    async load(caseId) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/pert-assessment`, 'GET')
      const { pertAssessmentWorkspaceResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = pertAssessmentWorkspaceResponseSchema.safeParse(value)
      if (!parsed.success) throw new PertError('unavailable', 'pert workspace response invalid')
      return parsed.data
    },
    async create(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/pert-assessment`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { pertAssessmentResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = pertAssessmentResponseSchema.safeParse(value)
      if (!parsed.success) throw new PertError('unavailable', 'pert assessment response invalid')
      return parsed.data.assessment
    },
    async revise(caseId, input, key) {
      const value = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/pert-assessment/versions`,
        'POST',
        input,
        key ?? makeKey(),
      )
      const { pertAssessmentResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = pertAssessmentResponseSchema.safeParse(value)
      if (!parsed.success) throw new PertError('unavailable', 'pert assessment response invalid')
      return parsed.data.assessment
    },
  }
}
