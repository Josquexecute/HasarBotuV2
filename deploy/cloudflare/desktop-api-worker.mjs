import { isGoogleResultRedirect } from '../../scripts/field-portal-routes.mjs'

const bodyLimit = 16 * 1024 * 1024
const requestHeaders = ['accept', 'user-agent', 'content-type', 'cookie', 'idempotency-key', 'x-hasarbotu-dashboard-stages', 'x-hasarbotu-notice-sheet-fields', 'range', 'if-match', 'if-none-match']
const responseHeaders = ['content-type', 'content-length', 'content-disposition', 'content-encoding', 'content-range', 'accept-ranges', 'retry-after', 'vary', 'etag', 'last-modified', 'referrer-policy', 'content-security-policy', 'x-request-id']
const securityHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
}
const reject = (status, code) => new Response(JSON.stringify({ code }), { status, headers: { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' } })

function allowedWriteOrigin(value, publicOrigin) {
  if (value === publicOrigin) return true
  try {
    const url = new URL(value)
    return url.origin === value && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch { return false }
}

async function readBody(request) {
  if (!request.body) return undefined
  const reader = request.body.getReader(), chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > bodyLimit) { await reader.cancel(); return null }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** The binding fixes both the server and port. No public fetch or legacy VPN fallback. */
export function createDesktopEdge(service, publicOrigin) {
  const origin = new URL(publicOrigin)
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:') throw Error('INVALID_PUBLIC_ORIGIN')
  return async request => {
    const url = new URL(request.url), method = request.method
    if (url.origin !== publicOrigin) return reject(421, 'unexpected_host')
    let decodedPath
    try { decodedPath = decodeURIComponent(url.pathname) } catch { return reject(404, 'not_found') }
    if (url.pathname !== '/health' && !/^\/api\/v1(?:\/|$)/.test(url.pathname)
      || /%2f|%5c|%00/i.test(url.pathname) || /^\/api\/v1\/(agent|field-agent)(?:\/|$)/.test(decodedPath)) return reject(404, 'not_found')
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || url.pathname === '/health' && !['GET', 'HEAD'].includes(method)) return reject(405, 'method_not_allowed')
    if (!['GET', 'HEAD'].includes(method)) {
      const incomingOrigin = request.headers.get('origin')
      if (incomingOrigin !== null ? !allowedWriteOrigin(incomingOrigin, publicOrigin)
        : ![null, 'none'].includes(request.headers.get('sec-fetch-site'))) return reject(403, 'origin_required')
    }
    const length = request.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > bodyLimit)) return reject(413, 'payload_too_large')
    let body
    try { body = await readBody(request) } catch { return reject(400, 'invalid_body') }
    if (body === null) return reject(413, 'payload_too_large')
    const headers = new Headers({ 'accept-encoding': 'identity' })
    for (const name of requestHeaders) {
      const value = request.headers.get(name)
      if (value !== null && !(name === 'cookie' && url.pathname === '/health')) headers.set(name, value)
    }
    // Cloudflare supplies this field; arbitrary forwarded identity/agent headers are never trusted.
    const clientIp = request.cf && request.headers.get('cf-connecting-ip')
    if (clientIp) headers.set('x-forwarded-for', clientIp)
    try {
      const incoming = await service.fetch(new Request('http://hasarbotu-api.internal' + url.pathname + url.search, {
        method, headers, ...(body !== undefined ? { body } : {}), redirect: 'manual', signal: request.signal,
      }))
      const redirect = incoming.status >= 300 && incoming.status < 400
      const callbackPath = url.pathname === '/api/v1/google/desktop/callback' ? '/api/v1/google/callback' : url.pathname
      if (redirect && !isGoogleResultRedirect(method, callbackPath, incoming.status, incoming.headers.get('location'))) {
        await incoming.body?.cancel()
        return reject(502, 'unexpected_redirect')
      }
      const outgoing = new Headers(securityHeaders)
      for (const name of responseHeaders) {
        const value = incoming.headers.get(name)
        if (value !== null) outgoing.set(name, value)
      }
      if (redirect) outgoing.set('location', incoming.headers.get('location'))
      for (const cookie of incoming.headers.getSetCookie()) outgoing.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/giu, ''))
      return new Response(method === 'HEAD' ? null : incoming.body, { status: incoming.status, headers: outgoing, encodeBody: 'manual' })
    } catch { return reject(502, 'office_unavailable') }
  }
}

export default {
  fetch(request, env) {
    if (!env?.OFFICE_API?.fetch || !env.PUBLIC_ORIGIN) return reject(503, 'office_not_configured')
    return createDesktopEdge(env.OFFICE_API, env.PUBLIC_ORIGIN)(request)
  },
}
