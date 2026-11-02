import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp, REDACTED_LOG_PATHS } from '../src/index.js'

let app: FastifyInstance | undefined

afterEach(async () => {
  if (app !== undefined) {
    await app.close()
    app = undefined
  }
})

describe('buildApp', () => {
  it('ignores forged proxy addresses by default and trusts only one explicitly enabled loopback hop', async () => {
    for (const enabled of [false, true]) {
      app = buildApp({ loggerEnabled: false, trustLoopbackProxy: enabled })
      app.get('/proxy-test', async request => ({ ip: request.ip }))
      for (const remoteAddress of ['127.0.0.1','::1','::ffff:127.0.0.1','192.168.1.108']) {
        const result = await app.inject({ url: '/proxy-test', remoteAddress, headers: { 'x-forwarded-for': '198.51.100.99, 10.20.0.5' } })
        expect(result.json().ip).toBe(enabled && remoteAddress !== '192.168.1.108' ? '10.20.0.5' : remoteAddress)
      }
      await app.close(); app = undefined
    }
  })
  it('port acmadan instance uretir', async () => {
    app = buildApp({ loggerEnabled: false })
    await app.ready()
    expect(app.server.listening).toBe(false)
  })

  it('health route bir kez kayitlidir', async () => {
    app = buildApp({ loggerEnabled: false })
    await app.ready()
    const routes = app.printRoutes()
    const matches = routes.match(/health/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('kapatilabilir ve acik handle birakmaz', async () => {
    app = buildApp({ loggerEnabled: false })
    await app.ready()
    await app.close()
    app = undefined
  })

  it('log redaksiyon yollari kimlik basliklarini kapsar', () => {
    expect(REDACTED_LOG_PATHS).toContain('req.headers.authorization')
    expect(REDACTED_LOG_PATHS).toContain('req.headers.cookie')
    expect(REDACTED_LOG_PATHS).toContain('req.headers["set-cookie"]')
    expect(REDACTED_LOG_PATHS).toContain('req.headers["x-api-key"]')
  })
})
