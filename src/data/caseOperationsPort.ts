export type CaseNoteTypeRecord = 'internal' | 'contact'
export type CaseTaskPriorityRecord = 'low' | 'normal' | 'high'
export type CaseTaskStatusRecord = 'open' | 'completed' | 'cancelled'
export type CaseTaskDueStatusRecord = 'overdue' | 'today' | 'upcoming' | 'scheduled'

export interface CaseNoteRecord {
  readonly id: string
  readonly noteType: CaseNoteTypeRecord
  readonly subject: string | null
  readonly body: string
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
}

export interface CaseTaskRecord {
  readonly id: string
  readonly title: string
  readonly priority: CaseTaskPriorityRecord
  readonly status: CaseTaskStatusRecord
  readonly assignedUserId: string | null
  readonly assignedUserDisplayName: string | null
  readonly dueDate: string
  readonly dueStatus: CaseTaskDueStatusRecord
  readonly resolutionNote: string | null
  readonly resolvedByUserId: string | null
  readonly resolvedByDisplayName: string | null
  readonly resolvedAt: string | null
  readonly version: number
  readonly createdByUserId: string
  readonly createdByDisplayName: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CaseFollowUpHistoryRecord {
  readonly id: string
  readonly previousFollowUpDate: string | null
  readonly newFollowUpDate: string | null
  readonly source: 'case_create' | 'case_update'
  readonly caseVersion: number
  readonly actorUserId: string
  readonly actorDisplayName: string
  readonly changedAt: string
}

export interface CaseOperationsRecord {
  readonly caseId: string
  readonly asOfDate: string
  readonly notes: readonly CaseNoteRecord[]
  readonly tasks: readonly CaseTaskRecord[]
  readonly followUpHistory: readonly CaseFollowUpHistoryRecord[]
  readonly permissions: {
    readonly canWrite: boolean
    readonly canCompleteTasks: boolean
  }
}

export interface CaseOperationsPort {
  load(caseId: string): Promise<CaseOperationsRecord>
  createNote(caseId: string, input: {
    noteType: CaseNoteTypeRecord
    subject: string | null
    body: string
  }, idempotencyKey?: string): Promise<CaseNoteRecord>
  createTask(caseId: string, input: {
    title: string
    priority: CaseTaskPriorityRecord
    assignedUserId: string | null
    dueDate: string
  }, idempotencyKey?: string): Promise<CaseTaskRecord>
  completeTask(caseId: string, taskId: string, expectedVersion: number, resultNote: string, idempotencyKey?: string): Promise<CaseTaskRecord>
  cancelTask(caseId: string, taskId: string, expectedVersion: number, reason: string, idempotencyKey?: string): Promise<CaseTaskRecord>
}

export type CaseOperationsErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unavailable'

export class CaseOperationsError extends Error {
  readonly kind: CaseOperationsErrorKind
  constructor(kind: CaseOperationsErrorKind, message: string) {
    super(message)
    this.name = 'CaseOperationsError'
    this.kind = kind
  }
}

interface AdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function idempotencyKey(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (value === undefined) throw new CaseOperationsError('unavailable', 'secure idempotency unavailable')
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return value
}

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value)
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return value as number
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
}

function parseNote(value: unknown): CaseNoteRecord {
  const item = record(value)
  exact(item, ['id', 'noteType', 'subject', 'body', 'createdByUserId', 'createdByDisplayName', 'createdAt'])
  const noteType = stringValue(item.noteType)
  if (noteType !== 'internal' && noteType !== 'contact') throw new CaseOperationsError('unavailable', 'case operations response invalid')
  return {
    id: stringValue(item.id),
    noteType,
    subject: nullableString(item.subject),
    body: stringValue(item.body),
    createdByUserId: stringValue(item.createdByUserId),
    createdByDisplayName: stringValue(item.createdByDisplayName),
    createdAt: stringValue(item.createdAt),
  }
}

function parseTask(value: unknown): CaseTaskRecord {
  const item = record(value)
  exact(item, [
    'id', 'title', 'priority', 'status', 'assignedUserId', 'assignedUserDisplayName',
    'dueDate', 'dueStatus', 'resolutionNote', 'resolvedByUserId', 'resolvedByDisplayName',
    'resolvedAt', 'version', 'createdByUserId', 'createdByDisplayName', 'createdAt', 'updatedAt',
  ])
  const priority = stringValue(item.priority)
  const status = stringValue(item.status)
  const dueStatus = stringValue(item.dueStatus)
  if (!['low', 'normal', 'high'].includes(priority) ||
      !['open', 'completed', 'cancelled'].includes(status) ||
      !['overdue', 'today', 'upcoming', 'scheduled'].includes(dueStatus)) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return {
    id: stringValue(item.id),
    title: stringValue(item.title),
    priority: priority as CaseTaskPriorityRecord,
    status: status as CaseTaskStatusRecord,
    assignedUserId: nullableString(item.assignedUserId),
    assignedUserDisplayName: nullableString(item.assignedUserDisplayName),
    dueDate: stringValue(item.dueDate),
    dueStatus: dueStatus as CaseTaskDueStatusRecord,
    resolutionNote: nullableString(item.resolutionNote),
    resolvedByUserId: nullableString(item.resolvedByUserId),
    resolvedByDisplayName: nullableString(item.resolvedByDisplayName),
    resolvedAt: nullableString(item.resolvedAt),
    version: integer(item.version),
    createdByUserId: stringValue(item.createdByUserId),
    createdByDisplayName: stringValue(item.createdByDisplayName),
    createdAt: stringValue(item.createdAt),
    updatedAt: stringValue(item.updatedAt),
  }
}

