import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { DASHBOARD_ROUTE } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import type { Clock } from '../clock.js'
import { createDashboardStore } from './store.js'

export interface DashboardRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  options: DashboardRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const dashboard = createDashboardStore(options.pool)

  app.get(DASHBOARD_ROUTE, async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const evaluatedAt = options.clock.nowUtcIso()
    const asOfDate = evaluatedAt.slice(0, 10)
    return dashboard.read(session.user.organizationId, asOfDate, evaluatedAt)
  })
}
