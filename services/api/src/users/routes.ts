import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  USERS_ROUTE,
  USER_ROLES_ROUTE,
  failureEnvelopeSchema,
  userParamsSchema,
  userResponseSchema,
  usersResponseSchema,
  userRolesUpdateRequestSchema,
  zodErrorToApiError,
  type RoleCode,
} from '@hasarbotu/contracts'
import { requireAnyRole } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { failureBody } from '../errors/failure.js'
import { createUsersStore } from './store.js'

export interface UserRoutesOptions {
  readonly pool: pg.Pool
}

/** HB-011: kullanıcı/rol yönetimi yalnız admin yetkisindedir. */
const ADMIN_ROLES = ['admin'] as const satisfies readonly RoleCode[]

/**
 * Kullanıcı listesi + rol atama uçları (HB-011). Rol ataması `users.version`
 * ile optimistic lock'lu; aktif oturum canlı JOIN ile çözüldüğü için (bkz.
 * `auth/store.ts` `findActiveSession`) değişiklik bir sonraki istekte hiç
 * yeniden giriş yapılmadan yansır.
 */
export function registerUserRoutes(app: FastifyInstance, options: UserRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createUsersStore(options.pool)

  app.get(USERS_ROUTE, async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ADMIN_ROLES)
    if (session === undefined) return
    const items = await store.list(session.user.organizationId)
    return usersResponseSchema.parse({ items })
  })

  app.patch(USER_ROLES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, ADMIN_ROLES)
    if (session === undefined) return
    const params = userParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    const body = userRolesUpdateRequestSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(body.error, requestId),
      }))
    }
    const outcome = await store.updateRoles(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      params.data.userId,
      body.data,
    )
    if (outcome.kind === 'not_found') {
      return reply.code(404).send(failureBody('not_found', 'User not found.', requestId))
    }
    if (outcome.kind === 'version_conflict') {
      return reply.code(409).send(failureBody('version_conflict', 'User was modified by another operation.', requestId))
    }
    if (outcome.kind === 'self_lockout') {
      return reply.code(409).send(failureBody(
        'user_self_lockout_blocked',
        'Removing your own admin role is not allowed.',
        requestId,
      ))
    }
    return userResponseSchema.parse({ user: outcome.user })
  })
}
