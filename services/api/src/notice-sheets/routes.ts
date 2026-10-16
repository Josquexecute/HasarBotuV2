import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { NOTICE_SHEET_ROUTE, noticeSheetParamsSchema, noticeSheetSaveRequestSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { hasPermission } from '../auth/permissions.js'
import { failureBody } from '../errors/failure.js'
import { createNoticeSheetStore, NoticeSheetError } from './store.js'

export function registerNoticeSheetRoutes(app: FastifyInstance, options: { pool: pg.Pool }): void {
  const auth = createAuthStore(options.pool)
  const store = createNoticeSheetStore(options.pool)
  for (const method of ['GET', 'PUT'] as const) {
    app.route({ method, url: NOTICE_SHEET_ROUTE, handler: async (request, reply) => {
      const session = await requireSession(auth, request, reply)
      if (!session) return
      const requestId = String(request.id)
      const params = noticeSheetParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(params.error, requestId) })
      const actor = { organizationId: session.user.organizationId, userId: session.user.id, requestId }
      try {
        if (method === 'GET') return await store.read(actor, params.data.caseId, hasPermission(session.user, 'case_write'))
        const body = noticeSheetSaveRequestSchema.safeParse(request.body)
        if (!body.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(body.error, requestId) })
        return await store.save(actor, params.data.caseId, body.data)
      } catch (error) {
        if (error instanceof NoticeSheetError) return reply.code(error.status).send(failureBody(error.code, 'Notice sheet request could not be completed.', requestId))
        throw error
      }
    } })
  }
}
