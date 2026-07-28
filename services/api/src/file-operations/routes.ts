import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  CASE_FILE_OPERATION_APPROVE_ROUTE,
  CASE_FILE_OPERATION_CANCEL_ROUTE,
  CASE_FILE_OPERATION_PLAN_ROUTE,
  CASE_FILE_OPERATION_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  failureEnvelopeSchema,
  fileOperationApproveRequestSchema,
  fileOperationCancelRequestSchema,
  fileOperationParamsSchema,
  fileOperationPlanParamsSchema,
  fileOperationPlanRequestSchema,
  fileOperationResponseSchema,
  idempotencyKeySchema,
  zodErrorToApiError,
  type RoleCode,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody, isIdempotencyRace } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import {
  FILE_OPERATION_APPROVE_SCOPE,
  FILE_OPERATION_CANCEL_SCOPE,
  FILE_OPERATION_IDEMPOTENCY_CONSTRAINT,
  FILE_OPERATION_PLAN_SCOPE,
  createFileOperationStore,
} from './store.js'

export interface FileOperationRoutesOptions { readonly pool: pg.Pool }

/**
 * HB-011: fiziksel dosya/klasör taşıma "kritik işlem"dir (AGENTS.md §7).
 * case-lifecycle'ın COMMAND_ROLES'ü ile aynı — bu uçlar case-lifecycle'ın
 * kendi rol kapısını atlayan BAĞIMSIZ bir yüzeydir, aynı sınırı taşımalıdır.
 */
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const satisfies readonly RoleCode[]

function parseKey(request: { headers: Record<string, unknown> }): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER]
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw)
  return parsed.success ? parsed.data : undefined
}

function sendKeyRequired(reply: FastifyReply, requestId: string): void {
  void reply.code(400).send(failureEnvelopeSchema.parse({
    ok: false,
    error: {
      code: 'validation_error',
      message: 'Request validation failed.',
      fieldErrors: [{ path: IDEMPOTENCY_KEY_HEADER, code: 'idempotency_key_required', message: 'Field value is not allowed.' }],
      requestId,
    },
  }))
}

function sendFieldError(reply: FastifyReply, requestId: string, path: string, code: string): void {
  void reply.code(400).send(failureEnvelopeSchema.parse({
    ok: false,
    error: { code: 'validation_error', message: 'Request validation failed.', fieldErrors: [{ path, code, message: 'Field value is not allowed.' }], requestId },
  }))
}

function operationIdempotencyRace(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string }
  return isIdempotencyRace(error)
    || (pgError.code === '23505' && pgError.constraint === FILE_OPERATION_IDEMPOTENCY_CONSTRAINT)
}

export function registerFileOperationRoutes(app: FastifyInstance, options: FileOperationRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const store = createFileOperationStore(options.pool)

  app.post(CASE_FILE_OPERATION_PLAN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = fileOperationPlanParamsSchema.safeParse(request.params)
    const body = fileOperationPlanRequestSchema.safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const key = parseKey(request as unknown as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const requestHash = hashRequestBody({ caseId: params.data.caseId, ...body.data })
    const replay = await store.findIdempotent(session.user.organizationId, FILE_OPERATION_PLAN_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const outcome = await store.createPlan(
        { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
        params.data.caseId,
        body.data,
        { key, requestHash },
      )
      if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      if (outcome.kind === 'location_required') return reply.code(409).send(failureBody('file_operation_stale', 'Verified case workspace is required.', requestId))
      if (outcome.kind === 'location_not_verified') return reply.code(409).send(failureBody('file_operation_stale', 'Case workspace is not verified.', requestId))
      if (outcome.kind === 'version_conflict') return reply.code(409).send(failureBody('version_conflict', 'Case location was modified by another operation.', requestId))
      if (outcome.kind === 'unknown_root') return sendFieldError(reply, requestId, 'destinationStorageRootKey', 'unknown_reference')
      if (outcome.kind === 'invalid_rename') return sendFieldError(reply, requestId, 'destinationRelativePath', 'rename_requires_same_parent')
      if (outcome.kind === 'same_destination') return sendFieldError(reply, requestId, 'destinationRelativePath', 'destination_matches_source')
      if (outcome.kind === 'active_conflict') return reply.code(409).send(failureBody('file_operation_conflict', 'Case already has an active file operation.', requestId))
      if (outcome.kind === 'destination_conflict') return reply.code(409).send(failureBody('destination_conflict', 'Destination is already reserved or in use.', requestId))
      return reply.code(201).send(fileOperationResponseSchema.parse({ operation: outcome.operation }))
    } catch (error) {
      if (operationIdempotencyRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, FILE_OPERATION_PLAN_SCOPE, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      throw error
    }
  })

  app.get(CASE_FILE_OPERATION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = fileOperationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    const operation = await store.findOperation(session.user.organizationId, params.data.caseId, params.data.operationId)
    if (operation === undefined) return reply.code(404).send(failureBody('not_found', 'File operation not found.', requestId))
    return fileOperationResponseSchema.parse({ operation })
  })

  async function command(
    request: FastifyRequest,
    reply: FastifyReply,
    kind: 'approve' | 'cancel',
  ) {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = fileOperationParamsSchema.safeParse(request.params)
    const parsed = (kind === 'approve' ? fileOperationApproveRequestSchema : fileOperationCancelRequestSchema).safeParse(request.body ?? {})
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!parsed.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    const key = parseKey(request as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const scope = kind === 'approve' ? FILE_OPERATION_APPROVE_SCOPE : FILE_OPERATION_CANCEL_SCOPE
    const requestHash = hashRequestBody({ caseId: params.data.caseId, operationId: params.data.operationId, kind })
    const replay = await store.findIdempotent(session.user.organizationId, scope, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const outcome = kind === 'approve'
        ? await store.approve({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId }, params.data.caseId, params.data.operationId, { key, requestHash })
        : await store.cancel({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId }, params.data.caseId, params.data.operationId, { key, requestHash })
      if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'File operation not found.', requestId))
      if (outcome.kind === 'stale') return reply.code(409).send(failureBody('file_operation_stale', 'File operation is stale or terminal.', requestId))
      if (outcome.kind === 'conflict') return reply.code(409).send(failureBody('file_operation_conflict', 'File operation cannot be changed in its current state.', requestId))
      return reply.code(kind === 'approve' ? 202 : 200).send(fileOperationResponseSchema.parse({ operation: outcome.operation }))
    } catch (error) {
      if (isIdempotencyRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, scope, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      throw error
    }
  }

  app.post(CASE_FILE_OPERATION_APPROVE_ROUTE, async (request, reply) => command(request, reply, 'approve'))
  app.post(CASE_FILE_OPERATION_CANCEL_ROUTE, async (request, reply) => command(request, reply, 'cancel'))
}
