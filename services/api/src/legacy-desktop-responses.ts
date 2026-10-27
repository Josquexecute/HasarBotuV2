import type { FastifyInstance } from 'fastify'

/** Packaged Electron supplies the product/version token; this is wire negotiation,
 * never authentication. Browsers and clients without a known version keep v1 data.
 */
export function isLegacyDesktop(userAgent: string | undefined, maxPatch = 72): boolean {
  if (!userAgent || !/\bElectron\/\d+\./.test(userAgent)) return false
  const version = /(?:^|\s)(?:HasarBotu|@hasarbotu\/desktop)\/(\d+)\.(\d+)\.(\d+)(?=\s|$)/.exec(userAgent)
  if (!version) return false
  const [major, minor, patch] = version.slice(1).map(Number)
  return major === 0 && (minor === 0 || minor === 1 && patch! <= maxPatch)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function omit(value: unknown, field: string): unknown {
  if (!object(value) || !Object.hasOwn(value, field)) return value
  const copy = { ...value }
  delete copy[field]
  return copy
}
function legacyLifecycle(value: unknown): unknown {
  return object(value) ? { ...value, linkedFileOperation: omit(value.linkedFileOperation, 'fileLock') } : value
}

/** Only new fields at their DTO paths are removed; arbitrary audit/user data stays intact. */
export function legacyDesktopResponse(route: string, payload: unknown): unknown {
  if (!object(payload)) return payload
  if (route === '/api/v1/me/assistant-appearance') return { ...payload, appearance: omit(payload.appearance, 'customImage') }
  if (!route.startsWith('/api/v1/cases') && !route.startsWith('/api/v1/eksist')) return payload
  let result = payload
  if (object(payload.case)) result = { ...result, case: omit(payload.case, 'transmission') }
  if (route === '/api/v1/cases' && Array.isArray(payload.items)) result = { ...result, items: payload.items.map(item => omit(item, 'transmission')) }
  if (route.endsWith('/vehicle-profile')) {
    result = { ...result, current: omit(payload.current, 'transmission'), history: Array.isArray(payload.history) ? payload.history.map(item => omit(item, 'transmission')) : payload.history }
    result = omit(result, 'transmission') as Record<string, unknown>
  }
  if ((route.includes('/file-operations') || route.endsWith('/workspace-month-plan')) && object(payload.operation)) result = { ...result, operation: omit(payload.operation, 'fileLock') }
  if (route.includes('/lifecycle')) {
    if (object(payload.operation)) result = { ...result, operation: legacyLifecycle(payload.operation) }
    if (Array.isArray(payload.items)) result = { ...result, items: payload.items.map(legacyLifecycle) }
  }
  return result
}

export function registerLegacyDesktopResponses(app: FastifyInstance): void {
  app.addHook('preSerialization', async (request, reply, payload) => {
    const route = request.routeOptions.url ?? ''
    if (reply.statusCode >= 400 || !(route.startsWith('/api/v1/cases') || route.startsWith('/api/v1/eksist') || route === '/api/v1/me/assistant-appearance')) return payload
    if (route === '/api/v1/me/assistant-appearance' && object(payload) && object(payload.appearance) && Object.hasOwn(payload.appearance, 'eyeColor')) {
      const vary = String(reply.getHeader('vary') ?? '').split(',').map(value => value.trim()).filter(Boolean)
      if (!vary.some(value => value.toLowerCase() === 'user-agent')) reply.header('Vary', [...vary, 'User-Agent'].join(', '))
      if (isLegacyDesktop(request.headers['user-agent'], 76)) payload = { ...payload, appearance: omit(payload.appearance, 'eyeColor') }
    }
    const legacy = legacyDesktopResponse(route, payload)
    if (legacy === payload) return payload
    const existing = reply.getHeader('vary')
    const vary = existing === undefined ? [] : String(existing).split(',').map(value => value.trim())
    if (!vary.some(value => value.toLowerCase() === 'user-agent')) reply.header('Vary', [...vary, 'User-Agent'].join(', '))
    return isLegacyDesktop(request.headers['user-agent']) ? legacy : payload
  })
}
