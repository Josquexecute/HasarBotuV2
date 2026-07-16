export type TrafficValueLossStatus =
  | 'draft'
  | 'control_required'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'

export type TrafficValueLossEligibilityStatus =
  | 'calculable'
  | 'no_value_loss'
  | 'not_applicable'
  | 'control_required'

export type TrafficValueLossEvidenceField =
  | 'vehicle_identity'
  | 'mileage'
  | 'usage_type'
  | 'damage_parts'
  | 'prior_damage'
  | 'pre_accident_market_value'
  | 'post_repair_market_value'
  | 'fault_rate'
  | 'heavy_damage_status'

export interface TrafficValueLossEvidenceInput {
  readonly evidenceKey: string
  readonly sourceType: 'document_version' | 'market_comparable' | 'sbm_history' | 'expert_observation'
  readonly documentId: string | null
  readonly documentVersionId: string | null
  readonly externalReference: string | null
  readonly sourceHash: string
  readonly observedAt: string | null
  readonly supports: readonly TrafficValueLossEvidenceField[]
  readonly verificationStatus: 'verified' | 'control_required'
  readonly conflict: boolean
  readonly notes: string | null
}

export interface TrafficValueLossComparableInput {
  readonly comparableKey: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amountMinor: number
  readonly mileage: number | null
  readonly observedAt: string
  readonly evidenceKey: string
  readonly excluded: boolean
  readonly exclusionReason: string | null
}

export interface TrafficValueLossDamagePartInput {
  readonly partCode: string
  readonly partName: string
  readonly repairAction: 'repair_paint' | 'replace_paint' | 'paint' | 'replace' | 'paintless_repair'
  readonly priorDamage: 'yes' | 'no' | 'unknown'
}

export interface TrafficValueLossDraftInput {
  readonly evaluatedOn: string
  readonly heavyOrTotalDamage: boolean | null
  readonly vehicle: {
    readonly make: string | null
    readonly model: string | null
    readonly variant: string | null
    readonly modelYear: number | null
    readonly mileage: number | null
    readonly usageType: string | null
  }
  readonly faultRateBasisPoints: number | null
  readonly preAccidentMarketValueMinor: number | null
  readonly postRepairMarketValueMinor: number | null
  readonly damageParts: readonly TrafficValueLossDamagePartInput[]
  readonly comparables: readonly TrafficValueLossComparableInput[]
  readonly evidence: readonly TrafficValueLossEvidenceInput[]
}

export interface TrafficValueLossEvidenceRecord extends TrafficValueLossEvidenceInput {
  readonly id: string
  readonly createdAt: string
}

export interface TrafficValueLossComparableRecord {
  readonly id: string
  readonly comparableKey: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amountMinor: number
  readonly mileage: number | null
  readonly observedAt: string
  readonly evidenceId: string
  readonly excluded: boolean
  readonly exclusionReason: string | null
}

export interface TrafficValueLossVersionRecord {
  readonly id: string
  readonly assessmentVersion: number
  readonly status: TrafficValueLossStatus
  readonly ruleSetId: string
  readonly ruleVersion: string
  readonly effectiveFrom: string
  readonly input: {
    readonly lossDate: string | null
    readonly notificationDate: string | null
    readonly evaluatedOn: string
    readonly heavyOrTotalDamage: boolean | null
    readonly vehicle: TrafficValueLossDraftInput['vehicle']
    readonly faultRateBasisPoints: number | null
    readonly preAccidentMarketValueMinor: number | null
    readonly postRepairMarketValueMinor: number | null
    readonly damageParts: readonly TrafficValueLossDamagePartInput[]
  }
  readonly evaluation: {
    readonly ruleSetId: string
    readonly ruleVersion: string
    readonly effectiveFrom: string
    readonly calculationMethod: 'market_value_difference'
    readonly roundingRule: 'half_up_minor_unit'
    readonly ruleSources: readonly {
      readonly code: string
      readonly title: string
      readonly sourceType: 'official_gazette' | 'seddk_circular'
      readonly publishedAt: string
      readonly effectiveFrom: string
      readonly locator: string
      readonly url: string
    }[]
    readonly eligibilityStatus: TrafficValueLossEligibilityStatus
    readonly grossValueLossMinor: number | null
    readonly faultAdjustedValueLossMinor: number | null
    readonly qualifyingPreComparableCount: number
    readonly qualifyingPostComparableCount: number
    readonly uncertainties: readonly {
      readonly code: string
      readonly field: string
      readonly reason: string
      readonly blocking: boolean
      readonly requiresHumanReview: true
    }[]
    readonly reasoning: readonly string[]
    readonly humanApprovalRequired: true
    readonly canSubmitForApproval: boolean
  }
  readonly evidence: readonly TrafficValueLossEvidenceRecord[]
  readonly comparables: readonly TrafficValueLossComparableRecord[]
  readonly humanApprovalStatus: 'pending' | 'approved' | 'rejected'
  readonly approvedBy: string | null
  readonly approvedAt: string | null
  readonly approvalReason: string | null
  readonly createdBy: string
  readonly createdAt: string
}

