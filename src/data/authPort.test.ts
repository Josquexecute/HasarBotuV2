import { describe, expect, it, vi } from 'vitest'
import { createHttpAuthAdapter, HttpAuthError } from './authPort'

const SESSION_BODY = {
  user: {
    id: 'user-1',
    organizationId: 'org-1',
    email: 'yazici@baran.example',
    displayName: 'Yazıcı Kullanıcı',
    roles: ['case_manager'],
  },
  expiresAt: '2026-07-13T21:00:00.000Z',
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  }) as unknown as typeof fetch
}

describe('HttpAuthAdapter bootstrap', () => {
  it('gecerli oturum -> SessionUser (parola/token tasinmaz)', async () => {
    const auth = createHttpAuthAdapter({ baseUrl: 'http://api.test', fetchImpl: respond(200, SESSION_BODY) })
    const user = await auth.bootstrap()
    expect(user).toEqual({
      id: 'user-1',
      organizationId: 'org-1',
      email: 'yazici@baran.example',
      displayName: 'Yazıcı Kullanıcı',
      roles: ['case_manager'],
    })
  })

  it('401 -> null (anonim); 5xx/ag -> unavailable HttpAuthError', async () => {
    const anon = createHttpAuthAdapter({ fetchImpl: respond(401, {}) })
    expect(await anon.bootstrap()).toBeNull()

    await expect(createHttpAuthAdapter({ fetchImpl: respond(503) }).bootstrap()).rejects.toMatchObject({
      name: 'HttpAuthError',
      kind: 'unavailable',
    })

    const netFail = vi.fn().mockRejectedValue(new TypeError('failed to fetch')) as unknown as typeof fetch
    await expect(createHttpAuthAdapter({ fetchImpl: netFail }).bootstrap()).rejects.toBeInstanceOf(HttpAuthError)
  })
})

describe('HttpAuthAdapter login', () => {
  it('200 -> SessionUser', async () => {
    const auth = createHttpAuthAdapter({ fetchImpl: respond(200, SESSION_BODY) })
    const user = await auth.login('yazici@baran.example', 'cok-guclu-parola-42')
    expect(user.displayName).toBe('Yazıcı Kullanıcı')
  })

  it('401 ve 400 -> tekduze invalid_credentials', async () => {
    await expect(createHttpAuthAdapter({ fetchImpl: respond(401) }).login('a@b.co', 'x'.repeat(10))).rejects.toMatchObject({
      kind: 'invalid_credentials',
    })
    await expect(createHttpAuthAdapter({ fetchImpl: respond(400) }).login('a@b.co', 'x'.repeat(10))).rejects.toMatchObject({
      kind: 'invalid_credentials',
    })
  })

  it('429 -> rate_limited + retryAfterSeconds', async () => {
    const auth = createHttpAuthAdapter({ fetchImpl: respond(429, {}, { 'retry-after': '42' }) })
    await expect(auth.login('a@b.co', 'x'.repeat(10))).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: 42,
    })
  })

  it('5xx ve ag hatasi -> unavailable', async () => {
    await expect(createHttpAuthAdapter({ fetchImpl: respond(500) }).login('a@b.co', 'x'.repeat(10))).rejects.toMatchObject({
      kind: 'unavailable',
    })
    const netFail = vi.fn().mockRejectedValue(new TypeError('down')) as unknown as typeof fetch
    await expect(createHttpAuthAdapter({ fetchImpl: netFail }).login('a@b.co', 'x'.repeat(10))).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })

  it('login govdesi email+password gonderir, GET session credentials include kullanir', async () => {
    const fetchImpl = respond(200, SESSION_BODY)
    const auth = createHttpAuthAdapter({ baseUrl: 'http://api.test', fetchImpl })
    await auth.login('yazici@baran.example', 'cok-guclu-parola-42')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'yazici@baran.example', password: 'cok-guclu-parola-42' }),
      }),
    )
  })
})

describe('HttpAuthAdapter logout', () => {
  it('en iyi caba: ag hatasinda bile reddetmez', async () => {
    const netFail = vi.fn().mockRejectedValue(new TypeError('down')) as unknown as typeof fetch
    await expect(createHttpAuthAdapter({ fetchImpl: netFail }).logout()).resolves.toBeUndefined()
  })
})
