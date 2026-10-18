import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { toOfficeDate } from '@hasarbotu/domain'
import {
  OPERATIONAL_ALERTS_ROUTE,
  failureEnvelopeSchema,
  operationalAlertsQuerySchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import type { Clock } from '../clock.js'
import { createOperationalAlertStore } from './store.js'

export interface OperationalAlertRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
}

export function registerOperationalAlertRoutes(
  app: FastifyInstance,
  options: OperationalAlertRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createOperationalAlertStore(options.pool)

  // Backward-compatible derived list; personal read filtering is explicit.
  app.get(OPERATIONAL_ALERTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const raw = request.query as Record<string, unknown>
    // `caseIds` virgülle ayrılmış gelir; sözleşme biçim ve üst sınırı doğrular.
    // Erişim kararı bu kimliklere göre VERİLMEZ: store organization kapsamını
    // ayrıca uygular, bu yüzden yabancı kimlik yalnız boş sonuç üretir.
    const rawCaseIds = raw.caseIds
    const parsedQuery = operationalAlertsQuerySchema.safeParse({
      ...(rawCaseIds === undefined ? {} : { caseIds: String(rawCaseIds).split(',').map((value) => value.trim()).filter((value) => value !== '') }),
      ...(raw.includeTotal === undefined ? {} : { includeTotal: raw.includeTotal === 'true' ? true : raw.includeTotal === 'false' ? false : raw.includeTotal }),
      ...(raw.unreadOnly === undefined ? {} : { unreadOnly: raw.unreadOnly === 'true' ? true : raw.unreadOnly === 'false' ? false : raw.unreadOnly }),
    })
    if (!parsedQuery.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(parsedQuery.error, requestId),
      }))
    }
    const evaluatedAt = options.clock.nowUtcIso()
    const result = await store.list(
      session.user.organizationId,
      toOfficeDate(evaluatedAt),
      evaluatedAt,
      parsedQuery.data.caseIds,
      session.user.id,
      parsedQuery.data.unreadOnly === true ? 'unread' : 'all',
    )
    // Older installed clients reject totals over 200 at their contract boundary.
    return parsedQuery.data.includeTotal === true ? result : { ...result, totalCount: result.alerts.length }
  })
  app.post(`${OPERATIONAL_ALERTS_ROUTE}/read-all`, async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const parsed = operationalAlertsQuerySchema.pick({ caseIds: true }).safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) }))
    const evaluatedAt = options.clock.nowUtcIso()
    await store.markAllRead(session.user.organizationId, toOfficeDate(evaluatedAt), evaluatedAt, session.user.id, parsed.data.caseIds)
    return reply.code(204).send()
  })
}
