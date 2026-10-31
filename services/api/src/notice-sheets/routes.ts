import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { NOTICE_SHEET_ROUTE, noticeSheetParamsSchema, noticeSheetSaveRequestSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { hasPermission } from '../auth/permissions.js'
import { failureBody } from '../errors/failure.js'
import { createNoticeSheetStore, NoticeSheetError } from './store.js'
import { NOTICE_SHEET_HEADER_LIMITS, NOTICE_SHEET_V3_FIELDS } from '@hasarbotu/domain'
import type { NoticeSheetResponse } from '@hasarbotu/contracts'

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
      const generation = request.headers['x-hasarbotu-notice-sheet-fields']
      const extended = generation === '2' || generation === '3'
      const visible = (key: string) => (extended || !Object.hasOwn(NOTICE_SHEET_HEADER_LIMITS, key))
        && (generation === '3' || !NOTICE_SHEET_V3_FIELDS.some(field => field === key))
      reply.header('Vary','x-hasarbotu-notice-sheet-fields')
      const response = (sheet: NoticeSheetResponse) => ({
        ...sheet,
        defaults: { ...sheet.defaults,fields: Object.fromEntries(Object.entries(sheet.defaults.fields).filter(([key]) => visible(key))) },
        overrides: { ...sheet.overrides,fields: Object.fromEntries(Object.entries(sheet.overrides.fields).filter(([key]) => visible(key))) },
      })
      try {
        if (method === 'GET') return response(await store.read(actor, params.data.caseId, hasPermission(session.user, 'case_write')))
        const body = noticeSheetSaveRequestSchema.safeParse(request.body)
        if (!body.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(body.error, requestId) })
        return response(await store.save(actor, params.data.caseId, body.data, extended, generation === '3'))
      } catch (error) {
        if (error instanceof NoticeSheetError) return reply.code(error.status).send(failureBody(error.code, 'Notice sheet request could not be completed.', requestId))
        throw error
      }
    } })
  }
}
