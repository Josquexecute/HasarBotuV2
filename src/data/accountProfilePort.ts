import type { AccountProfile } from '@hasarbotu/contracts'

export class AccountProfileError extends Error {
  constructor(readonly kind: 'unauthorized' | 'conflict' | 'validation' | 'unavailable') {
    super(kind)
    this.name = 'AccountProfileError'
  }
}
export interface AccountProfilePort {
  load(signal?: AbortSignal): Promise<AccountProfile>
  save(profile: AccountProfile, displayName: string): Promise<AccountProfile>
}
export function createAccountProfilePort(): AccountProfilePort {
  async function request(body?: unknown, signal?: AbortSignal): Promise<AccountProfile> {
    const { ACCOUNT_PROFILE_ROUTE, accountProfileSchema } = await import('@hasarbotu/contracts')
    let response: Response
    try {
      response = await fetch(ACCOUNT_PROFILE_ROUTE, { method: body ? 'PATCH' : 'GET', credentials: 'include', cache: 'no-store',
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) })
    } catch { throw new AccountProfileError('unavailable') }
    if (!response.ok) throw new AccountProfileError(response.status === 401 ? 'unauthorized' : response.status === 409 ? 'conflict' : response.status === 400 ? 'validation' : 'unavailable')
    const result = accountProfileSchema.safeParse(await response.json())
    if (!result.success) throw new AccountProfileError('unavailable')
    return result.data
  }
  return { load: signal => request(undefined, signal), save: (profile, displayName) => request({ expectedUserId: profile.userId, expectedVersion: profile.version, displayName }) }
}
