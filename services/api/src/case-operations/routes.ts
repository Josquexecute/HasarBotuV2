import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_NOTES_ROUTE,
  CASE_OPERATIONS_ROUTE,
  CASE_TASK_CANCEL_ROUTE,
  CASE_TASK_COMPLETE_ROUTE,
  CASE_TASKS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseNoteCreateRequestSchema,
  caseNoteResponseSchema,
  caseOperationsParamsSchema,
  caseTaskCancelRequestSchema,
  caseTaskCompleteRequestSchema,
  caseTaskCreateRequestSchema,
  caseTaskParamsSchema,
  caseTaskResponseSchema,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  zodErrorToApiError,
  type ApiErrorCode,
  type RoleCode,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import type { Clock } from '../clock.js'
import { hashRequestBody } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import {
  CaseOperationReferenceError,
  createCaseOperationsStore,
  type CaseOperationCommandOutcome,
} from './store.js'

export interface CaseOperationsRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
}

const WRITE_ROLES = ['admin', 'expert', 'case_manager', 'secretary'] as const satisfies readonly RoleCode[]
const NOTE_SCOPE = 'case_notes.create'
const TASK_SCOPE = 'case_tasks.create'
const TASK_COMPLETE_SCOPE = 'case_tasks.complete'
const TASK_CANCEL_SCOPE = 'case_tasks.cancel'

function canWrite(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number]))
}

function sendValidation(
  reply: FastifyReply,
  requestId: string,
  path: string,
  code: string,
): void {
  void reply.code(400).send(failureEnvelopeSchema.parse({
    ok: false,
    error: {
      code: 'validation_error' satisfies ApiErrorCode,
      message: 'Request validation failed.',
      fieldErrors: [{ path, code, message: 'Field value is not allowed.' }],
      requestId,
    },
  }))
}

function readIdempotencyKey(
  reply: FastifyReply,
  requestId: string,
  header: string | string[] | undefined,
): string | undefined {
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(header) ? header[0] : header)
  if (!parsed.success) {
    sendValidation(reply, requestId, IDEMPOTENCY_KEY_HEADER, 'idempotency_key_required')
    return undefined
  }
  return parsed.data
}

function sendOutcomeError(
  reply: FastifyReply,
  requestId: string,
  outcome: Exclude<CaseOperationCommandOutcome<unknown>, { kind: 'ok' | 'idempotency_race' }>,
): FastifyReply {
  if (outcome.kind === 'not_found') {
    return reply.code(404).send(failureBody('not_found', 'Case operation resource not found.', requestId))
  }
  if (outcome.kind === 'version_conflict') {
    return reply.code(409).send(failureBody('version_conflict', 'Task was modified by another operation.', requestId))
  }
  return reply.code(409).send(failureBody(
    'conflict',
    outcome.kind === 'case_closed' ? 'Closed cases cannot be modified.' : 'Task state does not allow this operation.',
    requestId,
  ))
}

