import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_EMAIL_DRAFT_HANDOFFS_ROUTE,
  CASE_EMAIL_DRAFT_PREVIEW_ROUTE,
  CASE_EMAIL_DRAFT_VERSIONS_ROUTE,
  CASE_EMAIL_DRAFTS_ROUTE,
  EMAIL_DRAFT_CREATE_SCOPE,
  EMAIL_DRAFT_HANDOFF_SCOPE,
  EMAIL_DRAFT_REVISE_SCOPE,
  IDEMPOTENCY_KEY_HEADER,
  emailDraftCreateRequestSchema,
  emailDraftHandoffRequestSchema,
  emailDraftHandoffResponseSchema,
  emailDraftParamsSchema,
  emailDraftPreviewRequestSchema,
  emailDraftPreviewResponseSchema,
  emailDraftResourceParamsSchema,
  emailDraftResponseSchema,
  emailDraftReviseRequestSchema,
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
import { createEmailDraftStore, type EmailDraftCommandOutcome } from './store.js'

export interface EmailDraftRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
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
  outcome: Exclude<EmailDraftCommandOutcome<unknown>, { kind: 'ok' | 'idempotency_race' }>,
): FastifyReply {
  if (outcome.kind === 'not_found') {
    return reply.code(404).send(failureBody('not_found', 'Email draft resource not found.', requestId))
  }
  if (outcome.kind === 'version_conflict') {
    return reply.code(409).send(failureBody('version_conflict', 'Email draft was modified by another operation.', requestId))
  }
  if (outcome.kind === 'preview_stale') {
    return reply.code(409).send(failureBody('version_conflict', 'Email draft preview is stale.', requestId))
  }
  if (outcome.kind === 'case_closed') {
    return reply.code(409).send(failureBody('conflict', 'Closed cases cannot prepare email drafts.', requestId))
  }
  if (outcome.kind === 'invalid_recipients') {
    return sendFieldError(reply, requestId, 'to', outcome.code)
  }
  if (outcome.kind === 'invalid_ai_suggestion') {
    return sendFieldError(reply, requestId, 'emailAiSuggestionRunId', 'invalid_ai_suggestion')
  }
  return sendFieldError(reply, requestId, outcome.field, 'unverified_attachment')
}

export function registerEmailDraftRoutes(app: FastifyInstance, options: EmailDraftRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createEmailDraftStore(options.pool)

  app.get(CASE_EMAIL_DRAFTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = emailDraftParamsSchema.safeParse(request.params)
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

  app.post(CASE_EMAIL_DRAFT_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = emailDraftParamsSchema.safeParse(request.params)
    const body = emailDraftPreviewRequestSchema.safeParse(request.body)
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
    if (body.data.draftType === 'custom_instruction' && (body.data.instruction?.trim().length ?? 0) === 0) {
      return sendFieldError(reply, requestId, 'instruction', 'instruction_required')
    }
    const preview = await store.preview(
      session.user.organizationId,
      params.data.caseId,
      body.data,
      options.clock.nowUtcIso(),
    )
    if (preview === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    return emailDraftPreviewResponseSchema.parse(preview)
  })

  app.post(CASE_EMAIL_DRAFTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = emailDraftParamsSchema.safeParse(request.params)
    const body = emailDraftCreateRequestSchema.safeParse(request.body)
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
    const replay = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_CREATE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.createDraft({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, body.data, {
      scope: EMAIL_DRAFT_CREATE_SCOPE,
      key,
      requestHash,
    }, options.clock.nowUtcIso())
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_CREATE_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return reply.code(201).send(emailDraftResponseSchema.parse(outcome.response))
  })

  app.post(CASE_EMAIL_DRAFT_VERSIONS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = emailDraftResourceParamsSchema.safeParse(request.params)
    const body = emailDraftReviseRequestSchema.safeParse(request.body)
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
    const requestHash = hashRequestBody({ ...params.data, body: body.data })
    const replay = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_REVISE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.reviseDraft({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, params.data.draftId, body.data, {
      scope: EMAIL_DRAFT_REVISE_SCOPE,
      key,
      requestHash,
    })
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_REVISE_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return emailDraftResponseSchema.parse(outcome.response)
  })

  app.post(CASE_EMAIL_DRAFT_HANDOFFS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = emailDraftResourceParamsSchema.safeParse(request.params)
    const body = emailDraftHandoffRequestSchema.safeParse(request.body)
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
    const requestHash = hashRequestBody({ ...params.data, body: body.data })
    const replay = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_HANDOFF_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    const outcome = await store.prepareHandoff({
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }, params.data.caseId, params.data.draftId, body.data.expectedVersion, {
      scope: EMAIL_DRAFT_HANDOFF_SCOPE,
      key,
      requestHash,
    })
    if (outcome.kind === 'idempotency_race') {
      const raced = await store.findIdempotent(session.user.organizationId, EMAIL_DRAFT_HANDOFF_SCOPE, key)
      if (raced !== undefined && raced.requestHash === requestHash) {
        return reply.code(raced.responseStatus).send(raced.responseBody)
      }
      return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key conflict.', requestId))
    }
    if (outcome.kind !== 'ok') return sendOutcomeError(reply, requestId, outcome)
    return emailDraftHandoffResponseSchema.parse(outcome.response)
  })
}
