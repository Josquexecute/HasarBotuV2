import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, relative, resolve, sep, extname, isAbsolute } from 'node:path'
import { once } from 'node:events'
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
}

export interface DesktopBridge {
  /** Renderer'ın yükleyeceği TEK origin, ör. `http://127.0.0.1:51234`. */
  readonly origin: string
  readonly port: number
  close(): Promise<void>
}

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000

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
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(String(status))
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
  const rel = relative(assetRoot, candidate)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel) || rel.startsWith(`..${sep}`))) {
    return undefined
  }

  const found = await stat(candidate).catch(() => undefined)
  if (found?.isFile() === true) return candidate
  if (shouldFallbackToIndex(parsed.segments)) {
    const index = await stat(indexFile).catch(() => undefined)
    if (index?.isFile() === true) return indexFile
  }
  return undefined
}

function forwardToApi(
  apiUrl: URL,
  upstreamHost: string,
  clientRequest: IncomingMessage,
  response: ServerResponse,
  timeoutMs: number,
): void {
  const upstream = httpRequest(
    {
      protocol: apiUrl.protocol,
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      method: clientRequest.method ?? 'GET',
      path: clientRequest.url ?? '/',
      headers: buildUpstreamHeaders(clientRequest.headers, upstreamHost),
    },
    (upstreamResponse) => {
      // `set-cookie` dizi olarak, HİÇ dokunulmadan aktarılır.
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        buildDownstreamHeaders(upstreamResponse.headers),
      )
      upstreamResponse.pipe(response)
    },
  )

  upstream.setTimeout(timeoutMs, () => {
    upstream.destroy()
    if (!response.headersSent) sendStatus(response, 504)
    else response.destroy()
  })

  upstream.on('error', () => {
    // API kapalı/erişilemez. Ham hata metni istemciye taşınmaz; UI
    // adapter'ları bunu zaten `unavailable` olarak ele alır.
    if (!response.headersSent) sendStatus(response, 502)
    else response.destroy()
  })

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
  const upstreamHost = apiUrl.host
  const timeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const assetRoot = options.assetRoot === undefined ? undefined : resolve(options.assetRoot)

  const server: Server = createServer((clientRequest, response) => {
    void (async () => {
      const address = server.address()
      const listeningPort = typeof address === 'object' && address !== null ? address.port : 0
      if (!isAllowedBridgeHost(clientRequest.headers.host, listeningPort)) {
        sendStatus(response, 403)
        clientRequest.resume()
        return
      }

      const pathname = new URL(clientRequest.url ?? '/', 'http://127.0.0.1').pathname
      if (isApiPath(pathname)) {
        forwardToApi(apiUrl, upstreamHost, clientRequest, response, timeoutMs)
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
      response.writeHead(200, { 'content-type': contentTypeFor(file) })
      if (method === 'HEAD') {
        response.end()
        return
      }
      createReadStream(file).pipe(response)
    })()
  })

  server.listen(options.port ?? 0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    server.close()
    throw new Error('desktop bridge failed to bind a loopback port')
  }

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
