import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  V1_IMPORT_QUARANTINES_ROUTE,
  failureEnvelopeSchema,
  v1ImportQuarantinesQuerySchema,
  v1ImportQuarantinesResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireSession, sendForbidden } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createV1ImportQuarantineStore } from './store.js'

function normalizeQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...raw }
  for (const key of ['page', 'pageSize']) {
    const value = normalized[key]
    if (typeof value === 'string' && /^\d+$/.test(value)) normalized[key] = Number(value)
  }
  return normalized
}

export function registerV1ImportQuarantineRoutes(app: FastifyInstance, options: { readonly pool: pg.Pool }): void {
  const authStore = createAuthStore(options.pool)
  const store = createV1ImportQuarantineStore(options.pool)

  app.get(V1_IMPORT_QUARANTINES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    if (!session.user.roles.includes('admin')) {
      sendForbidden(reply, requestId)
      return
    }
    const parsed = v1ImportQuarantinesQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }
    const result = await store.list(session.user.organizationId, parsed.data)
    return v1ImportQuarantinesResponseSchema.parse({
      items: result.items,
      pageInfo: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / parsed.data.pageSize),
      },
    })
  })
}
