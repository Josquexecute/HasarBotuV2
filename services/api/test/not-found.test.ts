import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { failureEnvelopeSchema, type FailureEnvelope } from '@hasarbotu/contracts'
import { buildApp } from '../src/index.js'

let app: FastifyInstance | undefined

afterEach(async () => {
  if (app !== undefined) {
    await app.close()
    app = undefined
  }
})

describe('bilinmeyen route ve method', () => {
  it('bilinmeyen route guvenli not_found zarfi doner', async () => {
    app = buildApp({ loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/olmayan-yol' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
    const parsed = failureEnvelopeSchema.safeParse(response.json())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.ok).toBe(false)
    expect(parsed.data.error.code).toBe('not_found')
    expect(parsed.data.error.requestId).toMatch(/^req-/)
  })

  it('yanlis method (POST /health) ayni guvenli zarfla doner', async () => {
    app = buildApp({ loggerEnabled: false })
    const response = await app.inject({ method: 'POST', url: '/health' })

    expect(response.statusCode).toBe(404)
    const body = response.json() as FailureEnvelope
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('yanit istek yolunu geri yansitmaz', async () => {
    app = buildApp({ loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/gizli-arama-terimi-123' })
    expect(response.payload).not.toContain('gizli-arama-terimi-123')
  })
})
