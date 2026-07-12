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
