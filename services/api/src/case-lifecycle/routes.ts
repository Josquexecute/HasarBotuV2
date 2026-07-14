import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  CASE_CLOSE_APPROVE_ROUTE,
  CASE_CLOSE_PLAN_ROUTE,
  CASE_LIFECYCLE_CANCEL_ROUTE,
  CASE_LIFECYCLE_OPERATION_ROUTE,
  CASE_LIFECYCLE_OPERATIONS_ROUTE,
  CASE_REOPEN_APPROVE_ROUTE,
  CASE_REOPEN_PLAN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseLifecycleOperationResponseSchema,
  caseLifecycleOperationsResponseSchema,
  closePlanRequestSchema,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  lifecycleApproveRequestSchema,
  lifecycleCancelRequestSchema,
  lifecycleCaseParamsSchema,
  lifecycleOperationParamsSchema,
  reopenPlanRequestSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody, isIdempotencyRace } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import {
  LIFECYCLE_APPROVE_SCOPE,
  LIFECYCLE_CANCEL_SCOPE,
  LIFECYCLE_CLOSE_PLAN_SCOPE,
  LIFECYCLE_REOPEN_PLAN_SCOPE,
  createCaseLifecycleStore,
} from './store.js'

export interface CaseLifecycleRoutesOptions { readonly pool: pg.Pool }
const COMMAND_ROLES = ['admin', 'expert', 'case_manager'] as const

function parseKey(request: { headers: Record<string, unknown> }): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER]
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw)
  return parsed.success ? parsed.data : undefined
}

function sendKeyRequired(reply: FastifyReply, requestId: string): void {
  void reply.code(400).send(failureEnvelopeSchema.parse({
    ok: false,
    error: { code: 'validation_error', message: 'Request validation failed.',
      fieldErrors: [{ path: IDEMPOTENCY_KEY_HEADER, code: 'idempotency_key_required', message: 'Field value is not allowed.' }], requestId },
  }))
}

function lifecycleRace(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string }
  return isIdempotencyRace(error) || (pgError.code === '23505' && pgError.constraint === 'case_lifecycle_operations_idempotency_unique')
}

function safeConflict(error: unknown): boolean {
  if (error instanceof Error && [
    'lifecycle_file_operation_conflict',
    'lifecycle_destination_conflict',
    'lifecycle_destination_root_inactive',
  ].includes(error.message)) return true
  const pgError = error as { code?: string; constraint?: string }
  return pgError.code === '23505' && [
    'case_lifecycle_operations_one_active_case',
    'case_lifecycle_operations_destination_reservation',
    'case_file_operations_one_active_case',
    'case_file_operations_destination_reservation',
  ].includes(pgError.constraint ?? '')
}

