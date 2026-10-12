import type { FastifyInstance } from 'fastify'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

const gzipAsync = promisify(gzip)
const MINIMUM_TRACKING_COMPRESSION_BYTES = 64 * 1024

function acceptsGzip(header: string | undefined): boolean {
  const encodings = (header ?? '').split(',').map((entry) => {
    const name = entry.split(';')[0]!.trim().toLowerCase()
    const match = entry.match(/^\s*(?:gzip|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i)
    return { name, quality: match ? Number(match[1] ?? 1) : 0 }
  })
  const explicit = encodings.filter((entry) => entry.name === 'gzip')
  const candidates = explicit.length ? explicit : encodings.filter((entry) => entry.name === '*')
  return candidates.length > 0 && candidates.every((entry) => entry.quality > 0)
}

/** The full tracking snapshot can contain tens of thousands of documents. */
export function registerTrackingResponseCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.url !== '/api/v1/tracking' || reply.statusCode !== 200
      || !String(reply.getHeader('content-type') ?? '').startsWith('application/json')
      || reply.hasHeader('content-encoding') || (typeof payload !== 'string' && !Buffer.isBuffer(payload))) return payload
    const originalBytes = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length
    if (originalBytes < MINIMUM_TRACKING_COMPRESSION_BYTES) return payload
    const vary = String(reply.getHeader('vary') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
    if (!vary.some((entry) => ['*','accept-encoding'].includes(entry.toLowerCase()))) vary.push('Accept-Encoding')
    reply.header('vary', vary.join(', '))
    if (!acceptsGzip(request.headers['accept-encoding'])) return payload
    const compressed = await gzipAsync(payload)
    if (compressed.length >= originalBytes) return payload
    reply.header('content-encoding', 'gzip')
    reply.header('content-length', compressed.length)
    return compressed
  })
}
