import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_WORKSPACE_APPROVE_ROUTE,
  CASE_WORKSPACE_PLAN_ROUTE,
  CASE_WORKSPACE_PLANS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  workspaceApproveRequestSchema,
  workspacePlanParamsSchema,
  workspacePlanRequestSchema,
  workspaceProvisioningParamsSchema,
  workspaceProvisioningResponseSchema,
  zodErrorToApiError,
  type RoleCode,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody, isIdempotencyRace } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createWorkspaceStore, WORKSPACE_APPROVE_SCOPE, WORKSPACE_PLAN_SCOPE } from './store.js'

export interface WorkspaceRoutesOptions { readonly pool: pg.Pool }

/** HB-011: ilk fiziksel klasör kurulumu da "kritik işlem"dir; case-lifecycle ile aynı sınır. */
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
    error: {
      code: 'validation_error',
      message: 'Request validation failed.',
      fieldErrors: [{ path, code, message: 'Field value is not allowed.' }],
      requestId,
    },
  }))
}

export function registerWorkspaceRoutes(app: FastifyInstance, options: WorkspaceRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const store = createWorkspaceStore(options.pool)

  app.get(CASE_WORKSPACE_PLANS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = workspacePlanParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    const provisioning = await store.findCurrentPlan(session.user.organizationId, params.data.caseId)
    if (provisioning === undefined) return reply.code(404).send(failureBody('not_found', 'Workspace plan not found.', requestId))
    return workspaceProvisioningResponseSchema.parse({ provisioning })
  })

  app.post(CASE_WORKSPACE_PLANS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = workspacePlanParamsSchema.safeParse(request.params)
    const body = workspacePlanRequestSchema.safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const key = parseKey(request as unknown as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const requestHash = hashRequestBody({ caseId: params.data.caseId, ...body.data })
    const replay = await store.findIdempotent(session.user.organizationId, WORKSPACE_PLAN_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const result = await store.createPlan(
        { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
        params.data.caseId,
        body.data,
        { key, requestHash },
      )
      if (result.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      if (result.kind === 'unknown_root') return sendFieldError(reply, requestId, 'storageRootKey', 'unknown_reference')
      if (result.kind === 'notification_date_required') return sendFieldError(reply, requestId, 'notificationDate', 'required_for_workspace')
      if (result.kind === 'location_conflict') return reply.code(409).send(failureBody('workspace_conflict', 'Case already has a workspace location.', requestId))
      if (result.kind === 'active_conflict') return reply.code(409).send(failureBody('workspace_conflict', 'Case already has a workspace provisioning plan.', requestId))
      if (result.kind === 'path_exhausted') return reply.code(409).send(failureBody('workspace_conflict', 'No safe workspace path is available.', requestId))
      return reply.code(201).send(workspaceProvisioningResponseSchema.parse({ provisioning: result.provisioning }))
    } catch (error) {
      if (isIdempotencyRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, WORKSPACE_PLAN_SCOPE, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      throw error
    }
  })

  app.get(CASE_WORKSPACE_PLAN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = workspaceProvisioningParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    const provisioning = await store.findPlan(session.user.organizationId, params.data.caseId, params.data.planId)
    if (provisioning === undefined) return reply.code(404).send(failureBody('not_found', 'Workspace plan not found.', requestId))
    return workspaceProvisioningResponseSchema.parse({ provisioning })
  })

  app.post(CASE_WORKSPACE_APPROVE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = workspaceProvisioningParamsSchema.safeParse(request.params)
    const body = workspaceApproveRequestSchema.safeParse(request.body ?? {})
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    const key = parseKey(request as unknown as { headers: Record<string, unknown> })
    if (key === undefined) return sendKeyRequired(reply, requestId)
    const requestHash = hashRequestBody({ caseId: params.data.caseId, planId: params.data.planId })
    const replay = await store.findIdempotent(session.user.organizationId, WORKSPACE_APPROVE_SCOPE, key)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }
    try {
      const result = await store.approvePlan(
        { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
        params.data.caseId,
        params.data.planId,
        { key, requestHash },
      )
      if (result.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Workspace plan not found.', requestId))
      if (result.kind === 'stale') return reply.code(409).send(failureBody('workspace_stale', 'Workspace plan is stale.', requestId))
      return reply.code(202).send(workspaceProvisioningResponseSchema.parse({ provisioning: result.provisioning }))
    } catch (error) {
      if (isIdempotencyRace(error)) {
        const raced = await store.findIdempotent(session.user.organizationId, WORKSPACE_APPROVE_SCOPE, key)
        if (raced !== undefined && raced.requestHash === requestHash) return reply.code(raced.responseStatus).send(raced.responseBody)
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      throw error
    }
  })
}
