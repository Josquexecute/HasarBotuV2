import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { DASHBOARD_ROUTE, DASHBOARD_STAGE_SET_HEADER, DASHBOARD_STAGE_SET_VERSION } from '@hasarbotu/contracts'
import { toOfficeDate } from '@hasarbotu/domain'
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
    const asOfDate = toOfficeDate(evaluatedAt)
    const result = await dashboard.read(session.user.organizationId, asOfDate, evaluatedAt)
    reply.header('Vary', DASHBOARD_STAGE_SET_HEADER)
    if (request.headers[DASHBOARD_STAGE_SET_HEADER] === DASHBOARD_STAGE_SET_VERSION) return result
    // Installed six-stage clients reject additional counters and unknown item stages.
    const readyCount = result.stageCounts.find(item => item.stage === 'ready_to_close')?.count ?? 0
    return {
      ...result,
      stageCounts: result.stageCounts.filter(item => item.stage !== 'ready_to_close').map(item =>
        item.stage === 'under_repair' ? { ...item, count: item.count + readyCount } : item),
      items: result.items.map(item => item.stage === 'ready_to_close' ? { ...item, stage: 'under_repair' } : item),
    }
  })
}
