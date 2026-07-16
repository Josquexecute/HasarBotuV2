import type {
  TrafficValueLossDamagePartInput,
  TrafficValueLossEvidenceField,
  TrafficValueLossEligibilityStatus,
} from './trafficValueLossPort'

export interface TrafficValueLossReportEvidenceRecord {
  readonly id: string
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

export interface TrafficValueLossReportComparableRecord {
  readonly id: string
  readonly comparableKey: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amountMinor: number
  readonly mileage: number | null
  readonly observedAt: string
  readonly evidenceId: string
  readonly evidenceKey: string
  readonly sourceReference: string | null
  readonly excluded: boolean
  readonly exclusionReason: string | null
}

export interface TrafficValueLossReportContentRecord {
  readonly schemaVersion: 'traffic-value-loss-final-report/1.0.0'
  readonly templateVersion: 'traffic-value-loss-final-report-tr/1.0.0'
  readonly title: 'Trafik Değer Kaybı Nihai Raporu'
  readonly caseReference: {
    readonly caseId: string
    readonly officeNumber: string
    readonly plate: string
    readonly caseType: 'traffic'
    readonly lossDate: string | null
    readonly notificationDate: string | null
  }
  readonly assessment: {
    readonly assessmentId: string
    readonly versionId: string
    readonly assessmentVersion: number
    readonly status: 'approved' | 'superseded'
    readonly humanApprovalStatus: 'approved'
    readonly approvedBy: string
    readonly approvedAt: string
    readonly approvalReason: string | null
  }
  readonly vehicle: {
    readonly make: string | null
    readonly model: string | null
    readonly variant: string | null
    readonly modelYear: number | null
    readonly mileage: number | null
    readonly usageType: string | null
  }
  readonly damageParts: readonly TrafficValueLossDamagePartInput[]
  readonly calculation: {
    readonly eligibilityStatus: TrafficValueLossEligibilityStatus
    readonly calculationMethod: 'market_value_difference'
    readonly roundingRule: 'half_up_minor_unit'
    readonly preAccidentMarketValueMinor: number | null
    readonly postRepairMarketValueMinor: number | null
    readonly grossValueLossMinor: number | null
    readonly faultRateBasisPoints: number | null
    readonly faultAdjustedValueLossMinor: number | null
    readonly qualifyingPreComparableCount: number
    readonly qualifyingPostComparableCount: number
    readonly reasoning: readonly string[]
  }
  readonly evidence: readonly TrafficValueLossReportEvidenceRecord[]
  readonly comparables: readonly TrafficValueLossReportComparableRecord[]
  readonly uncertainties: readonly {
    readonly code: string
    readonly field: string
    readonly reason: string
    readonly blocking: boolean
    readonly requiresHumanReview: true
  }[]
  readonly rule: {
    readonly ruleSetId: string
    readonly ruleVersion: string
    readonly effectiveFrom: string
    readonly sources: readonly {
      readonly code: string
      readonly title: string
      readonly sourceType: 'official_gazette' | 'seddk_circular'
      readonly publishedAt: string
      readonly effectiveFrom: string
      readonly locator: string
      readonly url: string
    }[]
  }
  readonly reportNote: string | null
}

export interface TrafficValueLossReportPreviewRecord {
  readonly content: TrafficValueLossReportContentRecord
  readonly previewHash: string
  readonly previewedAt: string
}

export interface TrafficValueLossReportRecord {
  readonly id: string
  readonly caseId: string
  readonly assessmentId: string
  readonly assessmentVersionId: string
  readonly assessmentVersion: number
  readonly status: 'ready'
  readonly format: 'pdf'
  readonly schemaVersion: TrafficValueLossReportContentRecord['schemaVersion']
  readonly templateVersion: TrafficValueLossReportContentRecord['templateVersion']
  readonly ruleVersion: string
  readonly contentHash: string
  readonly pdfHash: string
  readonly pdfByteSize: number
  readonly content: TrafficValueLossReportContentRecord
  readonly generatedBy: string
  readonly generatedAt: string
  readonly version: number
}

export type TrafficValueLossReportErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unavailable'

export class TrafficValueLossReportError extends Error {
  constructor(readonly kind: TrafficValueLossReportErrorKind, message: string) {
    super(message)
    this.name = 'TrafficValueLossReportError'
  }
}

export interface TrafficValueLossReportDataPort {
  list(caseId: string): Promise<readonly TrafficValueLossReportRecord[]>
  preview(
    caseId: string,
    versionId: string,
    expectedAssessmentVersion: number,
    reportNote: string | null,
  ): Promise<TrafficValueLossReportPreviewRecord>
  generate(
    caseId: string,
    versionId: string,
    expectedAssessmentVersion: number,
    reportNote: string | null,
    previewHash: string,
    idempotencyKey?: string,
  ): Promise<TrafficValueLossReportRecord>
  download(caseId: string, reportId: string): Promise<{ readonly blob: Blob; readonly filename: string }>
}

export interface TrafficValueLossReportAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function parseContent(value: unknown): TrafficValueLossReportContentRecord {
  if (!record(value) || value.schemaVersion !== 'traffic-value-loss-final-report/1.0.0'
    || value.templateVersion !== 'traffic-value-loss-final-report-tr/1.0.0'
    || value.title !== 'Trafik Değer Kaybı Nihai Raporu'
    || !record(value.caseReference) || value.caseReference.caseType !== 'traffic'
    || typeof value.caseReference.caseId !== 'string' || typeof value.caseReference.officeNumber !== 'string'
    || typeof value.caseReference.plate !== 'string' || !record(value.assessment)
    || !['approved', 'superseded'].includes(String(value.assessment.status))
    || value.assessment.humanApprovalStatus !== 'approved'
    || !record(value.vehicle) || !Array.isArray(value.damageParts)
    || !record(value.calculation) || value.calculation.calculationMethod !== 'market_value_difference'
    || value.calculation.roundingRule !== 'half_up_minor_unit'
    || !Array.isArray(value.calculation.reasoning) || !Array.isArray(value.evidence)
    || !Array.isArray(value.comparables) || !Array.isArray(value.uncertainties)
    || !record(value.rule) || typeof value.rule.ruleVersion !== 'string' || !Array.isArray(value.rule.sources)) {
    throw new TrafficValueLossReportError('unavailable', 'traffic value loss report content response is invalid')
  }
  for (const evidence of value.evidence) {
    if (!record(evidence) || typeof evidence.id !== 'string' || typeof evidence.evidenceKey !== 'string'
      || typeof evidence.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sourceHash)
      || !Array.isArray(evidence.supports) || typeof evidence.conflict !== 'boolean') {
      throw new TrafficValueLossReportError('unavailable', 'traffic value loss report evidence response is invalid')
    }
  }
  for (const comparable of value.comparables) {
    if (!record(comparable) || typeof comparable.id !== 'string' || typeof comparable.evidenceKey !== 'string'
      || !safeInteger(comparable.amountMinor) || typeof comparable.observedAt !== 'string') {
      throw new TrafficValueLossReportError('unavailable', 'traffic value loss report comparable response is invalid')
    }
  }
  return value as unknown as TrafficValueLossReportContentRecord
}
function parseReport(value: unknown): TrafficValueLossReportRecord {
  if (!record(value) || typeof value.id !== 'string' || typeof value.caseId !== 'string'
    || typeof value.assessmentVersionId !== 'string' || !safeInteger(value.assessmentVersion)
    || value.status !== 'ready' || value.format !== 'pdf' || typeof value.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.contentHash) || typeof value.pdfHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.pdfHash) || !safeInteger(value.pdfByteSize)
    || typeof value.generatedAt !== 'string' || typeof value.generatedBy !== 'string') {
    throw new TrafficValueLossReportError('unavailable', 'traffic value loss report response is invalid')
  }
  return { ...value, content: parseContent(value.content) } as unknown as TrafficValueLossReportRecord
}
function errorFor(status: number): TrafficValueLossReportError {
  if (status === 401) return new TrafficValueLossReportError('unauthorized', 'traffic value loss report API HTTP 401')
  if (status === 403) return new TrafficValueLossReportError('forbidden', 'traffic value loss report API HTTP 403')
  if (status === 400) return new TrafficValueLossReportError('validation', 'traffic value loss report validation failed')
  if (status === 404) return new TrafficValueLossReportError('not_found', 'traffic value loss report not found')
  if (status === 409) return new TrafficValueLossReportError('conflict', 'traffic value loss report state changed')
  return new TrafficValueLossReportError('unavailable', `traffic value loss report API HTTP ${status}`)
}
function key(): string {
  if (globalThis.crypto?.randomUUID !== undefined) return globalThis.crypto.randomUUID()
  throw new TrafficValueLossReportError('unavailable', 'secure idempotency key generation unavailable')
}

