import type { CaseRecord, CaseStageCode } from '../types/case'
import { mapCaseDtoToRecord } from './httpAdapter'

export type LifecycleOperationStatus =
  | 'planned' | 'blocked' | 'approval_required' | 'approved' | 'queued' | 'moving' | 'verifying'
  | 'finalizing' | 'closed' | 'reopened' | 'failed' | 'stale' | 'cancelled'
  | 'cleanup_pending' | 'manual_recovery_required'

export interface LifecycleRequirementRecord {
  readonly requirementCode: string
  readonly sourceType: 'document' | 'photo'
  readonly canonicalType: string
  readonly status: 'present' | 'missing' | 'control_required' | 'not_applicable'
  readonly reason: string
  readonly requiresHumanReview: boolean
}

export interface LifecycleOperationRecord {
  readonly id: string
  readonly caseId: string
  readonly operationType: 'close' | 'reopen'
  readonly status: LifecycleOperationStatus
  readonly version: number
  readonly source: { readonly storageRootKey: string; readonly relativePath: string }
  readonly destination: { readonly storageRootKey: string; readonly relativePath: string }
  readonly closeMode: 'normal' | 'with_missing_requirements' | null
  readonly reason: string | null
  readonly targetWorkflowStage: string
  readonly requirementSummary: {
    readonly documentRuleVersion: string
    readonly closureRuleVersion: string
    readonly serviceEligibility: {
      readonly status: 'eligible' | 'not_eligible' | 'control_required'
      readonly agreementStatus: 'agreed' | 'not_agreed' | 'control_required'
      readonly serviceType: 'authorized' | 'private' | 'glass' | 'mobile' | 'other'
      readonly reason: string
      readonly ruleVersion: string
    } | null
    readonly missingCount: number
    readonly controlRequiredCount: number
    readonly requirements: readonly LifecycleRequirementRecord[]
  }
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
  readonly linkedFileOperation: { readonly id: string; readonly status: string } | null
  readonly failureReasonCode: string | null
  readonly canApprove: boolean
  readonly canCancel: boolean
}

export type LifecycleCommandErrorKind =
  | 'unauthorized' | 'forbidden' | 'validation' | 'not_found' | 'conflict'
  | 'manual_recovery_required' | 'unavailable'

export class LifecycleCommandError extends Error {
  readonly kind: LifecycleCommandErrorKind
  constructor(kind: LifecycleCommandErrorKind, message: string) {
    super(message)
    this.name = 'LifecycleCommandError'
    this.kind = kind
  }
}

export interface CaseLifecycleCommandPort {
  readLocationVersion(caseId: string): Promise<number>
  planClose(caseId: string, input: {
    readonly expectedCaseVersion: number
    readonly expectedLocationVersion: number
    readonly closeMode: 'normal' | 'with_missing_requirements'
    readonly reason?: string
  }, idempotencyKey?: string): Promise<LifecycleOperationRecord>
  planReopen(caseId: string, input: {
    readonly expectedCaseVersion: number
    readonly expectedLocationVersion: number
    readonly reason: string
    readonly targetWorkflowStage: Exclude<CaseStageCode, 'closed'>
  }, idempotencyKey?: string): Promise<LifecycleOperationRecord>
  approve(caseId: string, operation: LifecycleOperationRecord, idempotencyKey?: string): Promise<LifecycleOperationRecord>
  readOperation(caseId: string, operationId: string): Promise<LifecycleOperationRecord>
  readCase(caseId: string): Promise<CaseRecord>
}

interface AdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureKey(): string {
  if (globalThis.crypto?.randomUUID !== undefined) return globalThis.crypto.randomUUID()
  throw new LifecycleCommandError('unavailable', 'secure idempotency key generation unavailable')
}

function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\')
    && !/^[A-Za-z]:/.test(value) && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

