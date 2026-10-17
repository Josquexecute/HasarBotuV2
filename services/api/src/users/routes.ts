import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import {
  USERS_ROUTE,
  USER_ROLES_ROUTE,
  failureEnvelopeSchema,
  userParamsSchema,
  userCreateRequestSchema,
  userResponseSchema,
  usersResponseSchema,
  userRolesUpdateRequestSchema,
  zodErrorToApiError,
  type RoleCode,
  adminProfileUpdateSchema,
} from '@hasarbotu/contracts'
import { requireAnyRole } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { failureBody } from '../errors/failure.js'
import { createUsersStore } from './store.js'
import { updateAccountProfile } from './profile.js'

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
    const query = z.object({ includePending: z.enum(['true','false']).default('false') }).strict().safeParse(request.query)
    if (!query.success) return reply.code(400).send(failureBody('validation_error','Geçersiz kullanıcı sorgusu.',String(request.id)))
    const items = await store.list(session.user.organizationId,query.data.includePending === 'true')
    return usersResponseSchema.parse({ items })
  })

  app.post(USERS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, ADMIN_ROLES)
    if (session === undefined) return
    const body = userCreateRequestSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(body.error, requestId),
      }))
    }
    const outcome = await store.create(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      body.data,
    )
    if (outcome.kind === 'email_in_use') {
      return reply.code(409).send(failureBody('user_email_in_use', 'This email is already registered.', requestId))
    }
    return reply.code(201).send(userResponseSchema.parse({ user: outcome.user }))
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

  app.patch('/api/v1/users/:userId/profile', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ADMIN_ROLES)
    if (!session) return
    const requestId = String(request.id), params = userParamsSchema.safeParse(request.params), body = adminProfileUpdateSchema.safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const outcome = await updateAccountProfile(options.pool, { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId }, params.data.userId, body.data)
    if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Kullanıcı bulunamadı.', requestId))
    if (outcome.kind === 'conflict') return reply.code(409).send(failureBody('version_conflict', 'Kullanıcı bilgileri değişti. Listeyi yenileyin.', requestId))
    return outcome.profile
  })
}
