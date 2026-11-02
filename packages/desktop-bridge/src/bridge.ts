import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { ConnectionOptions } from 'node:tls'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep, extname, isAbsolute } from 'node:path'
import { once } from 'node:events'
import { createNativeOAuthGuard } from './native-oauth.js'
import {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  isAllowedBridgeHost,
  isApiPath,
  resolveAssetPath,
  shouldFallbackToIndex,
} from './policy.js'

/**
 * Masaüstü kabuğunun loopback aynı-origin köprüsü (D1).
 *
 * TEK origin sunar: aynı host:port hem UI build çıktısını hem `/api/*`
 * isteklerini karşılar. `/api/*` sunucu-sunucu API origin'ine iletilir;
 * tarayıcı API origin'ini HİÇ görmez. Bu, bugün Vite dev proxy'sinin
 * (`vite.config.ts`) sağladığı davranışın üretimdeki karşılığıdır.
 *
 * Güvenlik sınırları:
 * - Yalnız 127.0.0.1'e bind edilir; dışarıdan erişilebilir port açılmaz.
 * - `Host` loopback değilse istek reddedilir (DNS rebinding).
 * - Varlık yolları traversal/sürücü/ters bölü/kontrol karakterine karşı
 *   doğrulanır ve çözümden sonra kökün altında olduğu YENİDEN denetlenir.
 * - CORS başlığı ÜRETİLMEZ; `set-cookie` değiştirilmeden aktarılır.
 * - Köprü hiçbir iş mantığı içermez; yalnız taşımadır (ADR-Q06 ince kabuk).
 */

export interface DesktopBridgeOptions {
  /** Yönlendirilecek API kökü, ör. `http://127.0.0.1:3100`. */
  readonly apiOrigin: string
  /** UI build çıktısı (`dist`) dizini. Verilmezse yalnız `/api/*` sunulur. */
  readonly assetRoot?: string
  /** Dinlenecek loopback portu. `0` boş port seçtirir (önerilen). */
  readonly port?: number
  /** Upstream isteği için üst süre sınırı (ms). */
  readonly upstreamTimeoutMs?: number
  readonly connection?: ApiConnection
}

/** Routing is separate from the logical API origin, cookies and Chromium storage. */
export interface ApiEndpoint {
  readonly hostname: string
  readonly port: number
  readonly servername: string
  readonly httpHost?: string
  readonly ca?: ConnectionOptions['ca']
}

export interface ApiConnection {
  resolve(): Promise<ApiEndpoint>
  invalidate(endpoint: ApiEndpoint): void
}

export interface DesktopBridge {
  /** Renderer'ın yükleyeceği TEK origin, ör. `http://127.0.0.1:51234`. */
  readonly origin: string
  readonly port: number
  close(): Promise<void>
}

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000
const UPSTREAM_CONNECT_TIMEOUT_MS = 5000
export const EKSIST_UPSTREAM_TIMEOUT_MS = 120_000
// Legal generation allows 60 seconds; include time for authorization and result persistence.
const AI_UPSTREAM_TIMEOUT_MS = 75_000

export function upstreamTimeoutFor(pathname: string, defaultTimeout: number): number {
  if (/^\/api\/v1\/desktop-updates\/artifacts\/[a-f0-9]{64}$/.test(pathname)) return Math.max(defaultTimeout, 300_000)
  if (pathname === '/api/v1/legislation/questions'
    || /^\/api\/v1\/cases\/[^/]+\/policy-ai-extractions\/[^/]+\/start$/.test(pathname)
    || /^\/api\/v1\/cases\/[^/]+\/email-ai-suggestions$/.test(pathname)) return Math.max(defaultTimeout, AI_UPSTREAM_TIMEOUT_MS)
  return pathname === '/api/v1/eksist/sources' ? Math.max(defaultTimeout, EKSIST_UPSTREAM_TIMEOUT_MS) : defaultTimeout
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** Güvenli, gövdesiz hata yanıtı. Ham hata/dosya yolu istemciye taşınmaz. */
function sendStatus(response: ServerResponse, status: number): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) { response.destroy(); return }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(String(status))
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function resolveContainedFile(assetRoot: string, candidate: string): Promise<string | undefined> {
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(assetRoot), realpath(candidate)])
    if (!isContained(realRoot, realCandidate)) return undefined
    return (await stat(realCandidate)).isFile() ? realCandidate : undefined
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw error
  }
}

