import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_LABOR_WORKBOOK_APPLIES_ROUTE,
  CASE_LABOR_WORKBOOK_APPLY_APPROVE_ROUTE,
  CASE_LABOR_WORKBOOK_APPLY_PREVIEW_ROUTE,
  CASE_LABOR_WORKBOOK_APPLY_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  laborWorkbookApplyApproveRequestSchema,
  laborWorkbookApplyCaseParamsSchema,
  laborWorkbookApplyParamsSchema,
  laborWorkbookApplyPreviewRequestSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import {
  createLaborWorkbookApplyStore,
  LaborWorkbookApplyError,
} from './store.js'

const READ_ROLES = [
  'admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only',
] as const
const APPROVE_ROLES = ['admin', 'expert', 'case_manager'] as const

const FAILURE_CODES = {
  CASE_NOT_FOUND: 'not_found',
  CASE_CLOSED: 'conflict',
  LOCATION_NOT_VERIFIED: 'conflict',
  APPLICATION_NOT_FOUND: 'not_found',
  REVISION_STALE: 'version_conflict',
  PROFILE_NOT_WRITABLE: 'conflict',
  PROFILE_MISMATCH: 'conflict',
  IDENTITY_CELL_REQUIRED: 'conflict',
  CONTROL_REQUIRED: 'conflict',
  OPERATION_NOT_FOUND: 'not_found',
  OPERATION_NOT_APPROVABLE: 'conflict',
  PLAN_STALE: 'version_conflict',
  IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  VERSION_CONFLICT: 'version_conflict',
} as const

function handle(reply: FastifyReply, requestId: string, error: unknown) {
  if (error instanceof LaborWorkbookApplyError) {
    return reply.code(error.status).send(failureBody(
      FAILURE_CODES[error.code],
      'Labor workbook request could not be completed.',
      requestId,
    ))
  }
  throw error
}

function canApprove(roles: readonly string[]): boolean {
  return roles.some((role) => (APPROVE_ROLES as readonly string[]).includes(role))
}

export function registerLaborWorkbookApplyRoutes(
  app: FastifyInstance,
  options: { readonly pool: pg.Pool },
): void {
  const auth = createAuthStore(options.pool)
  const store = createLaborWorkbookApplyStore(options.pool)

  app.post(CASE_LABOR_WORKBOOK_APPLY_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborWorkbookApplyCaseParamsSchema.safeParse(request.params)
    const body = laborWorkbookApplyPreviewRequestSchema.safeParse(request.body)
    const key = idempotencyKeySchema.safeParse(
      request.headers[IDEMPOTENCY_KEY_HEADER],
    )
    if (!params.success || !body.success || !key.success) {
      const error = !params.success ? params.error
        : (!body.success ? body.error : key.error)
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      const result = await store.preview(
        {
          organizationId: session.user.organizationId,
          userId: session.user.id,
          requestId,
        },
        params.data.caseId,
        body.data,
        key.data,
      )
      return reply.code(202).send(result)
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.post(CASE_LABOR_WORKBOOK_APPLY_APPROVE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, APPROVE_ROLES)
    if (session === undefined) return
    const params = laborWorkbookApplyParamsSchema.safeParse(request.params)
    const body = laborWorkbookApplyApproveRequestSchema.safeParse(request.body)
    const key = idempotencyKeySchema.safeParse(
      request.headers[IDEMPOTENCY_KEY_HEADER],
    )
    if (!params.success || !body.success || !key.success) {
      const error = !params.success ? params.error
        : (!body.success ? body.error : key.error)
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      const result = await store.approve(
        {
          organizationId: session.user.organizationId,
          userId: session.user.id,
          requestId,
        },
        params.data.caseId,
        params.data.operationId,
        body.data,
        key.data,
      )
      return reply.code(202).send(result)
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.get(CASE_LABOR_WORKBOOK_APPLY_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborWorkbookApplyParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    try {
      return await store.get(
        session.user.organizationId,
        params.data.caseId,
        params.data.operationId,
        canApprove(session.user.roles),
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.get(CASE_LABOR_WORKBOOK_APPLIES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborWorkbookApplyCaseParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    return store.list(
      session.user.organizationId,
      params.data.caseId,
      canApprove(session.user.roles),
    )
  })
}