export interface TrafficValueLossAssessmentRecord {
  readonly id: string
  readonly caseId: string
  readonly currentVersion: TrafficValueLossVersionRecord
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TrafficValueLossWorkspaceRecord {
  readonly assessment: TrafficValueLossAssessmentRecord | null
  readonly versions: readonly TrafficValueLossVersionRecord[]
}

export type TrafficValueLossErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unavailable'

export class TrafficValueLossError extends Error {
  constructor(readonly kind: TrafficValueLossErrorKind, message: string) {
    super(message)
    this.name = 'TrafficValueLossError'
  }
}

export interface TrafficValueLossDataPort {
  load(caseId: string): Promise<TrafficValueLossWorkspaceRecord>
  createVersion(caseId: string, expectedVersion: number, input: TrafficValueLossDraftInput, idempotencyKey?: string): Promise<TrafficValueLossAssessmentRecord>
  submit(caseId: string, versionId: string, expectedVersion: number, idempotencyKey?: string): Promise<TrafficValueLossAssessmentRecord>
  approve(caseId: string, versionId: string, expectedVersion: number, reason: string | null, idempotencyKey?: string): Promise<TrafficValueLossAssessmentRecord>
  reject(caseId: string, versionId: string, expectedVersion: number, reason: string, idempotencyKey?: string): Promise<TrafficValueLossAssessmentRecord>
}

export interface TrafficValueLossAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

function isSafeExternalReference(value: unknown): value is string | null {
  if (value === null) return true
  return typeof value === 'string' && value.length <= 500 && !value.includes('\\')
    && (/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/.test(value)
      || /^ref:(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value))
}

const VERSION_STATUSES: readonly TrafficValueLossStatus[] = [
  'draft', 'control_required', 'awaiting_approval', 'approved', 'rejected', 'superseded',
]
const ELIGIBILITY_STATUSES: readonly TrafficValueLossEligibilityStatus[] = [
  'calculable', 'no_value_loss', 'not_applicable', 'control_required',
]

function parseVersion(value: unknown): TrafficValueLossVersionRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || !Number.isInteger(value.assessmentVersion)
    || !VERSION_STATUSES.includes(value.status as TrafficValueLossStatus)
    || typeof value.ruleSetId !== 'string' || typeof value.ruleVersion !== 'string'
    || typeof value.effectiveFrom !== 'string' || !isRecord(value.input) || !isRecord(value.evaluation)
    || !Array.isArray(value.evidence) || !Array.isArray(value.comparables)
    || !['pending', 'approved', 'rejected'].includes(String(value.humanApprovalStatus))
    || typeof value.createdBy !== 'string' || typeof value.createdAt !== 'string') {
    throw new TrafficValueLossError('unavailable', 'traffic value loss version response is invalid')
  }
  const evaluation = value.evaluation
  if (!ELIGIBILITY_STATUSES.includes(evaluation.eligibilityStatus as TrafficValueLossEligibilityStatus)
    || evaluation.calculationMethod !== 'market_value_difference' || evaluation.roundingRule !== 'half_up_minor_unit'
    || !isSafeIntegerOrNull(evaluation.grossValueLossMinor) || !isSafeIntegerOrNull(evaluation.faultAdjustedValueLossMinor)
    || !Array.isArray(evaluation.uncertainties) || !Array.isArray(evaluation.reasoning)
    || !Array.isArray(evaluation.ruleSources) || typeof evaluation.canSubmitForApproval !== 'boolean'
    || evaluation.humanApprovalRequired !== true) {
    throw new TrafficValueLossError('unavailable', 'traffic value loss evaluation response is invalid')
  }
  for (const uncertainty of evaluation.uncertainties) {
    if (!isRecord(uncertainty) || typeof uncertainty.code !== 'string' || typeof uncertainty.field !== 'string'
      || typeof uncertainty.reason !== 'string' || typeof uncertainty.blocking !== 'boolean'
      || uncertainty.requiresHumanReview !== true) {
      throw new TrafficValueLossError('unavailable', 'traffic value loss uncertainty response is invalid')
    }
  }
  for (const evidence of value.evidence) {
    if (!isRecord(evidence) || typeof evidence.id !== 'string' || typeof evidence.evidenceKey !== 'string'
      || !isSafeExternalReference(evidence.externalReference) || typeof evidence.sourceHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(evidence.sourceHash) || !Array.isArray(evidence.supports)
      || !['verified', 'control_required'].includes(String(evidence.verificationStatus))
      || typeof evidence.conflict !== 'boolean') {
      throw new TrafficValueLossError('unavailable', 'traffic value loss evidence response is invalid')
    }
  }
  for (const comparable of value.comparables) {
    if (!isRecord(comparable) || typeof comparable.id !== 'string' || typeof comparable.comparableKey !== 'string'
      || !['pre_accident', 'post_repair'].includes(String(comparable.side))
      || !isSafeIntegerOrNull(comparable.amountMinor) || comparable.amountMinor === null
      || typeof comparable.observedAt !== 'string' || typeof comparable.evidenceId !== 'string') {
      throw new TrafficValueLossError('unavailable', 'traffic value loss comparable response is invalid')
    }
  }
  return value as unknown as TrafficValueLossVersionRecord
}

