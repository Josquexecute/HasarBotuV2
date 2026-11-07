import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { CASE_FAULT_ROUTE, caseFaultParamsSchema, caseFaultSaveRequestSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { requireAnyRole } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hasPermission } from '../auth/permissions.js'
import { failureBody } from '../errors/failure.js'
import { CaseFaultError, createCaseFaultStore } from './store.js'

const WRITE_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting'] as const
const READ_ROLES = [...WRITE_ROLES, 'read_only'] as const

export function registerCaseFaultRoutes(app: FastifyInstance, options: { pool: pg.Pool }): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseFaultStore(options.pool)
  for (const method of ['GET', 'PUT'] as const) {
    app.route({ method, url: CASE_FAULT_ROUTE, handler: async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, method === 'GET' ? READ_ROLES : WRITE_ROLES)
      if (!session) return
      const requestId = String(request.id)
      const params = caseFaultParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(params.error, requestId) })
      try {
        if (method === 'GET') return await store.read(session.user.organizationId, params.data.caseId,
          session.user.roles.some(role => (WRITE_ROLES as readonly string[]).includes(role)) && hasPermission(session.user, 'case_write'))
        const body = caseFaultSaveRequestSchema.safeParse(request.body)
        if (!body.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(body.error, requestId) })
        return await store.save({ organizationId: session.user.organizationId, userId: session.user.id, requestId }, params.data.caseId, body.data)
      } catch (error) {
        if (error instanceof CaseFaultError) return reply.code(error.status).send(failureBody(error.code, 'Fault allocation could not be saved or loaded.', requestId))
        throw error
      }
    } })
  }
}
