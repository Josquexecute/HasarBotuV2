import { describe, expect, it } from 'vitest'
import {
  AUTH_LOGIN_ROUTE,
  AUTH_LOGOUT_ROUTE,
  AUTH_SESSION_ROUTE,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  ROLE_CODES,
  emailSchema,
  loginRequestSchema,
  sessionResponseSchema,
} from '../src/index.js'

describe('auth sozlesmeleri', () => {
  it('route sabitleri surumlu tabani izler', () => {
    expect(AUTH_LOGIN_ROUTE).toBe('/api/v1/auth/login')
    expect(AUTH_LOGOUT_ROUTE).toBe('/api/v1/auth/logout')
    expect(AUTH_SESSION_ROUTE).toBe('/api/v1/auth/session')
  })

  it('email bicimi sinirlidir', () => {
    expect(emailSchema.safeParse('eksper@baran.example').success).toBe(true)
    expect(emailSchema.safeParse('bosluk yok@x.y').success).toBe(false)
    expect(emailSchema.safeParse('atsiz.example').success).toBe(false)
    expect(emailSchema.safeParse(`a@${'b'.repeat(260)}.c`).success).toBe(false)
  })

  it('login istegi strict ve parola sinirlidir', () => {
    const valid = { email: 'a@b.co', password: 'p'.repeat(MIN_PASSWORD_LENGTH) }
    expect(loginRequestSchema.safeParse(valid).success).toBe(true)
    expect(loginRequestSchema.safeParse({ ...valid, ekstra: 1 }).success).toBe(false)
    expect(
      loginRequestSchema.safeParse({ ...valid, password: 'p'.repeat(MIN_PASSWORD_LENGTH - 1) })
        .success,
    ).toBe(false)
    expect(
      loginRequestSchema.safeParse({ ...valid, password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) })
        .success,
    ).toBe(false)
  })

  it('session yaniti strict; roller yalniz katalogdan', () => {
    const valid = {
      user: {
        id: 'usr-1',
        organizationId: 'org-1',
        email: 'a@b.co',
        displayName: 'Deneme Kullanici',
        roles: ['admin', 'expert'],
      },
      expiresAt: '2026-07-12T20:00:00.000Z',
    }
    expect(sessionResponseSchema.safeParse(valid).success).toBe(true)
    expect(ROLE_CODES).toHaveLength(6)
    expect(
      sessionResponseSchema.safeParse({
        ...valid,
        user: { ...valid.user, roles: ['sahte_rol'] },
      }).success,
    ).toBe(false)
    expect(
      sessionResponseSchema.safeParse({
        ...valid,
        user: { ...valid.user, passwordHash: 'x' },
      }).success,
    ).toBe(false)
  })
})
