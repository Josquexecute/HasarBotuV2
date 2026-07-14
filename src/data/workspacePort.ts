export type WorkspaceProvisioningStatus =
  | 'planned' | 'approved' | 'queued' | 'applying' | 'verifying'
  | 'ready' | 'failed' | 'cancelled' | 'stale'

export interface WorkspaceRootRecord {
  readonly rootKey: string
  readonly label: string
}

export interface WorkspaceProvisioningRecord {
  readonly id: string
  readonly caseId: string
  readonly storageRootKey: string
  readonly relativePath: string
  readonly status: WorkspaceProvisioningStatus
  readonly requiredSubdirectories: readonly string[]
  readonly lastErrorCode: string | null
  readonly canApprove: boolean
  readonly canRetry: boolean
  readonly approvedAt: string | null
  readonly readyAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type WorkspaceCommandErrorKind = 'unauthorized' | 'validation' | 'not_found' | 'conflict' | 'unavailable'

export class WorkspaceCommandError extends Error {
  readonly kind: WorkspaceCommandErrorKind
  constructor(kind: WorkspaceCommandErrorKind, message: string) {
    super(message)
    this.name = 'WorkspaceCommandError'
    this.kind = kind
  }
}

export interface WorkspaceCommandPort {
  listActiveRoots(): Promise<readonly WorkspaceRootRecord[]>
  readCurrentPlan(caseId: string): Promise<WorkspaceProvisioningRecord | null>
  createPlan(caseId: string, storageRootKey: string, idempotencyKey?: string): Promise<WorkspaceProvisioningRecord>
  readPlan(caseId: string, planId: string): Promise<WorkspaceProvisioningRecord>
  approvePlan(caseId: string, planId: string, idempotencyKey?: string): Promise<WorkspaceProvisioningRecord>
}

export interface WorkspaceCommandAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly idempotencyKeyFactory?: () => string
}

function secureKey(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef?.randomUUID !== undefined) return cryptoRef.randomUUID()
  throw new WorkspaceCommandError('unavailable', 'secure idempotency key generation unavailable')
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) return false
  if (/^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

async function jsonOf(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function errorFor(status: number): WorkspaceCommandError {
  if (status === 401) return new WorkspaceCommandError('unauthorized', 'session required')
  if (status === 404) return new WorkspaceCommandError('not_found', 'workspace plan not found')
  if (status === 400) return new WorkspaceCommandError('validation', 'workspace request validation failed')
  if (status === 409) return new WorkspaceCommandError('conflict', 'workspace request conflict')
  return new WorkspaceCommandError('unavailable', `workspace endpoint HTTP ${status}`)
}

function readProvisioning(body: unknown): WorkspaceProvisioningRecord {
  const value = (body as { provisioning?: WorkspaceProvisioningRecord } | null)?.provisioning
  if (value === undefined || !safeRelativePath(value.relativePath) || !Array.isArray(value.requiredSubdirectories)) {
    throw new WorkspaceCommandError('unavailable', 'unsafe workspace response')
  }
  if (value.requiredSubdirectories.some((segment) => !safeRelativePath(segment))) {
    throw new WorkspaceCommandError('unavailable', 'unsafe workspace response')
  }
  return value
}

export function createHttpWorkspaceCommandAdapter(options: WorkspaceCommandAdapterOptions = {}): WorkspaceCommandPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}
  const makeKey = options.idempotencyKeyFactory ?? secureKey

  async function request(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${url}`, { credentials: 'include', ...init })
    } catch {
      throw new WorkspaceCommandError('unavailable', 'workspace endpoint unreachable')
    }
  }

  return {
    async listActiveRoots() {
      const response = await request('/api/v1/storage-roots', { headers: { accept: 'application/json', ...headers } })
      if (!response.ok) throw errorFor(response.status)
      const body = (await jsonOf(response)) as { items?: { rootKey?: unknown; label?: unknown; isActive?: unknown }[] } | null
      if (!Array.isArray(body?.items)) throw new WorkspaceCommandError('unavailable', 'invalid roots response')
      return body.items.flatMap((item) =>
        item.isActive === true && typeof item.rootKey === 'string' && typeof item.label === 'string'
          ? [{ rootKey: item.rootKey, label: item.label }]
          : [],
      )
    },

    async readCurrentPlan(caseId) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/workspace-plans`, {
        headers: { accept: 'application/json', ...headers },
      })
      if (response.status === 404) return null
      const body = await jsonOf(response)
      if (!response.ok) throw errorFor(response.status)
      return readProvisioning(body)
    },

    async createPlan(caseId, storageRootKey, idempotencyKey) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/workspace-plans`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? makeKey(), ...headers },
        body: JSON.stringify({ storageRootKey }),
      })
      const body = await jsonOf(response)
      if (response.status !== 201) throw errorFor(response.status)
      return readProvisioning(body)
    },

    async readPlan(caseId, planId) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/workspace-plans/${encodeURIComponent(planId)}`, {
        headers: { accept: 'application/json', ...headers },
      })
      const body = await jsonOf(response)
      if (!response.ok) throw errorFor(response.status)
      return readProvisioning(body)
    },

    async approvePlan(caseId, planId, idempotencyKey) {
      const response = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/workspace-plans/${encodeURIComponent(planId)}/approve`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? makeKey(), ...headers },
        body: JSON.stringify({ approved: true }),
      })
      const body = await jsonOf(response)
      if (response.status !== 202) throw errorFor(response.status)
      return readProvisioning(body)
    },
  }
}
