import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_EMAIL_AI_PLAN_ROUTE,
  CASE_EMAIL_AI_RUN_ROUTE,
  CASE_EMAIL_AI_RUNS_ROUTE,
  EMAIL_AI_START_SCOPE,
  IDEMPOTENCY_KEY_HEADER,
  emailAiCaseParamsSchema,
  emailAiPlanRequestSchema,
  emailAiPlanResponseSchema,
  emailAiRunParamsSchema,
  emailAiRunResponseSchema,
  emailAiRunsResponseSchema,
  emailAiStartRequestSchema,
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
  createEmailAiStore,
  EmailAiStoreError,
} from './store.js'
import type { EmailAiProviderRegistry } from './providers.js'

export interface EmailAiRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
  readonly providers: EmailAiProviderRegistry
}

const START_ROLES = ['admin', 'expert', 'case_manager'] as const satisfies readonly RoleCode[]

function canStart(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => START_ROLES.includes(role as (typeof START_ROLES)[number]))
}

function sendFieldError(
  reply: FastifyReply,
  requestId: string,
  path: string,
  code: string,
): FastifyReply {
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

function sendStoreError(
  reply: FastifyReply,
  requestId: string,
  error: EmailAiStoreError,
): FastifyReply {
  if (error.code === 'not_found') {
    return reply.code(404).send(failureBody('not_found', 'Email AI resource not found.', requestId))
  }
  if (error.code === 'version_conflict') {
    return reply.code(409).send(failureBody('version_conflict', 'Email AI plan is stale.', requestId))
  }
  if (error.code === 'idempotency_conflict') {
    return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
  }
  return reply.code(409).send(failureBody(
    'conflict',
    error.code === 'case_closed'
      ? 'Closed cases cannot start email AI suggestions.'
      : 'Email AI suggestion state does not allow this operation.',
    requestId,
  ))
}

export function registerEmailAiRoutes(app: FastifyInstance, options: EmailAiRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createEmailAiStore(options.pool, options.providers)

  app.get(CASE_EMAIL_AI_RUNS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = emailAiCaseParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    const response = await store.list(
      session.user.organizationId,
      params.data.caseId,
      canStart(session.user.roles),
    )
    if (response === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    return emailAiRunsResponseSchema.parse(response)
  })

  app.get(CASE_EMAIL_AI_RUN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = emailAiRunParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false,
        error: zodErrorToApiError(params.error, requestId),
      }))
    }
    const run = await store.get(
      session.user.organizationId,
      params.data.caseId,
      params.data.runId,
    )
    if (run === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Email AI suggestion not found.', requestId))
    }
    return emailAiRunResponseSchema.parse({ run })
  })

  app.post(CASE_EMAIL_AI_PLAN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, START_ROLES)
    if (session === undefined) return
    const params = emailAiCaseParamsSchema.safeParse(request.params)
    const body = emailAiPlanRequestSchema.safeParse(request.body)
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
    if (
      body.data.draftType === 'custom_instruction'
      && (body.data.instruction?.trim().length ?? 0) === 0
    ) {
      return sendFieldError(reply, requestId, 'instruction', 'instruction_required')
    }
    try {
      const response = await store.plan(
        {
          organizationId: session.user.organizationId,
          actorUserId: session.user.id,
          requestId,
        },
        params.data.caseId,
        body.data,
        options.clock.nowUtcIso(),
      )
      return emailAiPlanResponseSchema.parse(response)
    } catch (error) {
      if (error instanceof EmailAiStoreError) return sendStoreError(reply, requestId, error)
      throw error
    }
  })

  app.post(CASE_EMAIL_AI_RUNS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, START_ROLES)
    if (session === undefined) return
    const params = emailAiCaseParamsSchema.safeParse(request.params)
    const body = emailAiStartRequestSchema.safeParse(request.body)
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
    if (
      body.data.draftType === 'custom_instruction'
      && (body.data.instruction?.trim().length ?? 0) === 0
    ) {
      return sendFieldError(reply, requestId, 'instruction', 'instruction_required')
    }
    const key = readIdempotencyKey(reply, requestId, request.headers[IDEMPOTENCY_KEY_HEADER])
    if (key === undefined) return
    const requestHash = hashRequestBody({ caseId: params.data.caseId, body: body.data })
    try {
      const result = await store.start(
        {
          organizationId: session.user.organizationId,
          actorUserId: session.user.id,
          requestId,
        },
        params.data.caseId,
        body.data,
        options.clock.nowUtcIso(),
        {
          scope: EMAIL_AI_START_SCOPE,
          key,
          requestHash,
        },
      )
      return reply.code(result.status).send(emailAiRunResponseSchema.parse(result.body))
    } catch (error) {
      if (error instanceof EmailAiStoreError) return sendStoreError(reply, requestId, error)
      throw error
    }
  })
}
