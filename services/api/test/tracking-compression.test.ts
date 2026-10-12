import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { registerTrackingResponseCompression } from '../src/tracking/response-compression.js'

const snapshot = { documents: Array.from({ length: 1000 }, (_, index) => ({
  id: `anonymous-document-${index}`, fileName: 'Anonim dosya — trafik poliçesi.pdf',
  relativePath: `Anonim klasör ${index}/Evraklar/trafik poliçesi.pdf`, status: 'pending',
})), googleEnabled: true, automaticSbmEnabled: false }
let app: FastifyInstance

afterEach(async () => { await app?.close() })

function setup(options: { payload?: unknown; status?: number; vary?: string; encoded?: boolean } = {}) {
  app = Fastify()
  registerTrackingResponseCompression(app)
  const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (options.vary) reply.header('vary', options.vary)
    if (options.encoded) reply.header('content-encoding', 'br')
    return reply.code(options.status ?? 200).send(options.payload ?? snapshot)
  }
  app.get('/api/v1/tracking', handler)
  app.get('/api/v1/other', handler)
  return app
}

describe('large tracking snapshot transfer', () => {
  it.each(['gzip','br, gzip, deflate','GZIP; q=0.5','*;q=1'])('compresses without changing JSON or UTF-8 bytes for %s', async (encoding) => {
    const response = await setup().inject({ url: '/api/v1/tracking', headers: { 'accept-encoding': encoding } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers['vary']).toBe('Accept-Encoding')
    expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length)
    const decoded = gunzipSync(response.rawPayload).toString('utf8')
    expect(decoded).toBe(JSON.stringify(snapshot))
    expect(JSON.parse(decoded)).toEqual(snapshot)
    expect(response.rawPayload.length).toBeLessThan(Buffer.byteLength(decoded) / 4)
  })

  it.each([undefined,'br','gzip;q=0','gzip;q=0, *;q=1','gzip;q=invalid, *;q=1','gzip;q=1.1','x-gzip'])('preserves the identity response when gzip is not accepted: %s', async (encoding) => {
    const response = await setup().inject({ url: '/api/v1/tracking', headers: encoding ? { 'accept-encoding': encoding } : {} })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['vary']).toBe('Accept-Encoding')
    expect(response.json()).toEqual(snapshot)
  })

  it.each(['Origin','Origin, accept-encoding','*'])('preserves existing cache variation: %s', async (vary) => {
    const response = await setup({ vary }).inject({ url: '/api/v1/tracking', headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['vary']).toBe(vary === 'Origin' ? 'Origin, Accept-Encoding' : vary)
  })

  it('keeps small snapshots unchanged', async () => {
    const response = await setup({ payload: { googleEnabled: true } }).inject({ url: '/api/v1/tracking', headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.json()).toEqual({ googleEnabled: true })
  })

  it('keeps authentication and error responses unchanged', async () => {
    const response = await setup({ status: 401 }).inject({ url: '/api/v1/tracking', headers: { 'accept-encoding': 'gzip' } })
    expect(response.statusCode).toBe(401)
    expect(response.headers['content-encoding']).toBeUndefined()
  })

  it('does not double encode an existing representation', async () => {
    const response = await setup({ encoded: true }).inject({ url: '/api/v1/tracking', headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBe('br')
    expect(response.payload).toBe(JSON.stringify(snapshot))
  })

  it('limits the change to the tracking snapshot route', async () => {
    const response = await setup().inject({ url: '/api/v1/other', headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.json()).toEqual(snapshot)
  })
})
