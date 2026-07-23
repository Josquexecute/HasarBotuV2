import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  IDEMPOTENCY_KEY_HEADER,
  TRAFFIC_VALUE_LOSS_APPROVE_ROUTE,
  TRAFFIC_VALUE_LOSS_CURRENT_APPROVED_ROUTE,
  TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE,
  TRAFFIC_VALUE_LOSS_APPROVE_SCOPE,
  TRAFFIC_VALUE_LOSS_REJECT_ROUTE,
  TRAFFIC_VALUE_LOSS_REJECT_SCOPE,
  TRAFFIC_VALUE_LOSS_PART_CATALOG_ROUTE,
  TRAFFIC_VALUE_LOSS_PREVIEW_ROUTE,
  TRAFFIC_VALUE_LOSS_REPORT_GENERATE_SCOPE,
  TRAFFIC_VALUE_LOSS_REPORT_PDF_ROUTE,
  TRAFFIC_VALUE_LOSS_REPORT_PREVIEW_ROUTE,
  TRAFFIC_VALUE_LOSS_REPORT_ROUTE,
  TRAFFIC_VALUE_LOSS_REPORTS_ROUTE,
  TRAFFIC_VALUE_LOSS_ROUTE,
  TRAFFIC_VALUE_LOSS_SUBMIT_ROUTE,
  TRAFFIC_VALUE_LOSS_SUBMIT_SCOPE,
  TRAFFIC_VALUE_LOSS_VERSION_SCOPE,
  TRAFFIC_VALUE_LOSS_VERSIONS_ROUTE,
  TRAFFIC_VALUE_LOSS_VERSION_REPORTS_ROUTE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  trafficValueLossApproveRequestSchema,
  trafficValueLossClosureListResponseSchema,
  trafficValueLossCurrentApprovedResponseSchema,
  trafficValueLossPartCatalogQuerySchema,
  trafficValueLossPartCatalogResponseSchema,
  trafficValueLossParamsSchema,
  trafficValueLossPreviewRequestSchema,
  trafficValueLossPreviewResponseSchema,
  trafficValueLossRejectRequestSchema,
  trafficValueLossReportGenerateRequestSchema,
  trafficValueLossReportParamsSchema,
  trafficValueLossReportPreviewRequestSchema,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossReportResponseSchema,
  trafficValueLossReportsResponseSchema,
  trafficValueLossReportVersionParamsSchema,
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
import {
  createTrafficValueLossReportStore,
  TrafficValueLossReportStoreError,
} from './report-store.js'
import { trafficValueLossReportFilename } from './report-pdf.js'
import { createTrafficValueLossClosureStore } from './closure-store.js'

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
  if (error.code === 'rule_selection_required') return reply.code(409).send(failureBody('traffic_value_loss_rule_selection_required', 'Accident date is required to select a traffic value loss rule.', requestId))
  if (error.code === 'rule_input_required') return reply.code(409).send(failureBody('traffic_value_loss_rule_input_required', 'Required rule inputs are missing or invalid.', requestId))
  if (error.code === 'version_conflict') return reply.code(409).send(failureBody('traffic_value_loss_stale', 'Traffic value loss version changed.', requestId))
  if (error.code === 'approval_blocked') return reply.code(409).send(failureBody('traffic_value_loss_approval_blocked', 'Uncertainties block submission or approval.', requestId))
  if (error.code === 'preview_mismatch') return reply.code(409).send(failureBody('traffic_value_loss_preview_stale', 'Calculation preview changed and must be reviewed again.', requestId))
  if (error.code === 'idempotency_conflict') return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
  return reply.code(409).send(failureBody('traffic_value_loss_conflict', 'Traffic value loss state does not permit this operation.', requestId))
}

function reportStoreError(reply: FastifyReply, requestId: string, error: TrafficValueLossReportStoreError) {
  if (error.code === 'not_found') return reply.code(404).send(failureBody('not_found', 'Traffic value loss report source not found.', requestId))
  if (error.code === 'version_conflict') return reply.code(409).send(failureBody('traffic_value_loss_stale', 'Traffic value loss version changed.', requestId))
  if (error.code === 'not_approved') return reply.code(409).send(failureBody('traffic_value_loss_report_not_approved', 'Only a human-approved traffic value loss version can be reported.', requestId))
  if (error.code === 'preview_mismatch') return reply.code(409).send(failureBody('traffic_value_loss_report_preview_stale', 'Report preview changed and must be reviewed again.', requestId))
  if (error.code === 'report_exists') return reply.code(409).send(failureBody('traffic_value_loss_report_exists', 'A final report already exists for this approved version.', requestId))
  if (error.code === 'idempotency_conflict') return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
  if (error.code === 'render_mismatch') return reply.code(409).send(failureBody('traffic_value_loss_report_verification_failed', 'Stored report output could not be verified.', requestId))
  return reply.code(400).send(failureBody('traffic_value_loss_report_invalid', 'Traffic value loss report content is invalid.', requestId))
}

