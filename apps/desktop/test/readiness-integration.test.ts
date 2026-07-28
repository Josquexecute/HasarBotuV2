import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { API_SERVICE_NAME, API_VERSION, buildApp } from '@hasarbotu/api'
import { HEALTH_ROUTE } from '@hasarbotu/contracts'
import { probeApiReadiness } from '../src/main/readiness.js'

/**
 * D3 hazırlık kapısının GERÇEK API'ye karşı doğrulaması.
 *
 * Veritabanı gerekmez: `/health` sürümlü tabanın dışındadır ve bağımlılık
 * kontrolü `buildApp` üzerinden enjekte edilebilir. Böylece kapı, ortam
 * koşuluna bağlı olmadan HER koşumda gerçek bir Fastify sunucusuna karşı
 * çalışır.
 *
 * Sözleşmeye uymayan yanıtlar için küçük bir `node:http` sunucusu kullanılır:
 * kabuğun gövde çözümleyicisi, taklit edilmiş bir istemciye değil gerçek bir
 * HTTP yanıtına karşı sınanır.
 */

/** Verilen gövdeyi `/health` üzerinden dönen asgari sunucu. */
async function startStubServer(handler: (path: string) => { status: number; body: string }): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const server: Server = createServer((request, response) => {
    const { status, body } = handler(request.url ?? '/')
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(body)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('stub server did not bind')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

describe('probeApiReadiness — gerçek API', () => {
  let app: FastifyInstance
  let apiOrigin: string

  beforeAll(async () => {
    app = buildApp({ loggerEnabled: false })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.addresses()[0]
    if (address === undefined) throw new Error('api did not bind')
    apiOrigin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (app !== undefined) await app.close()
  })

  it('çalışan gerçek API\'yi hazır ve uyumlu bulur', async () => {
    const result = await probeApiReadiness({ apiOrigin })
    expect(result).toEqual({ outcome: 'ready', ready: true, apiVersion: API_VERSION })
  })

  it('bağımlılığı sağlıksız gerçek API\'yi hazır SAYMAZ', async () => {
    // Veritabanı düşmüş bir API'de oturum açma dâhil hiçbir akış tamamlanamaz.
    const degraded = buildApp({ loggerEnabled: false, healthDependencyCheck: async () => false })
    await degraded.listen({ host: '127.0.0.1', port: 0 })
    try {
      const address = degraded.addresses()[0]
      if (address === undefined) throw new Error('degraded api did not bind')
      const result = await probeApiReadiness({ apiOrigin: `http://127.0.0.1:${address.port}` })
      expect(result).toEqual({ outcome: 'api_degraded', ready: false, apiVersion: API_VERSION })
    } finally {
      await degraded.close()
    }
  })

  it('erişilemeyen API\'de sahte başarı üretmez', async () => {
    const result = await probeApiReadiness({ apiOrigin: 'http://127.0.0.1:1', timeoutMs: 2_000 })
    expect(result).toEqual({ outcome: 'unreachable', ready: false })
  })

  it('zaman aşımına uğrayan sunucuyu hazır saymaz', async () => {
    // Hiç yanıt vermeyen sunucu: kapı süresiz beklemez.
    const server = createServer(() => { /* yanıt yok */ })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('hang server did not bind')
    try {
      const started = Date.now()
      const result = await probeApiReadiness({
        apiOrigin: `http://127.0.0.1:${address.port}`,
        timeoutMs: 500,
      })
      expect(result).toEqual({ outcome: 'unreachable', ready: false })
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  })

  it('sözleşmeye uymayan gövdeyi hazır saymaz', async () => {
    const stub = await startStubServer(() => ({ status: 200, body: JSON.stringify({ hazir: true }) }))
    try {
      expect(await probeApiReadiness({ apiOrigin: stub.origin }))
        .toEqual({ outcome: 'invalid_response', ready: false })
    } finally {
      await stub.close()
    }
  })

  it('HTML dönen bir sunucuyu (yanlış adres) hazır saymaz', async () => {
    const stub = await startStubServer(() => ({ status: 200, body: '<!doctype html><title>x</title>' }))
    try {
      expect(await probeApiReadiness({ apiOrigin: stub.origin }))
        .toEqual({ outcome: 'unreachable', ready: false })
    } finally {
      await stub.close()
    }
  })

  it('başka bir servisi HasarBotu sunucusu saymaz', async () => {
    const stub = await startStubServer((path) => ({
      status: path === HEALTH_ROUTE ? 200 : 404,
      body: JSON.stringify({
        status: 'ok',
        service: 'baska-servis',
        version: '1.0.0',
        checkedAt: '2026-07-28T09:00:00.000Z',
      }),
    }))
    try {
      expect(await probeApiReadiness({ apiOrigin: stub.origin }))
        .toEqual({ outcome: 'unknown_service', ready: false, apiVersion: '1.0.0' })
    } finally {
      await stub.close()
    }
  })

  it('uyumsuz sürümlü gerçek yanıtta pencereyi açtırmaz', async () => {
    const stub = await startStubServer(() => ({
      status: 200,
      body: JSON.stringify({
        status: 'ok',
        service: API_SERVICE_NAME,
        version: '9.9.9',
        checkedAt: '2026-07-28T09:00:00.000Z',
      }),
    }))
    try {
      expect(await probeApiReadiness({ apiOrigin: stub.origin }))
        .toEqual({ outcome: 'incompatible_major', ready: false, apiVersion: '9.9.9' })
    } finally {
      await stub.close()
    }
  })

  it('HTTP hata kodunu hazır saymaz', async () => {
    const stub = await startStubServer(() => ({ status: 503, body: '{}' }))
    try {
      expect(await probeApiReadiness({ apiOrigin: stub.origin }))
        .toEqual({ outcome: 'unreachable', ready: false })
    } finally {
      await stub.close()
    }
  })
})
