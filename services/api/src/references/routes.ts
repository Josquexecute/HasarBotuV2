import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  EXPERTS_REFERENCE_ROUTE,
  INSURERS_REFERENCE_ROUTE,
  SERVICES_REFERENCE_ROUTE,
  USERS_REFERENCE_ROUTE,
  failureEnvelopeSchema,
  servicesReferenceQuerySchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createReferenceStore } from './store.js'
import { failureBody } from '../errors/failure.js'

export function registerReferenceRoutes(app: FastifyInstance, options: { readonly pool: pg.Pool }): void {
  const authStore = createAuthStore(options.pool)
  const references = createReferenceStore(options.pool)
  const withSession = <Result>(loader: (organizationId: string) => Promise<Result>) =>
    async (request: Parameters<typeof requireSession>[1], reply: Parameters<typeof requireSession>[2]) => {
      const session = await requireSession(authStore, request, reply)
      if (session === undefined) return
      return loader(session.user.organizationId)
    }

  app.get(INSURERS_REFERENCE_ROUTE, withSession((organizationId) => references.insurers(organizationId)))
  app.get(SERVICES_REFERENCE_ROUTE, async (request, reply) => {
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const parsed = servicesReferenceQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(parsed.error, String(request.id)),
      }))
    }
    const result = await references.services(session.user.organizationId, parsed.data)
    if (result === undefined) return reply.code(404).send(failureBody('not_found', 'Insurer not found.', String(request.id)))
    return result
  })
  app.get(USERS_REFERENCE_ROUTE, withSession((organizationId) => references.users(organizationId)))
  app.get(EXPERTS_REFERENCE_ROUTE, withSession((organizationId) => references.experts(organizationId)))
}
