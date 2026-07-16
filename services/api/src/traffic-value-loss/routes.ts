import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  IDEMPOTENCY_KEY_HEADER,
  TRAFFIC_VALUE_LOSS_APPROVE_ROUTE,
  TRAFFIC_VALUE_LOSS_APPROVE_SCOPE,
  TRAFFIC_VALUE_LOSS_REJECT_ROUTE,
  TRAFFIC_VALUE_LOSS_REJECT_SCOPE,
  TRAFFIC_VALUE_LOSS_ROUTE,
  TRAFFIC_VALUE_LOSS_SUBMIT_ROUTE,
  TRAFFIC_VALUE_LOSS_SUBMIT_SCOPE,
  TRAFFIC_VALUE_LOSS_VERSION_SCOPE,
  TRAFFIC_VALUE_LOSS_VERSIONS_ROUTE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  trafficValueLossApproveRequestSchema,
  trafficValueLossParamsSchema,
  trafficValueLossRejectRequestSchema,
  trafficValueLossResponseSchema,
  trafficValueLossSubmitRequestSchema,
  trafficValueLossVersionCreateRequestSchema,
  trafficValueLossVersionParamsSchema,
  trafficValueLossVersionsResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody, isIdempotencyRace } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createTrafficValueLossStore, TrafficValueLossStoreError } from './store.js'

export interface TrafficValueLossRoutesOptions { readonly pool: pg.Pool }
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const APPROVAL_ROLES = ['admin', 'expert'] as const

function key(request: FastifyRequest): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER]
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw)
  return parsed.success ? parsed.data : undefined
}
function keyRequired(reply: FastifyReply, requestId: string) {
  return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:{code:'validation_error',message:'Request validation failed.',fieldErrors:[{path:IDEMPOTENCY_KEY_HEADER,code:'idempotency_key_required',message:'Field value is not allowed.'}],requestId} }))
}
function storeError(reply: FastifyReply, requestId: string, error: TrafficValueLossStoreError) {
  if (error.code === 'not_found') return reply.code(404).send(failureBody('not_found', 'Traffic value loss assessment not found.', requestId))
  if (error.code === 'wrong_case_type' || error.code === 'invalid_source') return reply.code(400).send(failureBody('traffic_value_loss_source_invalid', 'Case or evidence is not eligible for traffic value loss.', requestId))
  if (error.code === 'version_conflict') return reply.code(409).send(failureBody('traffic_value_loss_stale', 'Traffic value loss version changed.', requestId))
  if (error.code === 'approval_blocked') return reply.code(409).send(failureBody('traffic_value_loss_approval_blocked', 'Uncertainties block submission or approval.', requestId))
  if (error.code === 'idempotency_conflict') return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
  return reply.code(409).send(failureBody('traffic_value_loss_conflict', 'Traffic value loss state does not permit this operation.', requestId))
}

export function registerTrafficValueLossRoutes(app: FastifyInstance, options: TrafficValueLossRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createTrafficValueLossStore(options.pool)
  const actor = (session: { user: { organizationId: string; id: string } }, request: FastifyRequest) => ({
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
    requestId: String(request.id),
  })

  app.get(TRAFFIC_VALUE_LOSS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const assessment = await store.find(session.user.organizationId, params.data.caseId)
    if (assessment === undefined) return reply.code(404).send(failureBody('not_found', 'Traffic value loss assessment not found.', requestId))
    return trafficValueLossResponseSchema.parse({ assessment })
  })

  app.get(TRAFFIC_VALUE_LOSS_VERSIONS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const versions = await store.versions(session.user.organizationId, params.data.caseId)
    if (versions === undefined) return reply.code(404).send(failureBody('not_found', 'Traffic value loss assessment not found.', requestId))
    return trafficValueLossVersionsResponseSchema.parse({ versions })
  })

  async function command(request: FastifyRequest, reply: FastifyReply, kind: 'version' | 'submit' | 'approve' | 'reject') {
    const requestId = String(request.id)
    const roles = kind === 'approve' || kind === 'reject' ? APPROVAL_ROLES : WRITE_ROLES
    const session = await requireAnyRole(auth, request, reply, roles)
    if (session === undefined) return
    const idemKey = key(request)
    if (idemKey === undefined) return keyRequired(reply, requestId)
    const paramsSchema = kind === 'version' ? trafficValueLossParamsSchema : trafficValueLossVersionParamsSchema
    const params = paramsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const schema = kind === 'version' ? trafficValueLossVersionCreateRequestSchema
      : kind === 'submit' ? trafficValueLossSubmitRequestSchema
        : kind === 'approve' ? trafficValueLossApproveRequestSchema
          : trafficValueLossRejectRequestSchema
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(body.error,requestId) }))
    const scope = kind === 'version' ? TRAFFIC_VALUE_LOSS_VERSION_SCOPE
      : kind === 'submit' ? TRAFFIC_VALUE_LOSS_SUBMIT_SCOPE
        : kind === 'approve' ? TRAFFIC_VALUE_LOSS_APPROVE_SCOPE
          : TRAFFIC_VALUE_LOSS_REJECT_SCOPE
    const caseId = (params.data as { caseId: string }).caseId
    const versionId = 'versionId' in params.data ? params.data.versionId : undefined
    const idem = { scope, key: idemKey, requestHash: hashRequestBody({ kind, caseId, versionId, ...body.data }) }
    const run = () => kind === 'version'
      ? store.createVersion(actor(session, request), caseId, body.data as never, idem)
      : kind === 'submit'
        ? store.submit(actor(session, request), caseId, versionId as string, body.data as never, idem)
        : kind === 'approve'
          ? store.approve(actor(session, request), caseId, versionId as string, body.data as never, idem)
          : store.reject(actor(session, request), caseId, versionId as string, body.data as never, idem)
    try {
      let result
      try { result = await run() } catch (error) {
        if (!isIdempotencyRace(error)) throw error
        result = await run()
      }
      return reply.code(result.status).send(trafficValueLossResponseSchema.parse(result.body))
    } catch (error) {
      if (error instanceof TrafficValueLossStoreError) return storeError(reply, requestId, error)
      throw error
    }
  }

  app.post(TRAFFIC_VALUE_LOSS_VERSIONS_ROUTE, async (request, reply) => command(request, reply, 'version'))
  app.post(TRAFFIC_VALUE_LOSS_SUBMIT_ROUTE, async (request, reply) => command(request, reply, 'submit'))
  app.post(TRAFFIC_VALUE_LOSS_APPROVE_ROUTE, async (request, reply) => command(request, reply, 'approve'))
  app.post(TRAFFIC_VALUE_LOSS_REJECT_ROUTE, async (request, reply) => command(request, reply, 'reject'))
}
