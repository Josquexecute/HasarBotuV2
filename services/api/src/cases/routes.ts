import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  CASES_ROUTE,
  CASE_DETAIL_ROUTE,
  caseDetailParamsSchema,
  caseDetailQuerySchema,
  caseDetailResponseSchema,
  caseDetailWithLegacyReferencesResponseSchema,
  caseListResponseSchema,
  casesQuerySchema,
  failureEnvelopeSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createCasesStore } from './store.js'
import { withEksistData } from '../eksist/automatic.js'

export interface CasesRoutesOptions {
  readonly pool: pg.Pool
}

/** Query string degerlerini contracts semasina hazirlar (sayilar acikca parse edilir). */
function normalizeQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw }
  for (const key of ['page', 'pageSize']) {
    const value = normalized[key]
    if (typeof value === 'string' && /^\d+$/.test(value)) normalized[key] = Number(value)
  }
  return normalized
}

/**
 * Salt okunur Cases uclari (Paket 07). Oturum zorunludur; tenant kapsami
 * oturumdaki organizasyondur. Hicbir yazma islemi yapilmaz.
 */
export function registerCasesRoutes(app: FastifyInstance, options: CasesRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const casesStore = createCasesStore(options.pool)

  app.get(CASES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const parsed = casesQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    const result = await casesStore.list(session.user.organizationId, parsed.data)
    return caseListResponseSchema.parse({
      items: parsed.data.includeEksist === 'true' ? await withEksistData(options.pool, session.user.organizationId, result.items) : result.items,
      pageInfo: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / parsed.data.pageSize),
      },
    })
  })

  app.get(CASE_DETAIL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const parsed = caseDetailParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    const parsedQuery = caseDetailQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsedQuery.error, requestId) }),
      )
    }

    let detail = await casesStore.findById(session.user.organizationId, parsed.data.caseId)
    if (detail === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    if (parsedQuery.data.includeEksist === 'true') detail = (await withEksistData(options.pool, session.user.organizationId, [detail]))[0]!
    if (parsedQuery.data.includeLegacyReferences === 'true') {
      const legacyReferences = await casesStore.findLegacyReferences(session.user.organizationId, parsed.data.caseId)
      return caseDetailWithLegacyReferencesResponseSchema.parse({ case: { ...detail, legacyReferences } })
    }
    return caseDetailResponseSchema.parse({ case: detail })
  })
}
