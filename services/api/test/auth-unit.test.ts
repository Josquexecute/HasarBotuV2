import { describe, expect, it } from 'vitest'
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createFixedWindowLimiter,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from '../src/index.js'

describe('parola (Argon2id)', () => {
  it('hash/verify dongusu calisir; yanlis parola reddedilir', async () => {
    const hash = await hashPassword('dogru-parola-123')
    expect(hash).toContain('$argon2id$')
    expect(await verifyPassword(hash, 'dogru-parola-123')).toBe(true)
    expect(await verifyPassword(hash, 'yanlis-parola-123')).toBe(false)
  })

  it('bozuk hash guvenli false doner (exception sizmaz)', async () => {
    expect(await verifyPassword('bozuk-hash', 'x')).toBe(false)
  })
})

describe('oturum token ve cerezleri', () => {
  it('token 256-bit base64url; hash deterministik sha256 hex', () => {
    const token = generateSessionToken()
    expect(token.length).toBeGreaterThanOrEqual(42)
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(generateSessionToken()).not.toBe(token)
  })

  it('cerez guvenli niteliklerle kurulur ve ayristirilir', () => {
    const cookie = buildSessionCookie('tok123', { maxAgeSeconds: 60, secure: false })
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok123`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=60')
    expect(cookie).not.toContain('Secure')
    expect(buildSessionCookie('t', { maxAgeSeconds: 1, secure: true })).toContain('Secure')

    const parsed = parseCookies(`${SESSION_COOKIE_NAME}=tok123; other=x`)
    expect(parsed[SESSION_COOKIE_NAME]).toBe('tok123')
    expect(parseCookies(undefined)).toEqual({})
  })

  it('temizleme cerezi Max-Age=0 ile doner', () => {
    expect(buildClearSessionCookie({ secure: false })).toContain('Max-Age=0')
  })
})

describe('sabit pencere hiz sinirlayici', () => {
  it('limiti asan istek reddedilir; pencere sonunda sifirlanir', () => {
    let now = 1_000
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 100, now: () => now })
    expect(limiter.consume('k').allowed).toBe(true)
    expect(limiter.consume('k').allowed).toBe(true)
    const blocked = limiter.consume('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    now += 101
    expect(limiter.consume('k').allowed).toBe(true)
    // farkli anahtar etkilenmez
    expect(limiter.consume('baska').allowed).toBe(true)
  })
})
