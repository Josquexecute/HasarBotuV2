import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
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
  // Legacy case contacts stay filterable without rewriting production assignments.
  app.get('/api/v1/references/service-contact-names', withSession(async organizationId => {
    const result = await options.pool.query(`SELECT DISTINCT sc.name FROM case_service_contacts sc JOIN cases c
      ON c.organization_id=sc.organization_id AND c.id=sc.case_id WHERE c.organization_id=$1 AND NOT c.is_archived
      AND c.service_center_id IS NULL AND sc.service_center_id IS NULL ORDER BY sc.name`, [organizationId])
    return { items: result.rows }
  }))
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
  app.get(USERS_REFERENCE_ROUTE,async (request,reply) => {
    const session = await requireSession(authStore,request,reply)
    if (!session) return
    const query = z.object({ includeRoles: z.enum(['true','false']).default('false') }).strict().safeParse(request.query)
    if (!query.success) return reply.code(400).send(failureBody('validation_error','Geçersiz referans sorgusu.',String(request.id)))
    return references.users(session.user.organizationId,query.data.includeRoles === 'true')
  })
  app.get(EXPERTS_REFERENCE_ROUTE, withSession((organizationId) => references.experts(organizationId)))
}
