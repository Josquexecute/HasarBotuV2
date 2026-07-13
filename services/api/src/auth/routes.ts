import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  AUTH_LOGOUT_ROUTE,
  AUTH_SESSION_ROUTE,
  failureEnvelopeSchema,
  loginRequestSchema,
  sessionResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { resolveSession, sendUnauthorized } from './guard.js'
import { createAuthStore } from './store.js'
import { createFixedWindowLimiter, type FixedWindowOptions } from './rate-limit.js'
import { login, toSessionUser } from './service.js'
import {
  buildClearSessionCookie,
  buildSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
} from './cookies.js'
import { hashSessionToken } from './token.js'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'

export interface AuthRoutesOptions {
  readonly pool: pg.Pool
  /** Uretimde true (HTTPS); yerel gelistirmede false. */
  readonly cookieSecure: boolean
  readonly sessionTtlSeconds?: number
  /** Varsayilan: IP basina dakikada 10 login denemesi. */
  readonly loginRateLimit?: Pick<FixedWindowOptions, 'limit' | 'windowMs'>
}

export const DEFAULT_LOGIN_RATE_LIMIT: Pick<FixedWindowOptions, 'limit' | 'windowMs'> = {
  limit: 10,
  windowMs: 60_000,
}

/**
 * Auth uclari: login / logout / session. Yalniz DATABASE_URL yapilandirilmis
 * API'de kayitlidir; kimlik bilgisi hatalari tekduze 401 doner, hicbir yanit
 * veya log ham parola/token tasimaz.
 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const store = createAuthStore(options.pool)
  const audit = createAuditService()
  const limiter = createFixedWindowLimiter({
    ...(options.loginRateLimit ?? DEFAULT_LOGIN_RATE_LIMIT),
  })

  app.post(AUTH_LOGIN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const parsed = loginRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({
          ok: false,
          error: zodErrorToApiError(parsed.error, requestId),
        }),
      )
    }

    const outcome = await login(
      {
        store,
        limiter,
        pool: options.pool,
        audit,
        ...(options.sessionTtlSeconds !== undefined ? { sessionTtlSeconds: options.sessionTtlSeconds } : {}),
      },
      { email: parsed.data.email, password: parsed.data.password, ip: request.ip, requestId },
    )

    if (outcome.kind === 'rate_limited') {
      void reply.header('retry-after', Math.ceil(outcome.retryAfterMs / 1000))
      return reply.code(429).send(failureBody('rate_limited', 'Too many login attempts.', requestId))
    }
    if (outcome.kind === 'invalid') {
      return reply.code(401).send(failureBody('unauthorized', 'Invalid credentials.', requestId))
    }

    const maxAgeSeconds = Math.floor((outcome.expiresAt.getTime() - Date.now()) / 1000)
    void reply.header(
      'set-cookie',
      buildSessionCookie(outcome.token, { maxAgeSeconds, secure: options.cookieSecure }),
    )
    return sessionResponseSchema.parse({
      user: outcome.user,
      expiresAt: outcome.expiresAt.toISOString(),
    })
  })

  app.get(AUTH_SESSION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await resolveSession(store, request)
    if (session === undefined) {
      sendUnauthorized(reply, requestId)
      return
    }
    return sessionResponseSchema.parse({
      user: toSessionUser(session.user),
      expiresAt: session.expiresAt.toISOString(),
    })
  })

  app.post(AUTH_LOGOUT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME]
    if (token !== undefined && token.length > 0) {
      const tokenHash = hashSessionToken(token)
      // Oturum iptali + audit AYNI transaction'da: iptal edildiyse mutlaka
      // audit'lenir, audit yazilamazsa iptal geri alinir (yarim kayit olmaz).
      await withTransaction(options.pool, async (client) => {
        const session = await store.findActiveSession(tokenHash, client)
        const revoked = await store.revokeSession(tokenHash, client)
        if (revoked) {
          await audit.record(client, {
            action: 'auth.logout',
            requestId,
            ...(session !== undefined
              ? { organizationId: session.user.organizationId, actorUserId: session.user.id }
              : {}),
          })
        }
      })
    }
    void reply.header('set-cookie', buildClearSessionCookie({ secure: options.cookieSecure }))
    return reply.code(204).send()
  })
}
