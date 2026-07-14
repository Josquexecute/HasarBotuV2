import type { CaseReferenceDataPort, CaseReferenceWorkspace } from './ports'

export type ReferenceDataErrorKind = 'unauthorized' | 'unavailable'

export class ReferenceDataError extends Error {
  readonly kind: ReferenceDataErrorKind
  constructor(kind: ReferenceDataErrorKind, message: string) {
    super(message)
    this.name = 'ReferenceDataError'
    this.kind = kind
  }
}

interface ReferenceAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

async function fetchList(fetchImpl: typeof fetch, url: string, headers: Readonly<Record<string, string>>): Promise<unknown[]> {
  let response: Response
  try {
    response = await fetchImpl(url, { credentials: 'include', headers: { accept: 'application/json', ...headers } })
  } catch {
    throw new ReferenceDataError('unavailable', 'reference endpoint unreachable')
  }
  if (response.status === 401) throw new ReferenceDataError('unauthorized', 'session required')
  if (!response.ok) throw new ReferenceDataError('unavailable', `reference endpoint HTTP ${response.status}`)
  const body = await response.json() as { items?: unknown[] }
  if (!Array.isArray(body.items)) throw new ReferenceDataError('unavailable', 'invalid reference response')
  return body.items
}

function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseNamed(items: readonly unknown[]): CaseReferenceWorkspace['insurers'] {
  return items.map((item) => {
    if (!objectWithKeys(item, ['id', 'name']) || !nonEmpty(item.id) || !nonEmpty(item.name)) {
      throw new ReferenceDataError('unavailable', 'invalid named reference response')
    }
    return { id: item.id, name: item.name }
  })
}

function parseUsers(items: readonly unknown[]): CaseReferenceWorkspace['users'] {
  return items.map((item) => {
    if (!objectWithKeys(item, ['id', 'displayName']) || !nonEmpty(item.id) || !nonEmpty(item.displayName)) {
      throw new ReferenceDataError('unavailable', 'invalid user reference response')
    }
    return { id: item.id, displayName: item.displayName }
  })
}

function parseServices(items: readonly unknown[]): CaseReferenceWorkspace['services'] {
  return items.map((item) => {
    if (!objectWithKeys(item, ['id', 'name', 'centerType']) || !nonEmpty(item.id) || !nonEmpty(item.name) ||
      (item.centerType !== 'yetkili' && item.centerType !== 'ozel')) {
      throw new ReferenceDataError('unavailable', 'invalid service reference response')
    }
    return { id: item.id, name: item.name, centerType: item.centerType }
  })
}

export function createHttpReferenceDataAdapter(options: ReferenceAdapterOptions = {}): CaseReferenceDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}
  return {
    async getCaseReferences(): Promise<CaseReferenceWorkspace> {
      const [insurers, services, users, experts] = await Promise.all([
        fetchList(fetchImpl, `${baseUrl}/api/v1/references/insurers`, headers),
        fetchList(fetchImpl, `${baseUrl}/api/v1/references/services`, headers),
        fetchList(fetchImpl, `${baseUrl}/api/v1/references/users`, headers),
        fetchList(fetchImpl, `${baseUrl}/api/v1/references/experts`, headers),
      ])
      return {
        insurers: parseNamed(insurers),
        services: parseServices(services),
        users: parseUsers(users),
        experts: parseUsers(experts),
      }
    },
  }
}