export function registerTrafficValueLossRoutes(app: FastifyInstance, options: TrafficValueLossRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createTrafficValueLossStore(options.pool)
  const reports = createTrafficValueLossReportStore(options.pool)
  const closure = createTrafficValueLossClosureStore(options.pool)
  const actor = (session: { user: { organizationId: string; id: string } }, request: FastifyRequest) => ({
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
    requestId: String(request.id),
  })

  app.get(TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE, async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    return trafficValueLossClosureListResponseSchema.parse(
      await closure.list(session.user.organizationId),
    )
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

  app.get(TRAFFIC_VALUE_LOSS_CURRENT_APPROVED_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const version = await store.currentApproved(session.user.organizationId, params.data.caseId)
    if (version === undefined) return reply.code(404).send(failureBody('not_found', 'Approved traffic value loss revision not found.', requestId))
    return trafficValueLossCurrentApprovedResponseSchema.parse({ version })
  })

  app.get(TRAFFIC_VALUE_LOSS_PART_CATALOG_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    const query = trafficValueLossPartCatalogQuerySchema.safeParse(request.query)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    if (!query.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(query.error,requestId) }))
    const catalog = await store.partCatalog(
      session.user.organizationId,
      params.data.caseId,
      query.data.vehicleGroupCode,
    )
    if (catalog === undefined) return reply.code(404).send(failureBody('not_found', 'Traffic case not found.', requestId))
    return trafficValueLossPartCatalogResponseSchema.parse(catalog)
  })

  app.post(TRAFFIC_VALUE_LOSS_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    const body = trafficValueLossPreviewRequestSchema.safeParse(request.body)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(body.error,requestId) }))
    if (body.data.ruleOverride !== null && !session.user.roles.includes('admin')) {
      return reply.code(403).send(failureBody('forbidden', 'Rule override requires admin role.', requestId))
    }
    try {
      return trafficValueLossPreviewResponseSchema.parse(
        await store.preview(actor(session, request), params.data.caseId, body.data),
      )
    } catch (error) {
      if (error instanceof TrafficValueLossStoreError) return storeError(reply, requestId, error)
      throw error
    }
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

  app.post(TRAFFIC_VALUE_LOSS_REPORT_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossReportVersionParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const body = trafficValueLossReportPreviewRequestSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(body.error,requestId) }))
    try {
      const preview = await reports.preview(
        session.user.organizationId,
        params.data.caseId,
        params.data.versionId,
        body.data,
      )
      return trafficValueLossReportPreviewResponseSchema.parse(preview)
    } catch (error) {
      if (error instanceof TrafficValueLossReportStoreError) return reportStoreError(reply, requestId, error)
      throw error
    }
  })

  app.get(TRAFFIC_VALUE_LOSS_REPORTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const items = await reports.list(session.user.organizationId, params.data.caseId)
    if (items === undefined) return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    return trafficValueLossReportsResponseSchema.parse({ reports: items })
  })

  app.get(TRAFFIC_VALUE_LOSS_REPORT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossReportParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const report = await reports.find(session.user.organizationId, params.data.caseId, params.data.reportId)
    if (report === undefined) return reply.code(404).send(failureBody('not_found', 'Traffic value loss report not found.', requestId))
    return trafficValueLossReportResponseSchema.parse({ report })
  })

  app.get(TRAFFIC_VALUE_LOSS_REPORT_PDF_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const params = trafficValueLossReportParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    try {
      const output = await reports.pdf(session.user.organizationId, params.data.caseId, params.data.reportId)
      if (output === undefined) return reply.code(404).send(failureBody('not_found', 'Traffic value loss report not found.', requestId))
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${trafficValueLossReportFilename(output.report)}"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(output.bytes)
    } catch (error) {
      if (error instanceof TrafficValueLossReportStoreError) return reportStoreError(reply, requestId, error)
      throw error
    }
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
    if (kind === 'version'
      && (body.data as { ruleOverride?: unknown }).ruleOverride !== null
      && !session.user.roles.includes('admin')) {
      return reply.code(403).send(failureBody('forbidden', 'Rule override requires admin role.', requestId))
    }
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
  app.post(TRAFFIC_VALUE_LOSS_VERSION_REPORTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const idemKey = key(request)
    if (idemKey === undefined) return keyRequired(reply, requestId)
    const params = trafficValueLossReportVersionParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(params.error,requestId) }))
    const body = trafficValueLossReportGenerateRequestSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:zodErrorToApiError(body.error,requestId) }))
    const idem = {
      scope: TRAFFIC_VALUE_LOSS_REPORT_GENERATE_SCOPE,
      key: idemKey,
      requestHash: hashRequestBody({ caseId: params.data.caseId, versionId: params.data.versionId, ...body.data }),
    }
    const run = () => reports.generate(
      actor(session, request),
      params.data.caseId,
      params.data.versionId,
      body.data,
      idem,
    )
    try {
      let result
      try { result = await run() } catch (error) {
        if (!isIdempotencyRace(error)) throw error
        result = await run()
      }
      return reply.code(result.status).send(trafficValueLossReportResponseSchema.parse(result.body))
    } catch (error) {
      if (error instanceof TrafficValueLossReportStoreError) return reportStoreError(reply, requestId, error)
      throw error
    }
  })
}
