import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { healthResponseSchema } from '@hasarbotu/contracts'
import { API_VERSION, buildApp, fixedClock } from '../src/index.js'

let app: FastifyInstance | undefined

afterEach(async () => {
  if (app !== undefined) {
    await app.close()
    app = undefined
  }
})

describe('GET /health', () => {
  it('200 doner ve contracts health semasini gecer', async () => {
    app = buildApp({ clock: fixedClock('2026-07-11T09:00:00.000Z'), loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    const body: unknown = response.json()
    expect(healthResponseSchema.safeParse(body).success).toBe(true)
  })

  it('sabit clock ile deterministik ve alan-tam yanit uretir', async () => {
    app = buildApp({ clock: fixedClock('2026-07-11T09:00:00.000Z'), loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = response.json() as Record<string, unknown>

    expect(body).toEqual({
      status: 'ok',
      service: 'hasarbotu-api',
      version: API_VERSION,
      checkedAt: '2026-07-11T09:00:00.000Z',
    })
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'service', 'status', 'version'])
  })

  it('gercek clock ile de sema gecerlidir', async () => {
    app = buildApp({ loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(healthResponseSchema.safeParse(response.json()).success).toBe(true)
  })

  it('hassas sistem bilgisi tasimaz', async () => {
    app = buildApp({ clock: fixedClock('2026-07-11T09:00:00.000Z'), loggerEnabled: false })
    const response = await app.inject({ method: 'GET', url: '/health' })
    const raw = response.payload

    expect(raw).not.toContain('env')
    expect(raw).not.toContain('hostname')
    expect(raw).not.toMatch(/[A-Za-z]:\\/)
    expect(raw).not.toContain('process')
  })
})
