import type { FastifyInstance,FastifyRequest } from 'fastify'
import type pg from 'pg'
import { createAuditService } from './service.js'

const actors = new WeakMap<FastifyRequest,{ id: string;organizationId: string;startedAt: Date }>()
export function rememberAuthenticatedRequest(request: FastifyRequest,user: { id: string;organizationId: string }) {
  if (!actors.has(request)) actors.set(request,{ id: user.id,organizationId: user.organizationId,startedAt: new Date() })
}
/** Domain mutations retain their atomic audit. This records otherwise unaudited actions and denied attempts. */
export function registerRequestAudit(app: FastifyInstance,pool: pg.Pool) {
  const audit = createAuditService()
  app.addHook('onResponse',async (request,reply) => {
    const actor = actors.get(request),route = request.routeOptions.url ?? ''
    if (!actor || /\/auth\//.test(route)) return
    const view = request.method === 'GET' && (/^\/api\/v1\/cases\/:caseId$/.test(route) || /\/download$|\/export$/.test(route))
    if (!view && ['GET','HEAD','OPTIONS'].includes(request.method) && reply.statusCode < 400) return
    try {
      const existing = await pool.query('SELECT 1 FROM audit_events WHERE actor_user_id=$1 AND request_id=$2 AND occurred_at>=$3 LIMIT 1',[actor.id,String(request.id),actor.startedAt])
      if (existing.rowCount) return
      const caseId = (request.params as { caseId?: unknown } | undefined)?.caseId
      await audit.record(pool,{ organizationId: actor.organizationId,actorUserId: actor.id,requestId: String(request.id),
        action: reply.statusCode >= 500 ? 'request.failed' : reply.statusCode >= 400 ? 'request.rejected' : view ? 'access.viewed' : 'request.completed',
        ...(typeof caseId === 'string' && /^[a-f0-9-]{36}$/i.test(caseId) ? { entityType: 'case',entityId: caseId } : {}),
        details: { method: request.method,route,statusCode: reply.statusCode } })
    } catch (error) {
      app.log.error({ err: error,requestId: String(request.id),category: 'request_audit_failed' },'Request audit could not be persisted')
    }
  })
}
