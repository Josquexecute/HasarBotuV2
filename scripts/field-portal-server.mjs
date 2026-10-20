import http from 'node:http'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedFieldApi } from './field-portal-routes.mjs'

export { allowedFieldApi }
export function createFieldPortal({ directory, upstream, publicOrigin, allowTailnetApi = false }) {
  const target = new URL(upstream), origin = new URL(publicOrigin)
  if (target.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.username || target.password || target.pathname !== '/') throw Error('Expected a loopback API origin')
  if (origin.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw Error('Public field portal requires HTTPS')
  const root = resolve(directory)
  const server = http.createServer(async (request, response) => {
    const reject = (status, message) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ code: message })) }
    response.setHeader('cache-control', 'private, no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'same-origin')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=()')
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    if (origin.protocol === 'https:') response.setHeader('strict-transport-security', 'max-age=31536000')
    try {
      if (request.headers.host !== origin.host) { reject(421, 'unexpected_host'); return }
      const url = new URL(request.url ?? '/', publicOrigin), method = request.method ?? 'GET'
      // Only enable behind loopback Tailscale Serve, which strips spoofed identity headers.
      // Public Funnel requests have no identity header; private API authorization still runs upstream.
      const trustedTailnet = allowTailnetApi && typeof request.headers['tailscale-user-login'] === 'string' && request.headers['tailscale-user-login'].length > 0
      if (url.pathname === '/field-health' && method === 'GET') { response.setHeader('content-type','application/json'); response.end('{"status":"ok"}'); return }
      if (url.pathname.startsWith('/api/') || trustedTailnet && url.pathname === '/health') {
        if (!trustedTailnet && !allowedFieldApi(method, url.pathname)) { reject(404, 'not_found'); return }
        if (!trustedTailnet && !['GET','HEAD'].includes(method) && request.headers.origin !== origin.origin) { reject(403, 'origin_required'); return }
        const limit = trustedTailnet ? 16 * 1024 * 1024 : url.pathname.endsWith('/chunk') ? 262144 : 65536
        if (Number(request.headers['content-length'] ?? 0) > limit) { reject(413,'payload_too_large'); return }
        const headers = {}
        for (const name of ['accept','content-type','content-length','cookie','idempotency-key','x-hasarbotu-dashboard-stages','x-hasarbotu-notice-sheet-fields']) if (request.headers[name]) headers[name] = request.headers[name]
        const proxy = http.request({ hostname: target.hostname, port: target.port, method, path: url.pathname + url.search, headers, timeout: 90_000 }, incoming => {
          if ((incoming.statusCode ?? 500) >= 300 && (incoming.statusCode ?? 500) < 400) { incoming.resume(); reject(502,'unexpected_redirect'); return }
          response.statusCode = incoming.statusCode ?? 502
          for (const name of ['content-type','content-length','content-disposition','retry-after','referrer-policy','content-security-policy','vary']) if (incoming.headers[name]) response.setHeader(name, incoming.headers[name])
          const cookies = incoming.headers['set-cookie']
          if (cookies) response.setHeader('set-cookie', cookies.map(cookie => !trustedTailnet && origin.protocol === 'https:' && !/;\s*Secure(?:;|$)/iu.test(cookie) ? `${cookie}; Secure` : cookie))
          incoming.on('error', () => response.destroy())
          incoming.pipe(response)
        })
        let bytes = 0
        request.on('data', chunk => { bytes += chunk.length; if (bytes > limit) { request.unpipe(proxy); proxy.destroy(); if (!response.headersSent) reject(413, 'payload_too_large') } })
        request.on('aborted', () => proxy.destroy())
        response.on('close', () => proxy.destroy())
        proxy.on('timeout', () => proxy.destroy())
        proxy.on('error', () => { if (!response.headersSent) reject(502,'office_unavailable'); else response.destroy() })
        request.pipe(proxy)
        return
      }
      if (method !== 'GET' && method !== 'HEAD') { reject(405,'method_not_allowed'); return }
      let path
      if (['/','/saha','/saha/','/field.html'].includes(url.pathname)) path = resolve(root, 'field.html')
      else if (url.pathname.startsWith('/assets/') || url.pathname === '/brand/logo-mark.svg') path = resolve(root, '.' + decodeURIComponent(url.pathname))
      else { reject(404,'not_found'); return }
      const inside = (base, candidate) => { const rel = relative(base, candidate); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) }
      if (!inside(root, path) || !inside(await realpath(root), await realpath(path)) || !(await lstat(path)).isFile()) { reject(404,'not_found'); return }
      const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg' }[extname(path)]
      if (!mime) { reject(404,'not_found'); return }
      response.setHeader('content-type', mime)
      if (url.pathname.startsWith('/assets/')) response.setHeader('cache-control','public, max-age=31536000, immutable')
      if (method === 'HEAD') { response.end(); return }
      const stream = createReadStream(path); stream.on('error', () => response.destroy()); stream.pipe(response)
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof URIError) reject(404,'not_found')
      else { console.error('Field portal request failed'); if (!response.headersSent) reject(500,'portal_unavailable'); else response.destroy() }
    }
  })
  server.requestTimeout = 90_000
  server.headersTimeout = 20_000
  server.on('listening', () => { if (origin.port === '0' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) origin.port = String(server.address().port) })
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.FIELD_ALLOW_TAILNET_API !== undefined && !['true','false'].includes(process.env.FIELD_ALLOW_TAILNET_API)) throw Error('Invalid tailnet proxy setting')
  const server = createFieldPortal({ directory: process.env.FIELD_UI_DIRECTORY ?? 'dist', upstream: process.env.FIELD_API_ORIGIN ?? 'http://127.0.0.1:3100', publicOrigin: process.env.FIELD_PUBLIC_ORIGIN, allowTailnetApi: process.env.FIELD_ALLOW_TAILNET_API === 'true' })
  const port = Number(process.env.FIELD_PORT ?? '3200')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid field portal port')
  server.listen(port, '127.0.0.1', () => console.log('Authenticated field portal ready on loopback'))
  for (const event of ['SIGINT','SIGTERM']) process.once(event, () => { server.close(); server.closeIdleConnections() })
}
