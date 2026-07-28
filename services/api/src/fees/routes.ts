import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  CASE_FEE_CANDIDATES_ROUTE,
  CASE_FEE_ROUTE,
  CASE_SUMMARY_REPORT_ROUTE,
  FEES_ROUTE,
  FEE_APPROVE_ROUTE,
  FEE_CORRECT_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseFeeParamsSchema,
  caseSummaryReportQuerySchema,
  closureFeeApproveRequestSchema,
  closureFeeCandidateCreateRequestSchema,
  closureFeeCorrectRequestSchema,
  closureFeeListQuerySchema,
  failureEnvelopeSchema,
  feeParamsSchema,
  idempotencyKeySchema,
  zodErrorToApiError,
  type RoleCode,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import type { Clock } from '../clock.js'
import { hashRequestBody } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import {
  FEE_APPROVE_SCOPE,
  FEE_CANDIDATE_SCOPE,
  FEE_CORRECT_SCOPE,
  createFeeStore,
  type FeeCapabilities,
  type FeeCommandOutcome,
} from './store.js'

export interface FeeRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
}

const CANDIDATE_ROLES = ['admin', 'expert', 'case_manager'] as const
const APPROVE_ROLES = ['admin', 'expert', 'accounting'] as const
/** HB-011: mali tutar/rapor görünürlüğü; secretary ve read_only kapsam dışıdır. */
const FINANCIAL_READ_ROLES = ['admin', 'expert', 'case_manager', 'accounting'] as const satisfies readonly RoleCode[]

function hasRole(roles: readonly RoleCode[], allowed: readonly RoleCode[]): boolean {
  return roles.some((role) => allowed.includes(role))
}

function capabilities(roles: readonly RoleCode[]): FeeCapabilities {
  return {
    canCreateCandidate: hasRole(roles, CANDIDATE_ROLES),
    canApprove: hasRole(roles, APPROVE_ROLES),
    canView: hasRole(roles, FINANCIAL_READ_ROLES),
  }
}

function parseKey(request: FastifyRequest): string | undefined {
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
      fieldErrors: [{
        path: IDEMPOTENCY_KEY_HEADER,
        code: 'idempotency_key_required',
        message: 'Field value is not allowed.',
      }],
      requestId,
    },
  }))
}

function invalid(
  reply: FastifyReply,
  error: Parameters<typeof zodErrorToApiError>[0],
  requestId: string,
) {
  return reply.code(400).send(failureEnvelopeSchema.parse({
    ok: false,
    error: zodErrorToApiError(error, requestId),
  }))
}

function sendOutcome(reply: FastifyReply, outcome: FeeCommandOutcome, requestId: string) {
  if (outcome.kind === 'ok') return reply.code(outcome.status).send(outcome.response)
  if (outcome.kind === 'replay') return reply.code(outcome.status).send(outcome.body)
  if (outcome.kind === 'not_found') {
    return reply.code(404).send(failureBody('not_found', 'Closure fee not found.', requestId))
  }
  if (outcome.kind === 'case_version_conflict' || outcome.kind === 'fee_version_conflict') {
    return reply.code(409).send(failureBody('closure_fee_stale', 'Closure fee state changed.', requestId))
  }
  if (outcome.kind === 'source_invalid') {
    return reply.code(409).send(failureBody(
      'closure_fee_source_invalid',
      'A ready and verified final expert report is required.',
      requestId,
    ))
  }
  if (outcome.kind === 'idempotency_conflict') {
    return reply.code(409).send(failureBody(
      'idempotency_conflict',
      'Idempotency key was used with a different request.',
      requestId,
    ))
  }
  return reply.code(409).send(failureBody(
    'closure_fee_conflict',
    'Closure fee cannot be changed in its current state.',
    requestId,
  ))
}

export function registerFeeRoutes(app: FastifyInstance, options: FeeRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createFeeStore(options.pool)

  app.get(CASE_FEE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, FINANCIAL_READ_ROLES)
    if (session === undefined) return
    const params = caseFeeParamsSchema.safeParse(request.params)
    if (!params.success) return invalid(reply, params.error, requestId)
    const response = await store.getCase(
      session.user.organizationId,
      params.data.caseId,
      capabilities(session.user.roles),
    )
    if (response === undefined) {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    return response
  })

  app.get(FEES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, FINANCIAL_READ_ROLES)
    if (session === undefined) return
    const query = closureFeeListQuerySchema.safeParse(request.query)
    if (!query.success) return invalid(reply, query.error, requestId)
    return store.list(
      session.user.organizationId,
      query.data,
      capabilities(session.user.roles),
    )
  })

  app.get(CASE_SUMMARY_REPORT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const query = caseSummaryReportQuerySchema.safeParse(request.query)
    if (!query.success) return invalid(reply, query.error, requestId)
    return store.report(
      session.user.organizationId,
      query.data,
      options.clock.nowUtcIso(),
      capabilities(session.user.roles),
    )
  })

  app.post(CASE_FEE_CANDIDATES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, CANDIDATE_ROLES)
    if (session === undefined) return
    const params = caseFeeParamsSchema.safeParse(request.params)
    const body = closureFeeCandidateCreateRequestSchema.safeParse(request.body)
    if (!params.success) return invalid(reply, params.error, requestId)
    if (!body.success) return invalid(reply, body.error, requestId)
    const key = parseKey(request)
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const requestHash = hashRequestBody({ caseId: params.data.caseId, ...body.data })
    const outcome = await store.createCandidate(
      {
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        requestId,
      },
      params.data.caseId,
      body.data,
      { scope: FEE_CANDIDATE_SCOPE, key, requestHash },
      capabilities(session.user.roles),
    )
    return sendOutcome(reply, outcome, requestId)
  })

  async function approvalCommand(
    request: FastifyRequest,
    reply: FastifyReply,
    kind: 'approve' | 'correct',
  ) {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, APPROVE_ROLES)
    if (session === undefined) return
    const params = feeParamsSchema.safeParse(request.params)
    const body = (kind === 'approve'
      ? closureFeeApproveRequestSchema
      : closureFeeCorrectRequestSchema).safeParse(request.body)
    if (!params.success) return invalid(reply, params.error, requestId)
    if (!body.success) return invalid(reply, body.error, requestId)
    const key = parseKey(request)
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const requestHash = hashRequestBody({ feeId: params.data.feeId, kind, ...body.data })
    const actor = {
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }
    const caps = capabilities(session.user.roles)
    const outcome = kind === 'approve'
      ? await store.approve(
          actor,
          params.data.feeId,
          body.data as never,
          { scope: FEE_APPROVE_SCOPE, key, requestHash },
          caps,
        )
      : await store.correct(
          actor,
          params.data.feeId,
          body.data as never,
          { scope: FEE_CORRECT_SCOPE, key, requestHash },
          caps,
        )
    return sendOutcome(reply, outcome, requestId)
  }

  app.post(FEE_APPROVE_ROUTE, async (request, reply) => approvalCommand(request, reply, 'approve'))
  app.post(FEE_CORRECT_ROUTE, async (request, reply) => approvalCommand(request, reply, 'correct'))
}
