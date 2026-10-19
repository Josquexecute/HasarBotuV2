import { caseLocationResponseSchema, fileOperationResponseSchema, type CaseLocation, type FileOperation } from '@hasarbotu/contracts'

export interface WorkspaceMoveState {
  readonly location: CaseLocation | null
  readonly operation: FileOperation | null
}

export class WorkspaceMoveError extends Error {
  constructor(readonly status: number) { super(`Workspace move HTTP ${status}`) }
}

export interface WorkspaceMovePort {
  read(caseId: string): Promise<WorkspaceMoveState>
  plan(caseId: string, locationVersion: number): Promise<FileOperation>
  approve(caseId: string, operationId: string): Promise<FileOperation>
  cancel(caseId: string, operationId: string): Promise<FileOperation>
}

export function createWorkspaceMovePort(fetchImpl: typeof fetch = fetch): WorkspaceMovePort {
  async function request(caseId: string, suffix: string, body?: unknown, allowMissing = false) {
    const response = await fetchImpl(`/api/v1/cases/${encodeURIComponent(caseId)}/${suffix}`, {
      credentials: 'include', cache: 'no-store',
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) throw new WorkspaceMoveError(response.status)
    return response.json() as Promise<unknown>
  }
  return {
    async read(caseId) {
      // Read the location after the operation: a ready result must never accompany a pre-move location.
      const operation = await request(caseId, 'file-operations')
      const location = await request(caseId, 'location', undefined, true)
      return {
        location: location === null ? null : caseLocationResponseSchema.parse(location).location,
        operation: (operation as { operation: unknown }).operation === null ? null : fileOperationResponseSchema.parse(operation).operation,
      }
    },
    async plan(caseId, expectedLocationVersion) {
      return fileOperationResponseSchema.parse(await request(caseId, 'workspace-month-plan', { expectedLocationVersion })).operation
    },
    async approve(caseId, operationId) {
      return fileOperationResponseSchema.parse(await request(caseId, `file-operations/${encodeURIComponent(operationId)}/approve`, { approved: true })).operation
    },
    async cancel(caseId, operationId) {
      return fileOperationResponseSchema.parse(await request(caseId, `file-operations/${encodeURIComponent(operationId)}/cancel`, { cancelled: true })).operation
    },
  }
}
