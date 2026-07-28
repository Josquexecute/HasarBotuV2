export type RoleCodeRecord = 'admin' | 'expert' | 'case_manager' | 'secretary' | 'accounting' | 'read_only'

export interface UserSummaryRecord {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly status: 'active' | 'disabled'
  readonly roles: readonly RoleCodeRecord[]
  readonly version: number
}

export interface UsersDataPort {
  list(): Promise<readonly UserSummaryRecord[]>
  updateRoles(
    userId: string,
    input: { roles: readonly RoleCodeRecord[]; expectedVersion: number },
  ): Promise<UserSummaryRecord>
}

export type UsersErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'self_lockout'
  | 'validation'
  | 'unavailable'

export class UsersError extends Error {
  readonly kind: UsersErrorKind

  constructor(kind: UsersErrorKind, message: string) {
    super(message)
    this.name = 'UsersError'
    this.kind = kind
  }
}

export interface UsersAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

function errorKind(response: Response, body: unknown): UsersErrorKind {
  if (response.status === 401) return 'unauthorized'
  if (response.status === 403) return 'forbidden'
  if (response.status === 404) return 'not_found'
  if (response.status === 409) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code
    if (code === 'user_self_lockout_blocked') return 'self_lockout'
    return 'conflict'
  }
  if (response.status === 400 || response.status === 422) return 'validation'
  return 'unavailable'
}

export function createHttpUsersAdapter(options: UsersAdapterOptions = {}): UsersDataPort {
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
      throw new UsersError('unavailable', 'users API unreachable')
    }
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      if (response.ok) throw new UsersError('unavailable', 'users API response invalid')
    }
    if (!response.ok) {
      throw new UsersError(errorKind(response, body), `users API HTTP ${response.status}`)
    }
    return body
  }

  return {
    async list() {
      try {
        const { usersResponseSchema } = await import('@hasarbotu/contracts')
        return usersResponseSchema.parse(await request('/api/v1/users')).items as UserSummaryRecord[]
      } catch (error) {
        if (error instanceof UsersError) throw error
        throw new UsersError('unavailable', 'user list response invalid')
      }
    },
    async updateRoles(userId, input) {
      try {
        const { userResponseSchema } = await import('@hasarbotu/contracts')
        return userResponseSchema.parse(await request(
          `/api/v1/users/${encodeURIComponent(userId)}/roles`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        )).user as UserSummaryRecord
      } catch (error) {
        if (error instanceof UsersError) throw error
        throw new UsersError('unavailable', 'user roles response invalid')
      }
    },
  }
}