async function jsonOf(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function errorFor(status: number, body: unknown): LifecycleCommandError {
  const code = (body as { error?: { code?: string } } | null)?.error?.code
  if (status === 401) return new LifecycleCommandError('unauthorized', 'session required')
  if (status === 403) return new LifecycleCommandError('forbidden', 'permission denied')
  if (status === 404) return new LifecycleCommandError('not_found', 'case or operation not found')
  if (status === 400) return new LifecycleCommandError('validation', 'lifecycle request validation failed')
  if (code === 'manual_recovery_required') return new LifecycleCommandError('manual_recovery_required', 'manual recovery required')
  if (status === 409) return new LifecycleCommandError('conflict', 'lifecycle request conflict')
  return new LifecycleCommandError('unavailable', `lifecycle endpoint HTTP ${status}`)
}

function readOperationBody(body: unknown): LifecycleOperationRecord {
  const operation = (body as { operation?: LifecycleOperationRecord } | null)?.operation
  if (operation === undefined || !safeRelativePath(operation.source?.relativePath)
    || !safeRelativePath(operation.destination?.relativePath) || !Array.isArray(operation.blockers)
    || !Array.isArray(operation.requirementSummary?.requirements) || !Number.isInteger(operation.version)) {
    throw new LifecycleCommandError('unavailable', 'unsafe lifecycle response')
  }
  return operation
}

export function createHttpCaseLifecycleCommandAdapter(options: AdapterOptions = {}): CaseLifecycleCommandPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}
  const makeKey = options.idempotencyKeyFactory ?? secureKey
  async function request(path: string, init?: RequestInit): Promise<Response> {
    try { return await fetchImpl(`${baseUrl}${path}`, { credentials: 'include', ...init }) }
    catch { throw new LifecycleCommandError('unavailable', 'lifecycle endpoint unreachable') }
  }
  async function command(path: string, body: unknown, key: string): Promise<LifecycleOperationRecord> {
    const response = await request(path, { method: 'POST', headers: {
      accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': key, ...headers,
    }, body: JSON.stringify(body) })
    const responseBody = await jsonOf(response)
    if (!response.ok) throw errorFor(response.status, responseBody)
    return readOperationBody(responseBody)
  }
  return {
    async readLocationVersion(caseId) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/location`, { headers: { accept: 'application/json', ...headers } })
      const body = await jsonOf(response)
      if (!response.ok) throw errorFor(response.status, body)
      const location = (body as { location?: { version?: unknown; relativePath?: unknown } } | null)?.location
      if (!Number.isInteger(location?.version) || !safeRelativePath(location?.relativePath)) throw new LifecycleCommandError('unavailable', 'unsafe location response')
      return location.version as number
    },
    planClose(caseId, input, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/lifecycle/close/plan`, input, idempotencyKey ?? makeKey())
    },
    planReopen(caseId, input, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/lifecycle/reopen/plan`, input, idempotencyKey ?? makeKey())
    },
    approve(caseId, operation, idempotencyKey) {
      return command(`/api/v1/cases/${encodeURIComponent(caseId)}/lifecycle/${operation.operationType}/${encodeURIComponent(operation.id)}/approve`,
        { approved: true, expectedVersion: operation.version }, idempotencyKey ?? makeKey())
    },
    async readOperation(caseId, operationId) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/lifecycle-operations/${encodeURIComponent(operationId)}`,
        { headers: { accept: 'application/json', ...headers } })
      const body = await jsonOf(response)
      if (!response.ok) throw errorFor(response.status, body)
      return readOperationBody(body)
    },
    async readCase(caseId) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}`, { headers: { accept: 'application/json', ...headers } })
      const body = await jsonOf(response)
      if (!response.ok) throw errorFor(response.status, body)
      const { caseDetailResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseDetailResponseSchema.safeParse(body)
      if (!parsed.success) throw new LifecycleCommandError('unavailable', 'invalid case response')
      return mapCaseDtoToRecord(parsed.data.case)
    },
  }
}
