import type { SessionUser } from '@hasarbotu/contracts'
import { equalizeVerifyTiming, verifyPassword } from './password.js'
import { generateSessionToken, hashSessionToken } from './token.js'
import type { AuthStore, AuthUserRow } from './store.js'
import type { FixedWindowLimiter } from './rate-limit.js'

/** Oturum ve kilitleme politikasi (HB-2026-011). */
export const SESSION_TTL_SECONDS = 12 * 60 * 60
export const MAX_FAILED_LOGINS = 5
export const LOCKOUT_MINUTES = 15

export type LoginOutcome =
  | { readonly kind: 'rate_limited'; readonly retryAfterMs: number }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'ok'
      readonly token: string
      readonly expiresAt: Date
      readonly user: SessionUser
    }

export function toSessionUser(user: AuthUserRow): SessionUser {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName,
    roles: [...user.roles],
  }
}

export interface LoginInput {
  readonly email: string
  readonly password: string
  readonly ip: string
  readonly requestId: string
}

export interface AuthServiceDeps {
  readonly store: AuthStore
  readonly limiter: FixedWindowLimiter
  readonly sessionTtlSeconds?: number
}

/**
 * Login akisi: hiz siniri -> kullanici -> kilit -> parola -> oturum.
 *
 * Dis gorunum tekduzedir: bilinmeyen e-posta, yanlis parola, kilitli veya
 * pasif hesap AYNI `invalid` sonucunu verir (user-enumeration korumasi);
 * ayrintili neden yalniz audit kaydindadir. Ham parola/e-posta audit
 * details icine yazilmaz.
 */
export async function login(deps: AuthServiceDeps, input: LoginInput): Promise<LoginOutcome> {
  const decision = deps.limiter.consume(`login:${input.ip}`)
  if (!decision.allowed) {
    await deps.store.insertAudit({
      action: 'auth.login_rate_limited',
      requestId: input.requestId,
      details: { reason: 'rate_limited' },
    })
    return { kind: 'rate_limited', retryAfterMs: decision.retryAfterMs }
  }

  const user = await deps.store.findUserByEmail(input.email)
  if (user === undefined) {
    await equalizeVerifyTiming()
    await deps.store.insertAudit({
      action: 'auth.login_failed',
      requestId: input.requestId,
      details: { reason: 'unknown_user' },
    })
    return { kind: 'invalid' }
  }

  const base = { organizationId: user.organizationId, actorUserId: user.id, requestId: input.requestId }

  if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
    await equalizeVerifyTiming()
    await deps.store.insertAudit({ ...base, action: 'auth.login_failed', details: { reason: 'locked' } })
    return { kind: 'invalid' }
  }

  if (user.status !== 'active') {
    await equalizeVerifyTiming()
    await deps.store.insertAudit({ ...base, action: 'auth.login_failed', details: { reason: 'disabled' } })
    return { kind: 'invalid' }
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password)
  if (!passwordOk) {
    const counter = await deps.store.recordFailedLogin(user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES)
    await deps.store.insertAudit({
      ...base,
      action: 'auth.login_failed',
      details: { reason: 'wrong_password', failedLoginCount: counter.failedLoginCount },
    })
    if (counter.lockedUntil !== null && counter.failedLoginCount === MAX_FAILED_LOGINS) {
      await deps.store.insertAudit({
        ...base,
        action: 'auth.account_locked',
        details: { failedLoginCount: counter.failedLoginCount, lockMinutes: LOCKOUT_MINUTES },
      })
    }
    return { kind: 'invalid' }
  }

  if (user.failedLoginCount > 0) await deps.store.resetFailedLogins(user.id)

  const token = generateSessionToken()
  const ttlSeconds = deps.sessionTtlSeconds ?? SESSION_TTL_SECONDS
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await deps.store.createSession({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    organizationId: user.organizationId,
    expiresAt,
  })
  await deps.store.insertAudit({ ...base, action: 'auth.login_succeeded' })

  return { kind: 'ok', token, expiresAt, user: toSessionUser(user) }
}
