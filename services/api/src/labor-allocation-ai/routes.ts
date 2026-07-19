import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  CASE_LABOR_ALLOCATION_ANALYZE_ROUTE,
  CASE_LABOR_ALLOCATION_APPLICATIONS_ROUTE,
  CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE,
  CASE_LABOR_ALLOCATION_APPLY_ROUTE,
  CASE_LABOR_ALLOCATION_CANCEL_ROUTE,
  CASE_LABOR_ALLOCATION_RUN_ROUTE,
  CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  laborAllocationAnalyzeRequestSchema,
  laborAllocationApplyPreviewRequestSchema,
  laborAllocationApplyRequestSchema,
  laborAllocationCaseParamsSchema,
  laborAllocationRunParamsSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import {
  LaborAllocationError,
  createLaborAllocationStore,
} from './store.js'
import type { LaborAllocationProviderRegistry } from './providers.js'

export interface LaborAllocationRoutesOptions {
  readonly pool: pg.Pool
  readonly providers: LaborAllocationProviderRegistry
  readonly providerId?: string
}

/** Analiz ve önizleme yazma niyeti taşır; salt okunur roller dışlanır. */
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const READ_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const

export function registerLaborAllocationRoutes(
  app: FastifyInstance,
  options: LaborAllocationRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createLaborAllocationStore(options.pool, options.providers, options.providerId)

  /** Alan koduna göre kanonik hata kodu; sağlayıcı/serbest metin sızdırılmaz. */
  const FAILURE_CODES = {
    CASE_NOT_FOUND: 'not_found',
    CASE_CLOSED: 'conflict',
    LABOR_SHEET_NOT_FOUND: 'not_found',
    SHEET_VERSION_STALE: 'version_conflict',
    RUN_NOT_FOUND: 'not_found',
    RUN_NOT_REVIEWABLE: 'conflict',
    RUN_STALE: 'version_conflict',
    LINE_SELECTION_INVALID: 'validation_error',
    EGRESS_CONFIRMATION_REQUIRED: 'conflict',
    RUN_ALREADY_APPLIED: 'conflict',
    APPLY_LINES_INVALID: 'validation_error',
    IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
    // Paket 62: ilerleme ve iptal.
    ANALYSIS_ALREADY_RUNNING: 'conflict',
    RUN_NOT_CANCELLABLE: 'conflict',
  } as const

  const handle = (reply: import('fastify').FastifyReply, requestId: string, error: unknown) => {
    if (error instanceof LaborAllocationError) {
      return reply.code(error.status).send(failureBody(
        FAILURE_CODES[error.code],
        'Labor allocation request could not be completed.',
        requestId,
      ))
    }
    throw error
  }

  app.get(CASE_LABOR_ALLOCATION_WORKSPACE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborAllocationCaseParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    try {
      return await store.workspace(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.get(CASE_LABOR_ALLOCATION_RUN_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborAllocationRunParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    try {
      return { run: await store.getRun(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        params.data.runId,
      ) }
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.post(CASE_LABOR_ALLOCATION_ANALYZE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborAllocationCaseParamsSchema.safeParse(request.params)
    const body = laborAllocationAnalyzeRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const error = params.success ? body.error : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return { run: await store.analyze(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        body.data,
      ) }
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  /**
   * Paket 58 — seçilen satırları föye uygular.
   *
   * Bu, AI çıktısının föyü gerçekten değiştirdiği TEK uçtur ve açık kullanıcı
   * onayı (`confirmed: true`) ile idempotency anahtarı zorunludur.
   */
  app.post(CASE_LABOR_ALLOCATION_APPLY_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborAllocationRunParamsSchema.safeParse(request.params)
    const body = laborAllocationApplyRequestSchema.safeParse(request.body)
    const key = idempotencyKeySchema.safeParse(request.headers[IDEMPOTENCY_KEY_HEADER])
    if (!params.success || !body.success || !key.success) {
      const error = params.success ? (body.success ? key.error : body.error) : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return await store.apply(
        {
          organizationId: session.user.organizationId,
          userId: session.user.id,
          requestId,
        },
        params.data.caseId,
        params.data.runId,
        body.data,
        key.data,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  /**
   * Paket 62 — aktif analizi iptal etmeyi DENER.
   *
   * Yanıt her zaman güncel run durumudur: süreç içi abort denenemiyorsa durum
   * `cancel_requested` kalır ve kullanıcıya "iptal edildi" denmez.
   */
  app.post(CASE_LABOR_ALLOCATION_CANCEL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborAllocationRunParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    try {
      return { run: await store.cancel(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        params.data.runId,
      ) }
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.get(CASE_LABOR_ALLOCATION_APPLICATIONS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborAllocationCaseParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    try {
      return await store.listApplications(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.post(CASE_LABOR_ALLOCATION_APPLY_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborAllocationRunParamsSchema.safeParse(request.params)
    const body = laborAllocationApplyPreviewRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const error = params.success ? body.error : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return await store.applyPreview(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        params.data.runId,
        body.data,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })
}
