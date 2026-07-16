export type ClosureFeeStatusRecord = 'control_required' | 'approved' | 'corrected'

export interface ClosureFeeVersionRecord {
  readonly id: string
  readonly feeVersion: number
  readonly status: ClosureFeeStatusRecord
  readonly candidateAmountMinor: number
  readonly approvedAmountMinor: number | null
  readonly currency: 'TRY'
  readonly sourceDocumentVersionId: string
  readonly sourcePage: number
  readonly sourceType: 'manual'
  readonly ruleVersion: 'closure-fee/1.0.0'
  readonly correctionReason: string | null
  readonly createdByUserId: string
  readonly approvedByUserId: string | null
  readonly approvedAt: string | null
  readonly createdAt: string
}

export interface ClosureFeePermissionsRecord {
  readonly canCreateCandidate: boolean
  readonly canApprove: boolean
  readonly canCorrect: boolean
}

export interface ClosureFeeRecord {
  readonly id: string
  readonly caseId: string
  readonly version: number
  readonly currentVersion: ClosureFeeVersionRecord
  readonly history: readonly ClosureFeeVersionRecord[]
  readonly permissions: ClosureFeePermissionsRecord
}

export interface CaseClosureFeeWorkspaceRecord {
  readonly fee: ClosureFeeRecord | null
  readonly permissions: ClosureFeePermissionsRecord
}

export interface ClosureFeeListItemRecord {
  readonly caseId: string
  readonly officeCaseNumber: string
  readonly plate: string
  readonly caseType: 'traffic' | 'casco'
  readonly insurerName: string | null
  readonly serviceName: string | null
  readonly responsibleUserName: string | null
  readonly closedAt: string
  readonly fee: ClosureFeeRecord
}

export interface CaseSummaryReportRecord {
  readonly period: string
  readonly periodStart: string
  readonly periodEndExclusive: string
  readonly generatedAt: string
  readonly periodBasis: 'open_created_closed_finalized'
  readonly summary: {
    readonly totalCaseCount: number
    readonly openCaseCount: number
    readonly closedCaseCount: number
    readonly trafficCaseCount: number
    readonly cascoCaseCount: number
    readonly approvedFeeCount: number
    readonly approvedFeeTotalMinor: number
    readonly controlRequiredFeeCount: number
    readonly closedCaseWithoutFeeCount: number
  }
  readonly distribution: readonly {
    readonly code: 'traffic' | 'casco' | 'closed'
    readonly count: number
  }[]
  readonly responsibleUsers: readonly { readonly id: string; readonly name: string }[]
  readonly services: readonly { readonly id: string; readonly name: string }[]
  readonly pendingFees: readonly ClosureFeeListItemRecord[]
}

export interface ReportsFeesDataPort {
  getCaseFee(caseId: string): Promise<CaseClosureFeeWorkspaceRecord>
  listFees(): Promise<readonly ClosureFeeListItemRecord[]>
  getCaseSummaryReport(input: {
    period: string
    responsibleUserId?: string
    serviceId?: string
  }): Promise<CaseSummaryReportRecord>
  createCandidate(
    caseId: string,
    input: {
      expectedCaseVersion: number
      candidateAmountMinor: number
      sourceDocumentVersionId: string
      sourcePage: number
    },
    idempotencyKey: string,
  ): Promise<ClosureFeeRecord>
  approve(
    feeId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ClosureFeeRecord>
  correct(
    feeId: string,
    input: {
      expectedVersion: number
      approvedAmountMinor: number
      sourceDocumentVersionId: string
      sourcePage: number
      reason: string
    },
    idempotencyKey: string,
  ): Promise<ClosureFeeRecord>
}

export type ReportsFeesErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'unavailable'

export class ReportsFeesError extends Error {
  readonly kind: ReportsFeesErrorKind

  constructor(kind: ReportsFeesErrorKind, message: string) {
    super(message)
    this.name = 'ReportsFeesError'
    this.kind = kind
  }
}

export interface ReportsFeesAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

function errorKind(response: Response): ReportsFeesErrorKind {
  if (response.status === 401) return 'unauthorized'
  if (response.status === 403) return 'forbidden'
  if (response.status === 404) return 'not_found'
  if (response.status === 409) return 'conflict'
  if (response.status === 400 || response.status === 422) return 'validation'
  return 'unavailable'
}

export function createHttpReportsFeesAdapter(
  options: ReportsFeesAdapterOptions = {},
): ReportsFeesDataPort {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? ''

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
        ...init,
      })
    } catch {
      throw new ReportsFeesError('unavailable', 'reports and fees API unreachable')
    }
    if (!response.ok) {
      throw new ReportsFeesError(errorKind(response), `reports and fees API HTTP ${response.status}`)
    }
    try {
      return await response.json()
    } catch {
      throw new ReportsFeesError('unavailable', 'reports and fees API response invalid')
    }
  }

  async function parseCaseFee(value: unknown): Promise<CaseClosureFeeWorkspaceRecord> {
    const { caseClosureFeeResponseSchema } = await import('@hasarbotu/contracts')
    return caseClosureFeeResponseSchema.parse(value) as CaseClosureFeeWorkspaceRecord
  }

  async function parseFee(value: unknown): Promise<ClosureFeeRecord> {
    const { closureFeeResponseSchema } = await import('@hasarbotu/contracts')
    return closureFeeResponseSchema.parse(value).fee as ClosureFeeRecord
  }

  return {
    async getCaseFee(caseId) {
      try {
        return await parseCaseFee(await request(`/api/v1/cases/${encodeURIComponent(caseId)}/fee`))
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'case fee response invalid')
      }
    },
    async listFees() {
      try {
        const { closureFeeListResponseSchema } = await import('@hasarbotu/contracts')
        return closureFeeListResponseSchema.parse(await request('/api/v1/fees')).items as ClosureFeeListItemRecord[]
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'fee list response invalid')
      }
    },
    async getCaseSummaryReport(input) {
      const query = new URLSearchParams({ period: input.period })
      if (input.responsibleUserId !== undefined) query.set('responsibleUserId', input.responsibleUserId)
      if (input.serviceId !== undefined) query.set('serviceId', input.serviceId)
      try {
        const { caseSummaryReportResponseSchema } = await import('@hasarbotu/contracts')
        return caseSummaryReportResponseSchema.parse(
          await request(`/api/v1/reports/case-summary?${query.toString()}`),
        ) as CaseSummaryReportRecord
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'case summary report response invalid')
      }
    },
    async createCandidate(caseId, input, idempotencyKey) {
      try {
        return await parseFee(await request(
          `/api/v1/cases/${encodeURIComponent(caseId)}/fee/candidates`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(input),
          },
        ))
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'closure fee response invalid')
      }
    },
    async approve(feeId, expectedVersion, idempotencyKey) {
      try {
        return await parseFee(await request(`/api/v1/fees/${encodeURIComponent(feeId)}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ expectedVersion, confirmed: true }),
        }))
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'closure fee response invalid')
      }
    },
    async correct(feeId, input, idempotencyKey) {
      try {
        return await parseFee(await request(`/api/v1/fees/${encodeURIComponent(feeId)}/correct`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ ...input, confirmed: true }),
        }))
      } catch (error) {
        if (error instanceof ReportsFeesError) throw error
        throw new ReportsFeesError('unavailable', 'closure fee response invalid')
      }
    },
  }
}
