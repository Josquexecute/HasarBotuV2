import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUDIT_EVENTS_ROUTE,
  auditEventsQuerySchema,
  auditEventsResponseSchema,
  failureEnvelopeSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireSession, sendForbidden } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createAuditQueryStore } from './query-store.js'

export interface AuditRoutesOptions {
  readonly pool: pg.Pool
}

/** Audit sorgusuna erisebilen roller (hassas veri; yalniz yonetici). */
const AUDIT_READ_ROLES = new Set(['admin'])

/** Query string sayilarini contracts semasina hazirlar. */
function normalizeQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw }
  for (const key of ['page', 'pageSize']) {
    const value = normalized[key]
    if (typeof value === 'string' && /^\d+$/.test(value)) normalized[key] = Number(value)
  }
  return normalized
}

/**
 * Salt okunur audit sorgu ucu (Paket 11). Oturum zorunludur; yalniz yetkili
 * rol (yonetici) erisebilir; kapsam oturumdaki organizasyondur (kiracı
 * izolasyonu). Hicbir yazma/guncelleme/silme ucu YOKTUR (append-only).
 */
export function registerAuditRoutes(app: FastifyInstance, options: AuditRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const auditStore = createAuditQueryStore(options.pool)

  app.get(AUDIT_EVENTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    if (!session.user.roles.some((role) => AUDIT_READ_ROLES.has(role))) {
      sendForbidden(reply, requestId)
      return
    }

    const parsed = auditEventsQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    const result = await auditStore.list(session.user.organizationId, parsed.data)
    return auditEventsResponseSchema.parse({
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
