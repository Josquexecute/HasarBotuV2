import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_LABOR_SHEET_ROUTE,
  CASE_LABOR_SHEET_VERSIONS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  LABOR_SHEET_CREATE_SCOPE,
  LABOR_SHEET_REVISE_SCOPE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  laborSheetCreateRequestSchema,
  laborSheetParamsSchema,
  laborSheetResponseSchema,
  laborSheetReviseRequestSchema,
  zodErrorToApiError,
  type ApiErrorCode,
  type RoleCode,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { hashRequestBody } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createLaborStore, type LaborCommandOutcome } from './store.js'

export interface LaborRoutesOptions {
  readonly pool: pg.Pool
}

const WRITE_ROLES = ['admin', 'expert', 'case_manager', 'secretary'] as const satisfies readonly RoleCode[]

function canWrite(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number]))
}

function sendFieldError(reply: FastifyReply, requestId: string, path: string, code: string): FastifyReply {
  return reply.code(400).send(failureEnvelopeSchema.parse({
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
    sendFieldError(reply, requestId, IDEMPOTENCY_KEY_HEADER, 'idempotency_key_required')
    return undefined
  }
  return parsed.data
}

function sendOutcomeError(
  reply: FastifyReply,
  requestId: string,
  outcome: Exclude<LaborCommandOutcome<unknown>, { kind: 'ok' | 'idempotency_race' }>,
): FastifyReply {
  if (outcome.kind === 'not_found' || outcome.kind === 'sheet_missing') {
    return reply.code(404).send(failureBody('not_found', 'Labor sheet resource not found.', requestId))
  }
  if (outcome.kind === 'version_conflict') {
    return reply.code(409).send(failureBody('version_conflict', 'Labor sheet was modified by another operation.', requestId))
  }
  if (outcome.kind === 'case_closed') {
    return reply.code(409).send(failureBody('conflict', 'Closed cases cannot change the labor sheet.', requestId))
  }
  if (outcome.kind === 'sheet_exists') {
    return reply.code(409).send(failureBody('conflict', 'Case already has a labor sheet; revise the current version instead.', requestId))
  }
  const path = outcome.itemOrdinal === null ? 'items' : `items[${outcome.itemOrdinal - 1}]`
  return sendFieldError(reply, requestId, path, outcome.reasonCode)
}

export function registerLaborRoutes(app: FastifyInstance, options: LaborRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createLaborStore(options.pool)

  app.get(CASE_LABOR_SHEET_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = laborSheetParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    const workspace = await store.readWorkspace(
      session.user.organizationId,
      params.data.caseId,
      canWrite(session.user.roles),
    )
    if (workspace === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    return workspace
  })

  app.post(CASE_LABOR_SHEET_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborSheetParamsSchema.safeParse(request.params)
    const body = laborSheetCreateRequestSchema.safeParse(request.body)
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
    const replay = await store.findIdempotent(session.user.organizationId, LABOR_SHEET_CREATE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.createSheet({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, body.data, {
      scope: LABOR_SHEET_CREATE_SCOPE,
      key,
      requestHash,
    })
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, LABOR_SHEET_CREATE_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return reply.code(201).send(laborSheetResponseSchema.parse(outcome.response))
  })

  app.post(CASE_LABOR_SHEET_VERSIONS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborSheetParamsSchema.safeParse(request.params)
    const body = laborSheetReviseRequestSchema.safeParse(request.body)
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
    const replay = await store.findIdempotent(session.user.organizationId, LABOR_SHEET_REVISE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.reviseSheet({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, body.data, {
      scope: LABOR_SHEET_REVISE_SCOPE,
      key,
      requestHash,
    })
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, LABOR_SHEET_REVISE_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return laborSheetResponseSchema.parse(outcome.response)
  })
}
