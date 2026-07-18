import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  LABOR_DICTIONARY_ROUTE,
  failureEnvelopeSchema,
  laborDictionaryQuerySchema,
  laborDictionaryResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { createLaborDictionaryStore } from './store.js'

export interface LaborDictionaryRoutesOptions {
  readonly pool: pg.Pool
}

export function registerLaborDictionaryRoutes(
  app: FastifyInstance,
  options: LaborDictionaryRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createLaborDictionaryStore(options.pool)

  app.get(LABOR_DICTIONARY_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const raw = request.query as Record<string, unknown>
    const parsedQuery = laborDictionaryQuerySchema.safeParse({
      ...(raw.query === undefined ? {} : { query: raw.query }),
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    })
    if (!parsedQuery.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(parsedQuery.error, requestId),
      }))
    }
    const response = await store.list(session.user.organizationId, parsedQuery.data)
    return laborDictionaryResponseSchema.parse(response)
  })
}