export function registerCaseOperationsRoutes(
  app: FastifyInstance,
  options: CaseOperationsRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseOperationsStore(options.pool)

  app.get(CASE_OPERATIONS_ROUTE, async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = caseOperationsParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, String(request.id)),
      }))
    }
    const now = options.clock.nowUtcIso()
    const result = await store.read(
      session.user.organizationId,
      params.data.caseId,
      now.slice(0, 10),
      canWrite(session.user.roles),
    )
    if (result === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', String(request.id)))
    }
    return result
  })

  app.post(CASE_NOTES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = caseOperationsParamsSchema.safeParse(request.params)
    const body = caseNoteCreateRequestSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(body.error, requestId),
      }))
    }
    const key = readIdempotencyKey(reply, requestId, request.headers[IDEMPOTENCY_KEY_HEADER])
    if (key === undefined) return
    const requestHash = hashRequestBody({ caseId: params.data.caseId, body: body.data })
    const replay = await store.findIdempotent(session.user.organizationId, NOTE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.createNote({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, body.data, { scope: NOTE_SCOPE, key, requestHash })
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, NOTE_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return reply.code(201).send(caseNoteResponseSchema.parse({ note: outcome.item }))
  })

  app.post(CASE_TASKS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = caseOperationsParamsSchema.safeParse(request.params)
    const body = caseTaskCreateRequestSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(body.error, requestId),
      }))
    }
    const key = readIdempotencyKey(reply, requestId, request.headers[IDEMPOTENCY_KEY_HEADER])
    if (key === undefined) return
    const requestHash = hashRequestBody({ caseId: params.data.caseId, body: body.data })
    const replay = await store.findIdempotent(session.user.organizationId, TASK_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const now = options.clock.nowUtcIso()
      const outcome = await store.createTask({
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        requestId,
      }, params.data.caseId, body.data, { scope: TASK_SCOPE, key, requestHash }, now.slice(0, 10))
      if (outcome.kind === 'idempotency_race') {
        const raced = await store.findIdempotent(session.user.organizationId, TASK_SCOPE, key)
        if (raced !== undefined && raced.requestHash === requestHash) {
          return reply.code(raced.responseStatus).send(raced.responseBody)
        }
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
      return reply.code(201).send(caseTaskResponseSchema.parse({ task: outcome.item }))
    } catch (error) {
      if (error instanceof CaseOperationReferenceError) {
        sendValidation(reply, requestId, error.field, error.code)
        return
      }
      throw error
    }
  })

  const registerTransition = (
    route: typeof CASE_TASK_COMPLETE_ROUTE | typeof CASE_TASK_CANCEL_ROUTE,
    status: 'completed' | 'cancelled',
  ) => {
    app.post(route, async (request, reply) => {
      const requestId = String(request.id)
      const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
      if (session === undefined) return
      const params = caseTaskParamsSchema.safeParse(request.params)
      const schema = status === 'completed' ? caseTaskCompleteRequestSchema : caseTaskCancelRequestSchema
      const body = schema.safeParse(request.body)
      if (!params.success) {
        return reply.code(400).send(failureEnvelopeSchema.parse({
          ok: false,
          error: zodErrorToApiError(params.error, requestId),
        }))
      }
      if (!body.success) {
        return reply.code(400).send(failureEnvelopeSchema.parse({
          ok: false,
          error: zodErrorToApiError(body.error, requestId),
        }))
      }
      const key = readIdempotencyKey(reply, requestId, request.headers[IDEMPOTENCY_KEY_HEADER])
      if (key === undefined) return
      const scope = status === 'completed' ? TASK_COMPLETE_SCOPE : TASK_CANCEL_SCOPE
      const requestHash = hashRequestBody({
        caseId: params.data.caseId,
        taskId: params.data.taskId,
        body: body.data,
      })
      const replay = await store.findIdempotent(session.user.organizationId, scope, key)
      if (replay !== undefined) {
        if (replay.requestHash !== requestHash) {
          return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
        }
        return reply.code(replay.responseStatus).send(replay.responseBody)
      }
      const now = options.clock.nowUtcIso()
      const outcome = await store.transitionTask({
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        requestId,
      }, params.data.caseId, params.data.taskId, status, body.data, {
        scope,
        key,
        requestHash,
      }, now.slice(0, 10))
      if (outcome.kind === 'idempotency_race') {
        const raced = await store.findIdempotent(session.user.organizationId, scope, key)
        if (raced !== undefined && raced.requestHash === requestHash) {
          return reply.code(raced.responseStatus).send(raced.responseBody)
        }
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
      return caseTaskResponseSchema.parse({ task: outcome.item })
    })
  }

  registerTransition(CASE_TASK_COMPLETE_ROUTE, 'completed')
  registerTransition(CASE_TASK_CANCEL_ROUTE, 'cancelled')
}
