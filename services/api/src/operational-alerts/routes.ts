import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { OPERATIONAL_ALERTS_ROUTE } from '@hasarbotu/contracts'
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
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const evaluatedAt = options.clock.nowUtcIso()
    return store.list(session.user.organizationId, evaluatedAt.slice(0, 10), evaluatedAt)
  })
}