function parseAssessmentEnvelope(value: unknown): TrafficValueLossAssessmentRecord {
  const assessment = isRecord(value) ? value.assessment : undefined
  if (!isRecord(assessment) || typeof assessment.id !== 'string' || typeof assessment.caseId !== 'string'
    || !Number.isInteger(assessment.version) || typeof assessment.createdAt !== 'string'
    || typeof assessment.updatedAt !== 'string') {
    throw new TrafficValueLossError('unavailable', 'traffic value loss assessment response is invalid')
  }
  return { ...assessment, currentVersion: parseVersion(assessment.currentVersion) } as TrafficValueLossAssessmentRecord
}

function parseVersionsEnvelope(value: unknown): readonly TrafficValueLossVersionRecord[] {
  const versions = isRecord(value) ? value.versions : undefined
  if (!Array.isArray(versions)) throw new TrafficValueLossError('unavailable', 'traffic value loss versions response is invalid')
  return versions.map(parseVersion)
}

function safeKey(): string {
  if (globalThis.crypto?.randomUUID !== undefined) return globalThis.crypto.randomUUID()
  throw new TrafficValueLossError('unavailable', 'secure idempotency key generation unavailable')
}

function errorFor(status: number): TrafficValueLossError {
  if (status === 401) return new TrafficValueLossError('unauthorized', 'traffic value loss API HTTP 401')
  if (status === 403) return new TrafficValueLossError('forbidden', 'traffic value loss API HTTP 403')
  if (status === 400) return new TrafficValueLossError('validation', 'traffic value loss request validation failed')
  if (status === 404) return new TrafficValueLossError('not_found', 'traffic value loss assessment not found')
  if (status === 409) return new TrafficValueLossError('conflict', 'traffic value loss state changed')
  return new TrafficValueLossError('unavailable', `traffic value loss API HTTP ${status}`)
}

export function createHttpTrafficValueLossAdapter(options: TrafficValueLossAdapterOptions = {}): TrafficValueLossDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }
  const makeKey = options.idempotencyKeyFactory ?? safeKey

  async function raw(path: string, init?: RequestInit): Promise<{ readonly response: Response; readonly body: unknown }> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
      })
    } catch {
      throw new TrafficValueLossError('unavailable', 'traffic value loss API unreachable')
    }
    let body: unknown = null
    try { body = await response.json() } catch { /* güvenli hata eşlemesi status üzerinden yapılır */ }
    return { response, body }
  }

  async function command(path: string, body: unknown, idempotencyKey?: string): Promise<TrafficValueLossAssessmentRecord> {
    const result = await raw(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey ?? makeKey() },
      body: JSON.stringify(body),
    })
    if (!result.response.ok) throw errorFor(result.response.status)
    return parseAssessmentEnvelope(result.body)
  }

  return {
    async load(caseId) {
      const encodedCaseId = encodeURIComponent(caseId)
      const current = await raw(`/api/v1/cases/${encodedCaseId}/traffic-value-loss`)
      if (current.response.status === 404) return { assessment: null, versions: [] }
      if (!current.response.ok) throw errorFor(current.response.status)
      const assessment = parseAssessmentEnvelope(current.body)
      const history = await raw(`/api/v1/cases/${encodedCaseId}/traffic-value-loss/versions`)
      if (!history.response.ok) throw errorFor(history.response.status)
      return { assessment, versions: parseVersionsEnvelope(history.body) }
    },
    createVersion(caseId, expectedVersion, input, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions`,
        { expectedVersion, ...input }, idempotencyKey)
    },
    submit(caseId, versionId, expectedVersion, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions/${encodeURIComponent(versionId)}/submit`,
        { expectedVersion }, idempotencyKey)
    },
    approve(caseId, versionId, expectedVersion, reason, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions/${encodeURIComponent(versionId)}/approve`,
        { expectedVersion, reason }, idempotencyKey)
    },
    reject(caseId, versionId, expectedVersion, reason, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions/${encodeURIComponent(versionId)}/reject`,
        { expectedVersion, reason }, idempotencyKey)
    },
  }
}
