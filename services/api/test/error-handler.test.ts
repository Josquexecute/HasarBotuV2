import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { failureEnvelopeSchema } from '@hasarbotu/contracts'
import { buildApp } from '../src/index.js'

let app: FastifyInstance | undefined

afterEach(async () => {
  if (app !== undefined) {
    await app.close()
    app = undefined
  }
})

describe('merkezi hata isleyicisi', () => {
  it('beklenmeyen hata 500 + internal_error zarfi doner; ham mesaj sizmaz', async () => {
    app = buildApp({ loggerEnabled: false })
    app.get('/patla', () => {
      throw new Error('SECRET-DETAIL-123 C:\\gizli\\yol')
    })
    const response = await app.inject({ method: 'GET', url: '/patla' })

    expect(response.statusCode).toBe(500)
    const parsed = failureEnvelopeSchema.safeParse(response.json())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.error.code).toBe('internal_error')
    expect(parsed.data.error.requestId).toMatch(/^req-/)
    expect(response.payload).not.toContain('SECRET-DETAIL-123')
    expect(response.payload).not.toContain('gizli')
    expect(response.payload).not.toContain('stack')
  })

  it('statusCode tasiyan 4xx cerceve hatasi durum kodunu korur, guvenli zarf doner', async () => {
    app = buildApp({ loggerEnabled: false })
    app.get('/caydanlik', () => {
      const error = new Error('I am a teapot with SECRET-TEA') as Error & { statusCode: number }
      error.statusCode = 418
      throw error
    })
    const response = await app.inject({ method: 'GET', url: '/caydanlik' })

    expect(response.statusCode).toBe(418)
    const parsed = failureEnvelopeSchema.safeParse(response.json())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.error.code).toBe('validation_error')
    expect(response.payload).not.toContain('SECRET-TEA')
  })

  it('body limit asimi guvenli zarfla doner (413)', async () => {
    app = buildApp({ loggerEnabled: false })
    app.post('/yansit', async (request) => ({ alindi: typeof request.body }))
    const huge = 'x'.repeat(1_200_000)
    const response = await app.inject({
      method: 'POST',
      url: '/yansit',
      headers: { 'content-type': 'text/plain' },
      payload: huge,
    })

    expect(response.statusCode).toBe(413)
    expect(failureEnvelopeSchema.safeParse(response.json()).success).toBe(true)
    expect(response.payload).not.toContain('xxx')
  })

  it('hata loglari secret header degerlerini tasimaz; log yakalama calisiyor', async () => {
    const lines: string[] = []
    app = buildApp({
      logLevel: 'info',
      loggerStream: { write: (message: string) => void lines.push(message) },
    })
    app.get('/logla-patla', () => {
      throw new Error('log-ici-detay')
    })
    await app.inject({
      method: 'GET',
      url: '/logla-patla',
      headers: { authorization: 'Bearer cok-gizli-token', 'x-api-key': 'anahtar-42' },
    })

    const combined = lines.join('')
    expect(combined.length).toBeGreaterThan(0)
    expect(combined).toContain('requestId')
    expect(combined).not.toContain('cok-gizli-token')
    expect(combined).not.toContain('anahtar-42')
  })
})
