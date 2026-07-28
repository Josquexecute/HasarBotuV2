import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_LOCATION_HISTORY_ROUTE,
  CASE_LOCATION_ROUTE,
  STORAGE_ROOTS_ROUTE,
  caseLocationAssignRequestSchema,
  caseLocationHistoryQuerySchema,
  caseLocationHistoryResponseSchema,
  caseLocationParamsSchema,
  caseLocationResponseSchema,
  failureEnvelopeSchema,
  storageRootsResponseSchema,
  zodErrorToApiError,
  type ApiErrorCode,
  type RoleCode,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createStorageStore } from './store.js'

export interface StorageRoutesOptions {
  readonly pool: pg.Pool
}

/** HB-011: konum atama fiziksel taşımanın ön koşuludur; aynı "kritik işlem" sınırı. */
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const satisfies readonly RoleCode[]

function sendUnknownRoot(reply: FastifyReply, requestId: string): void {
  void reply.code(400).send(
    failureEnvelopeSchema.parse({
      ok: false,
      error: {
        code: 'validation_error' satisfies ApiErrorCode,
        message: 'Request validation failed.',
        fieldErrors: [{ path: 'storageRootKey', code: 'unknown_reference', message: 'Field value is not allowed.' }],
        requestId,
      },
    }),
  )
}

function normalizeQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw }
  for (const key of ['page', 'pageSize']) {
    const value = normalized[key]
    if (typeof value === 'string' && /^\d+$/.test(value)) normalized[key] = Number(value)
  }
  return normalized
}

/**
 * Depolama kökleri + vaka konum uçları (Paket 12). Oturum zorunludur; kapsam
 * oturumdaki organizasyondur (kiracı izolasyonu). Konum yalniz mantiksal
 * rootKey + güvenli göreli yol taşır; mutlak yol yanıta/audit'e/loga girmez.
 * Fiziksel klasör oluşturma/taşıma YOKTUR (File Agent kapsamı).
 */
export function registerStorageRoutes(app: FastifyInstance, options: StorageRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const storageStore = createStorageStore(options.pool)

  app.get(STORAGE_ROOTS_ROUTE, async (request, reply) => {
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const items = await storageStore.listRoots(session.user.organizationId)
    return storageRootsResponseSchema.parse({ items })
  })

  app.get(CASE_LOCATION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const params = caseLocationParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }),
      )
    }

    const location = await storageStore.findCurrentLocation(session.user.organizationId, params.data.caseId)
    if (location === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case location not found.', requestId))
    }
    return caseLocationResponseSchema.parse({ location })
  })

  app.put(CASE_LOCATION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return

    const params = caseLocationParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }),
      )
    }
    const parsed = caseLocationAssignRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    const outcome = await storageStore.assignLocation(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      params.data.caseId,
      parsed.data,
    )
    if (outcome.kind === 'not_found') {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    if (outcome.kind === 'unknown_reference') {
      sendUnknownRoot(reply, requestId)
      return
    }
    if (outcome.kind === 'version_conflict') {
      return reply
        .code(409)
        .send(failureBody('version_conflict', 'Case location was modified by another operation.', requestId))
    }
    return caseLocationResponseSchema.parse({ location: outcome.location })
  })

  app.get(CASE_LOCATION_HISTORY_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const params = caseLocationParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }),
      )
    }
    const query = caseLocationHistoryQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!query.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(query.error, requestId) }),
      )
    }

    const result = await storageStore.listHistory(session.user.organizationId, params.data.caseId, query.data)
    return caseLocationHistoryResponseSchema.parse({
      items: result.items,
      pageInfo: {
        page: query.data.page,
        pageSize: query.data.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / query.data.pageSize),
      },
    })
  })
}