async function resolveAssetFile(
  assetRoot: string,
  urlPathname: string,
): Promise<string | undefined> {
  const parsed = resolveAssetPath(urlPathname)
  if (!parsed.ok) return undefined

  const indexFile = join(assetRoot, 'index.html')
  const candidate = parsed.segments.length === 0
    ? indexFile
    : resolve(assetRoot, ...parsed.segments)

  // Leksik doğrulama yeterli sayılmaz; birleştirmeden SONRA kökün altında
  // kaldığı yeniden denetlenir (repo genelindeki root containment kuralı).
  if (!isContained(assetRoot, candidate)) return undefined

  // Junctions and symlinks must also remain within the real asset root.
  // Stream the resolved path so replacing the original link cannot redirect it.
  const found = await resolveContainedFile(assetRoot, candidate)
  if (found !== undefined) return found
  if (shouldFallbackToIndex(parsed.segments)) {
    return resolveContainedFile(assetRoot, indexFile)
  }
  return undefined
}

function forwardToApi(
  apiUrl: URL,
  upstreamHost: string,
  clientRequest: IncomingMessage,
  response: ServerResponse,
  timeoutMs: number,
  connection?: ApiConnection,
  endpoint?: ApiEndpoint,
  oauth?: { remember(bytes: Buffer): void; complete(): void },
): void {
  const startingOAuth = clientRequest.url === '/api/v1/google/start' && clientRequest.method === 'POST'
  const upstream = (apiUrl.protocol === 'https:' ? httpsRequest : httpRequest)(
    {
      protocol: apiUrl.protocol,
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      method: clientRequest.method ?? 'GET',
      path: clientRequest.url ?? '/',
      headers: buildUpstreamHeaders(clientRequest.headers, endpoint?.httpHost ?? upstreamHost),
      ...(endpoint ? { hostname: endpoint.hostname, port: endpoint.port, servername: endpoint.servername, ...(endpoint.ca ? { ca: endpoint.ca } : {}), agent: false } : {}),
    },
    (upstreamResponse) => {
      upstreamResponse.on('error', () => sendStatus(response, 502))
      upstreamResponse.on('aborted', () => sendStatus(response, 502))
      response.once('close', () => upstreamResponse.destroy())
      if (response.destroyed) { upstreamResponse.destroy(); return }
      if (startingOAuth && upstreamResponse.statusCode === 200 && oauth) {
        const chunks: Buffer[] = []
        let size = 0
        upstreamResponse.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 16384) { upstream.destroy(); sendStatus(response, 502); return }
          chunks.push(chunk)
        })
        upstreamResponse.on('end', () => {
          if (response.destroyed || response.writableEnded) return
          const bytes = Buffer.concat(chunks)
          oauth.remember(bytes)
          response.writeHead(200, buildDownstreamHeaders(upstreamResponse.headers))
          response.end(bytes)
        })
        return
      }
      if (upstreamResponse.statusCode === 303) oauth?.complete()
      // `set-cookie` dizi olarak, HİÇ dokunulmadan aktarılır.
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        buildDownstreamHeaders(upstreamResponse.headers),
      )
      upstreamResponse.pipe(response)
    },
  )
  // The bounded start response is inspected before forwarding; never negotiate compressed OAuth JSON.
  if (startingOAuth) upstream.setHeader('accept-encoding', 'identity')

  // request.setTimeout starts after TCP connect; a departed DHCP address also needs a connect/TLS deadline.
  const connectTimer = endpoint ? setTimeout(() => {
    connection?.invalidate(endpoint)
    sendStatus(response, 504)
    upstream.destroy()
  }, UPSTREAM_CONNECT_TIMEOUT_MS) : undefined
  if (connectTimer !== undefined) upstream.once('socket', socket => {
    socket.once(apiUrl.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer))
  })
  upstream.once('close', () => clearTimeout(connectTimer))

  upstream.setTimeout(timeoutMs, () => {
    if (connection && endpoint) connection.invalidate(endpoint)
    upstream.destroy()
    if (!response.headersSent) sendStatus(response, 504)
    else response.destroy()
  })

  upstream.on('error', () => {
    if (connection && endpoint) connection.invalidate(endpoint)
    // API kapalı/erişilemez. Ham hata metni istemciye taşınmaz; UI
    // adapter'ları bunu zaten `unavailable` olarak ele alır.
    if (!response.headersSent) sendStatus(response, 502)
    else response.destroy()
  })

  clientRequest.once('aborted', () => upstream.destroy())
  clientRequest.once('error', () => upstream.destroy())
  response.once('close', () => upstream.destroy())

  clientRequest.pipe(upstream)
}

