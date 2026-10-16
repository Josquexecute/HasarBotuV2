import type pg from 'pg'
import type { SessionUser } from '@hasarbotu/contracts'
import { allowedPermissions,loadRolePolicy } from './permissions.js'
import { equalizeVerifyTiming, verifyPassword } from './password.js'
import { generateSessionToken, hashSessionToken } from './token.js'
import type { AuthStore, AuthUserRow } from './store.js'
import type { FixedWindowLimiter } from './rate-limit.js'
import { withTransaction } from '../db/executor.js'
import type { AuditService } from '../audit/service.js'

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
    ...(user.permissions ? { permissions: [...user.permissions] } : {}),
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
  readonly pool: pg.Pool
  readonly audit: AuditService
  readonly sessionTtlSeconds?: number
}

/**
 * Login akisi: hiz siniri -> kullanici -> kilit -> parola -> oturum.
 *
 * Dis gorunum tekduzedir: bilinmeyen e-posta, yanlis parola, kilitli veya
 * pasif hesap AYNI `invalid` sonucunu verir (user-enumeration korumasi);
 * ayrintili neden yalniz merkezi audit kaydindadir. Ham parola/e-posta audit
 * details icine yazilmaz. Kullaniciyi degistiren adimlar (sayac artisi, oturum
 * olusturma) ilgili audit kaydiyla AYNI transaction icinde atomik yazilir.
 */
export async function login(deps: AuthServiceDeps, input: LoginInput): Promise<LoginOutcome> {
  const decision = deps.limiter.consume(`login:${input.ip}`)
  if (!decision.allowed) {
    await deps.audit.record(deps.pool, {
      action: 'auth.login_rate_limited',
      requestId: input.requestId,
      details: { reason: 'rate_limited' },
    })
    return { kind: 'rate_limited', retryAfterMs: decision.retryAfterMs }
  }

  const user = await deps.store.findUserByEmail(input.email)
  if (user === undefined) {
    await equalizeVerifyTiming()
    await deps.audit.record(deps.pool, {
      action: 'auth.login_failed',
      requestId: input.requestId,
      details: { reason: 'unknown_user' },
    })
    return { kind: 'invalid' }
  }

  const base = { organizationId: user.organizationId, actorUserId: user.id, requestId: input.requestId }

  if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
    await equalizeVerifyTiming()
    await deps.audit.record(deps.pool, { ...base, action: 'auth.login_failed', details: { reason: 'locked' } })
    return { kind: 'invalid' }
  }

  if (user.status !== 'active') {
    await equalizeVerifyTiming()
    await deps.audit.record(deps.pool, { ...base, action: 'auth.login_failed', details: { reason: 'disabled' } })
    return { kind: 'invalid' }
  }

  if (user.passwordHash === null) {
    await equalizeVerifyTiming()
    await deps.audit.record(deps.pool,{ ...base,action: 'auth.login_failed',details: { reason: 'google_only' } })
    return { kind: 'invalid' }
  }
  const passwordOk = await verifyPassword(user.passwordHash, input.password)
  if (!passwordOk) {
    // Sayac artisi + basarisiz-giris audit'i (ve gerekiyorsa kilit audit'i) atomik.
    await withTransaction(deps.pool, async (client) => {
      const counter = await deps.store.recordFailedLogin(user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES, client)
      await deps.audit.record(client, {
        ...base,
        action: 'auth.login_failed',
        details: { reason: 'wrong_password', failedLoginCount: counter.failedLoginCount },
      })
      if (counter.lockStarted) {
        await deps.audit.record(client, {
          ...base,
          action: 'auth.account_locked',
          details: { failedLoginCount: counter.failedLoginCount, lockMinutes: LOCKOUT_MINUTES },
        })
      }
    })
    return { kind: 'invalid' }
  }

  // Sayac sifirlama + oturum olusturma + basarili-giris audit'i atomik: yarim
  // oturum veya audit'siz oturum kalmaz.
  return withTransaction(deps.pool, async (client): Promise<LoginOutcome> => {
    // Argon2 runs outside the lock. Recheck the account under the same lock
    // used by failed logins and administration before issuing a session.
    const current = await deps.store.lockUserForLogin(user.id, client)
    const reason = current === undefined ? 'unknown_user'
      : current.status !== 'active' ? 'disabled'
      : current.passwordHash !== user.passwordHash ? 'credentials_changed'
      : current.lockedUntil !== null && current.lockedUntil.getTime() > Date.now() ? 'locked'
      : undefined
    if (reason !== undefined || current === undefined) {
      await deps.audit.record(client, {
        organizationId: user.organizationId,
        ...(current === undefined ? {} : { actorUserId: current.id }),
        requestId: input.requestId,
        action: 'auth.login_failed', details: { reason: reason ?? 'unknown_user' },
      })
      return { kind: 'invalid' }
    }
    const token = generateSessionToken()
    const ttlSeconds = deps.sessionTtlSeconds ?? SESSION_TTL_SECONDS
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    if (current.failedLoginCount > 0) await deps.store.resetFailedLogins(current.id, client)
    await deps.store.createSession(
      { tokenHash: hashSessionToken(token), userId: user.id, organizationId: user.organizationId, expiresAt },
      client,
    )
    await deps.audit.record(client, { ...base, action: 'auth.login_succeeded' })
    const permissions = allowedPermissions(await loadRolePolicy(client, current.organizationId), current.roles)
    return { kind: 'ok', token, expiresAt, user: toSessionUser({ ...current, permissions }) }
  })
}
