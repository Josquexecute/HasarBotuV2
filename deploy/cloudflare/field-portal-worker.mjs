import { allowedFieldApi } from '../../scripts/field-portal-routes.mjs'

const publicOrigins = new Set(['https://hasarbotu.pages.dev', 'https://hasarbotu.profaruk1.workers.dev'])
const upstreamOrigin = 'https://desktop-efn2g33.tail276cda.ts.net'
const securityHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

const reject = (status, code) => new Response(JSON.stringify({ code }), {
  status, headers: { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' },
})

async function readLimitedBody(request, limit) {
  if (!request.body) return undefined
  const reader = request.body.getReader(), chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { await reader.cancel(); return null }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

export function createFieldEdge(fetchUpstream = fetch) {
  return async function handle(request) {
    const url = new URL(request.url), method = request.method
    // Preview hosts must never issue production session cookies.
    if (!publicOrigins.has(url.origin)) return reject(421, 'unexpected_host')
    const publicOrigin = url.origin
    const api = url.pathname.startsWith('/api/')
    const asset = /^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname)
    const page = ['/', '/saha', '/saha/', '/field.html', '/field-health', '/brand/logo-mark.svg'].includes(url.pathname)
    if (api ? !allowedFieldApi(method, url.pathname) : !(['GET', 'HEAD'].includes(method) && (page || asset))) return reject(404, 'not_found')
    if (!['GET', 'HEAD'].includes(method) && request.headers.get('origin') !== publicOrigin) return reject(403, 'origin_required')
    const limit = url.pathname.endsWith('/chunk') ? 262144 : 65536
    const length = request.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return reject(413, 'payload_too_large')
    try {
      const body = await readLimitedBody(request, limit)
      if (body === null) return reject(413, 'payload_too_large')
      // Never forward identity, agent, authorization or arbitrary proxy headers.
      const headers = new Headers({ 'accept-encoding': 'identity' })
      for (const name of ['accept', 'content-type', 'cookie']) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      if (!['GET', 'HEAD'].includes(method)) headers.set('origin', upstreamOrigin)
      const target = new URL(url.pathname + url.search, upstreamOrigin)
      const incoming = await fetchUpstream(target, { method, headers, body, redirect: 'manual', cache: 'no-store' })
      if (incoming.status >= 300 && incoming.status < 400) {
        await incoming.body?.cancel()
        return reject(502, 'unexpected_redirect')
      }
      const outgoing = new Headers(securityHeaders)
      for (const name of ['content-type', 'content-disposition', 'retry-after', 'content-security-policy', 'content-encoding']) {
        const value = incoming.headers.get(name)
        if (value !== null) outgoing.set(name, value)
      }
      const cookies = typeof incoming.headers.getAll === 'function'
        ? incoming.headers.getAll('set-cookie') : incoming.headers.getSetCookie()
      for (const cookie of cookies) {
        // Keep cookies host-only on the branded address, preserving consent and expiry.
        const hostOnly = cookie.replace(/;\s*Domain=[^;]*/giu, '')
        outgoing.append('set-cookie', /;\s*Secure(?:;|$)/iu.test(hostOnly) ? hostOnly : `${hostOnly}; Secure`)
      }
      return new Response(method === 'HEAD' ? null : incoming.body, {
        status: incoming.status, headers: outgoing, encodeBody: 'manual',
      })
    } catch {
      return reject(502, 'office_unavailable')
    }
  }
}

export default { fetch: createFieldEdge() }