/**
 * Köprüyü başlatır ve dinlemeye hazır olduğunda döner.
 *
 * `apiOrigin` yalnız origin olarak kullanılır (yol bileşeni yok sayılır).
 * Dönen `origin` renderer'ın yükleyeceği TEK adrestir.
 */
export async function startDesktopBridge(options: DesktopBridgeOptions): Promise<DesktopBridge> {
  const apiUrl = new URL(options.apiOrigin)
  if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') throw new Error('unsupported API protocol')
  const upstreamHost = apiUrl.host
  const timeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const assetRoot = options.assetRoot === undefined ? undefined : resolve(options.assetRoot)

  const server: Server = createServer((clientRequest, response) => {
    clientRequest.on('error', () => sendStatus(response, 400))
    response.on('error', () => response.destroy())
    void (async () => {
      const address = server.address()
      const listeningPort = typeof address === 'object' && address !== null ? address.port : 0
      if (!isAllowedBridgeHost(clientRequest.headers.host, listeningPort)) {
        sendStatus(response, 403)
        clientRequest.resume()
        return
      }

      const requestUrl = new URL(clientRequest.url ?? '/', 'http://127.0.0.1')
      const pathname = requestUrl.pathname
      if (pathname === '/api/v1/google/desktop/callback' && (clientRequest.method !== 'GET' || !nativeOAuth.accepts(requestUrl))) {
        clientRequest.resume()
        response.writeHead(303, { location: '/api/v1/google/result/desktop/login/expired', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        response.end()
        return
      }
      if (isApiPath(pathname)) {
        let endpoint: ApiEndpoint | undefined
        try { endpoint = await options.connection?.resolve() }
        catch { sendStatus(response, 503); clientRequest.resume(); return }
        if (response.destroyed || clientRequest.destroyed) return
        // Requests, particularly writes, are never replayed after a network failure.
        forwardToApi(apiUrl, upstreamHost, clientRequest, response, upstreamTimeoutFor(pathname, timeoutMs), options.connection, endpoint,
          { remember: bytes => nativeOAuth.remember(bytes), complete: () => { if (pathname === '/api/v1/google/desktop/callback') nativeOAuth.complete(requestUrl) } })
        return
      }

      clientRequest.resume()
      if (assetRoot === undefined) {
        sendStatus(response, 404)
        return
      }
      const method = clientRequest.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        sendStatus(response, 405)
        return
      }
      const file = await resolveAssetFile(assetRoot, pathname)
      if (file === undefined) {
        sendStatus(response, 404)
        return
      }
      if (method === 'HEAD') {
        response.writeHead(200, { 'content-type': contentTypeFor(file) })
        response.end()
        return
      }
      const stream = createReadStream(file)
      stream.on('error', () => sendStatus(response, 500))
      response.once('close', () => stream.destroy())
      stream.once('open', () => {
        if (response.destroyed) { stream.destroy(); return }
        response.writeHead(200, { 'content-type': contentTypeFor(file) })
        stream.pipe(response)
      })
    })().catch(() => sendStatus(response, 500))
  })

  server.listen(options.port ?? 0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    server.close()
    throw new Error('desktop bridge failed to bind a loopback port')
  }
  const nativeOAuth = createNativeOAuthGuard(`http://127.0.0.1:${address.port}`)

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}