export function createHttpTrafficValueLossReportAdapter(
  options: TrafficValueLossReportAdapterOptions = {},
): TrafficValueLossReportDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }
  const makeKey = options.idempotencyKeyFactory ?? key
  async function request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
      })
    } catch {
      throw new TrafficValueLossReportError('unavailable', 'traffic value loss report API unreachable')
    }
  }
  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init)
    if (!response.ok) throw errorFor(response.status)
    try { return await response.json() } catch {
      throw new TrafficValueLossReportError('unavailable', 'traffic value loss report JSON response is invalid')
    }
  }
  return {
    async list(caseId) {
      const body = await json(`/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/reports`)
      const reports = record(body) ? body.reports : undefined
      if (!Array.isArray(reports)) throw new TrafficValueLossReportError('unavailable', 'traffic value loss reports response is invalid')
      return reports.map(parseReport)
    },
    async preview(caseId, versionId, expectedAssessmentVersion, reportNote) {
      const body = await json(
        `/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions/${encodeURIComponent(versionId)}/report-preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedAssessmentVersion, reportNote }),
        },
      )
      if (!record(body) || typeof body.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.previewHash)
        || typeof body.previewedAt !== 'string') {
        throw new TrafficValueLossReportError('unavailable', 'traffic value loss report preview response is invalid')
      }
      return { content: parseContent(body.content), previewHash: body.previewHash, previewedAt: body.previewedAt }
    },
    async generate(caseId, versionId, expectedAssessmentVersion, reportNote, previewHash, idempotencyKey) {
      const body = await json(
        `/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/versions/${encodeURIComponent(versionId)}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey ?? makeKey() },
          body: JSON.stringify({ expectedAssessmentVersion, reportNote, previewHash, confirmed: true }),
        },
      )
      const report = record(body) ? body.report : undefined
      return parseReport(report)
    },
    async download(caseId, reportId) {
      const response = await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/reports/${encodeURIComponent(reportId)}/pdf`,
        { headers: { accept: 'application/pdf' } },
      )
      if (!response.ok) throw errorFor(response.status)
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf')) {
        throw new TrafficValueLossReportError('unavailable', 'traffic value loss report PDF response is invalid')
      }
      const disposition = response.headers.get('content-disposition') ?? ''
      const filename = /filename="([A-Za-z0-9._-]+)"/.exec(disposition)?.[1] ?? 'trafik-deger-kaybi.pdf'
      return { blob: await response.blob(), filename }
    },
  }
}