export function registerCaseLifecycleRoutes(app: FastifyInstance, options: CaseLifecycleRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseLifecycleStore(options.pool)

  async function plan(request: FastifyRequest, reply: FastifyReply, kind: 'close' | 'reopen') {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, COMMAND_ROLES)
    if (session === undefined) return
    const params = lifecycleCaseParamsSchema.safeParse(request.params)
    const body = (kind === 'close' ? closePlanRequestSchema : reopenPlanRequestSchema).safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const key = parseKey(request as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const scope = kind === 'close' ? LIFECYCLE_CLOSE_PLAN_SCOPE : LIFECYCLE_REOPEN_PLAN_SCOPE
    const requestHash = hashRequestBody({ kind, caseId: params.data.caseId, ...body.data })
    const replay = await store.findIdempotent(session.user.organizationId, scope, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const actor = { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId }
      const idem = { key, requestHash, scope }
      const outcome = kind === 'close'
        ? await store.planClose(actor, params.data.caseId, body.data as never, idem)
        : await store.planReopen(actor, params.data.caseId, body.data as never, idem)
      if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      if (outcome.kind === 'version_conflict') return reply.code(409).send(failureBody('version_conflict', 'Case or location version changed.', requestId))
      if (outcome.kind === 'lifecycle_conflict') return reply.code(409).send(failureBody('lifecycle_conflict', 'Case lifecycle does not permit this operation.', requestId))
      if (outcome.kind === 'destination_conflict') return reply.code(409).send(failureBody('destination_conflict', 'Destination is already reserved or in use.', requestId))
      if (outcome.kind === 'manual_recovery_required') return reply.code(409).send(failureBody('manual_recovery_required', 'A file operation requires manual recovery.', requestId))
      if (outcome.kind === 'active_file_operation') return reply.code(409).send(failureBody('lifecycle_conflict', 'Case has an active physical operation.', requestId))
      if (outcome.kind === 'location_required' || outcome.kind === 'location_not_verified' || outcome.kind === 'invalid_location') {
        return reply.code(409).send(failureBody('lifecycle_stale', 'A verified and date-consistent case workspace is required.', requestId))
      }
      if (outcome.kind !== 'ok') return reply.code(409).send(failureBody('lifecycle_conflict', 'Lifecycle operation cannot be planned.', requestId))
      return reply.code(201).send(caseLifecycleOperationResponseSchema.parse({ operation: outcome.operation }))
    } catch (error) {
      if (lifecycleRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, scope, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      if (safeConflict(error)) return reply.code(409).send(failureBody('lifecycle_conflict', 'Case has a conflicting active operation.', requestId))
      throw error
    }
  }

  app.post(CASE_CLOSE_PLAN_ROUTE, async (request, reply) => plan(request, reply, 'close'))
  app.post(CASE_REOPEN_PLAN_ROUTE, async (request, reply) => plan(request, reply, 'reopen'))

  app.get(CASE_LIFECYCLE_OPERATIONS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = lifecycleCaseParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    const items = await store.list(session.user.organizationId, params.data.caseId)
    if (items === undefined) return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    return caseLifecycleOperationsResponseSchema.parse({ items })
  })

  app.get(CASE_LIFECYCLE_OPERATION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = lifecycleOperationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    const operation = await store.find(session.user.organizationId, params.data.caseId, params.data.operationId)
    if (operation === undefined) return reply.code(404).send(failureBody('not_found', 'Lifecycle operation not found.', requestId))
    return caseLifecycleOperationResponseSchema.parse({ operation })
  })

  async function command(request: FastifyRequest, reply: FastifyReply, kind: 'approve' | 'cancel', expectedOperationType?: 'close' | 'reopen') {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, COMMAND_ROLES)
    if (session === undefined) return
    const params = lifecycleOperationParamsSchema.safeParse(request.params)
    const body = (kind === 'approve' ? lifecycleApproveRequestSchema : lifecycleCancelRequestSchema).safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const key = parseKey(request as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const scope = kind === 'approve' ? LIFECYCLE_APPROVE_SCOPE : LIFECYCLE_CANCEL_SCOPE
    const requestHash = hashRequestBody({ kind, caseId: params.data.caseId, operationId: params.data.operationId, ...body.data })
    const replay = await store.findIdempotent(session.user.organizationId, scope, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const actor = { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId }
      const idem = { key, requestHash, scope }
      const outcome = kind === 'approve'
        ? await store.approve(actor, params.data.caseId, params.data.operationId, expectedOperationType ?? 'close', body.data as never, idem)
        : await store.cancel(actor, params.data.caseId, params.data.operationId, body.data as never, idem)
      if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Lifecycle operation not found.', requestId))
      if (outcome.kind === 'version_conflict') return reply.code(409).send(failureBody('version_conflict', 'Lifecycle operation version changed.', requestId))
      if (outcome.kind === 'stale') return reply.code(409).send(failureBody('lifecycle_stale', 'Lifecycle operation snapshot is stale.', requestId))
      if (outcome.kind === 'destination_conflict') return reply.code(409).send(failureBody('destination_conflict', 'Destination is already in use.', requestId))
      if (outcome.kind === 'conflict') return reply.code(409).send(failureBody('lifecycle_conflict', 'Lifecycle operation cannot be changed in its current state.', requestId))
      if (outcome.kind !== 'ok') return reply.code(409).send(failureBody('lifecycle_conflict', 'Lifecycle operation cannot be changed.', requestId))
      return reply.code(kind === 'approve' ? 202 : 200).send(caseLifecycleOperationResponseSchema.parse({ operation: outcome.operation }))
    } catch (error) {
      if (lifecycleRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, scope, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      if (safeConflict(error)) return reply.code(409).send(failureBody('lifecycle_conflict', 'Case has a conflicting active operation.', requestId))
      throw error
    }
  }

  app.post(CASE_CLOSE_APPROVE_ROUTE, async (request, reply) => command(request, reply, 'approve', 'close'))
  app.post(CASE_REOPEN_APPROVE_ROUTE, async (request, reply) => command(request, reply, 'approve', 'reopen'))
  app.post(CASE_LIFECYCLE_CANCEL_ROUTE, async (request, reply) => command(request, reply, 'cancel'))
}