function parseFollowUp(value: unknown): CaseFollowUpHistoryRecord {
  const item = record(value)
  exact(item, [
    'id', 'previousFollowUpDate', 'newFollowUpDate', 'source', 'caseVersion',
    'actorUserId', 'actorDisplayName', 'changedAt',
  ])
  const source = stringValue(item.source)
  if (source !== 'case_create' && source !== 'case_update') {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return {
    id: stringValue(item.id),
    previousFollowUpDate: nullableString(item.previousFollowUpDate),
    newFollowUpDate: nullableString(item.newFollowUpDate),
    source,
    caseVersion: integer(item.caseVersion),
    actorUserId: stringValue(item.actorUserId),
    actorDisplayName: stringValue(item.actorDisplayName),
    changedAt: stringValue(item.changedAt),
  }
}

function parseWorkspace(value: unknown): CaseOperationsRecord {
  const item = record(value)
  exact(item, ['caseId', 'asOfDate', 'notes', 'tasks', 'followUpHistory', 'permissions'])
  if (!Array.isArray(item.notes) || !Array.isArray(item.tasks) || !Array.isArray(item.followUpHistory)) {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  const permissions = record(item.permissions)
  exact(permissions, ['canWrite', 'canCompleteTasks'])
  if (typeof permissions.canWrite !== 'boolean' || typeof permissions.canCompleteTasks !== 'boolean') {
    throw new CaseOperationsError('unavailable', 'case operations response invalid')
  }
  return {
    caseId: stringValue(item.caseId),
    asOfDate: stringValue(item.asOfDate),
    notes: item.notes.map(parseNote),
    tasks: item.tasks.map(parseTask),
    followUpHistory: item.followUpHistory.map(parseFollowUp),
    permissions: {
      canWrite: permissions.canWrite,
      canCompleteTasks: permissions.canCompleteTasks,
    },
  }
}

function mapError(status: number): CaseOperationsError {
  if (status === 401) return new CaseOperationsError('unauthorized', 'session required')
  if (status === 403) return new CaseOperationsError('forbidden', 'permission required')
  if (status === 404) return new CaseOperationsError('not_found', 'case operation resource not found')
  if (status === 400) return new CaseOperationsError('validation', 'case operation validation failed')
  if (status === 409) return new CaseOperationsError('conflict', 'case operation conflict')
  return new CaseOperationsError('unavailable', `case operations HTTP ${status}`)
}

export function createHttpCaseOperationsAdapter(options: AdapterOptions = {}): CaseOperationsPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}
  const makeKey = options.idempotencyKeyFactory ?? idempotencyKey

  const request = async (
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
    key?: string,
  ): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${url}`, {
        method,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(key === undefined ? {} : { 'idempotency-key': key }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new CaseOperationsError('unavailable', 'case operations endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new CaseOperationsError('unavailable', 'case operations response invalid')
    }
  }

  return {
    async load(caseId) {
      return parseWorkspace(await request(`/api/v1/cases/${encodeURIComponent(caseId)}/operations`, 'GET'))
    },
    async createNote(caseId, input, key) {
      const result = record(await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/notes`,
        'POST',
        input,
        key ?? makeKey(),
      ))
      exact(result, ['note'])
      return parseNote(result.note)
    },
    async createTask(caseId, input, key) {
      const result = record(await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/tasks`,
        'POST',
        input,
        key ?? makeKey(),
      ))
      exact(result, ['task'])
      return parseTask(result.task)
    },
    async completeTask(caseId, taskId, expectedVersion, resultNote, key) {
      const result = record(await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/tasks/${encodeURIComponent(taskId)}/complete`,
        'POST',
        { expectedVersion, resultNote },
        key ?? makeKey(),
      ))
      exact(result, ['task'])
      return parseTask(result.task)
    },
    async cancelTask(caseId, taskId, expectedVersion, reason, key) {
      const result = record(await request(
        `/api/v1/cases/${encodeURIComponent(caseId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
        'POST',
        { expectedVersion, reason },
        key ?? makeKey(),
      ))
      exact(result, ['task'])
      return parseTask(result.task)
    },
  }
}
