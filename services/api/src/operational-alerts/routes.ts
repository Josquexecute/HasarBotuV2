import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
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

  // Salt okunur türetilmiş uç; durum değiştirmez ve audit kaydı yazmaz.
  app.get(OPERATIONAL_ALERTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const raw = request.query as Record<string, unknown>
    // `caseIds` virgülle ayrılmış gelir; sözleşme biçim ve üst sınırı doğrular.
    // Erişim kararı bu kimliklere göre VERİLMEZ: store organization kapsamını
    // ayrıca uygular, bu yüzden yabancı kimlik yalnız boş sonuç üretir.
    const rawCaseIds = raw.caseIds
    const parsedQuery = operationalAlertsQuerySchema.safeParse(
      rawCaseIds === undefined
        ? {}
        : { caseIds: String(rawCaseIds).split(',').map((value) => value.trim()).filter((value) => value !== '') },
    )
    if (!parsedQuery.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(parsedQuery.error, requestId),
      }))
    }
    const evaluatedAt = options.clock.nowUtcIso()
    return store.list(
      session.user.organizationId,
      evaluatedAt.slice(0, 10),
      evaluatedAt,
      parsedQuery.data.caseIds,
    )
  })
}
