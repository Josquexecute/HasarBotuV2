import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import {
  LABOR_EXCEL_PROFILES_ROUTE,
  LABOR_EXCEL_PROFILE_ROUTE,
  LABOR_EXCEL_PROJECTION_ROUTE,
  failureEnvelopeSchema,
  laborExcelProfileParamsSchema,
  laborExcelProfileSaveRequestSchema,
  laborExcelProjectionParamsSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { LaborExcelProfileError, createLaborExcelProfileStore } from './store.js'

export interface LaborExcelProfileRoutesOptions {
  readonly pool: pg.Pool
}

/** Şablon profili yapılandırmadır; yazma yalnız yönetim yetkisindedir. */
const WRITE_ROLES = ['admin'] as const
const READ_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const

const FAILURE_CODES = {
  PROFILE_NOT_FOUND: 'not_found',
  PROFILE_VERSION_CONFLICT: 'version_conflict',
  PROFILE_FIELDS_INVALID: 'validation_error',
  PROFILE_REASON_REQUIRED: 'validation_error',
  INSURER_NOT_FOUND: 'not_found',
  APPLICATION_NOT_FOUND: 'not_found',
} as const

const projectionQuerySchema = z.strictObject({
  profileId: z.string().uuid(),
})

export function registerLaborExcelProfileRoutes(
  app: FastifyInstance,
  options: LaborExcelProfileRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createLaborExcelProfileStore(options.pool)

  const handle = (reply: FastifyReply, requestId: string, error: unknown) => {
    if (error instanceof LaborExcelProfileError) {
      return reply.code(error.status).send(failureBody(
        FAILURE_CODES[error.code],
        'Labor excel profile request could not be completed.',
        requestId,
      ))
    }
    throw error
  }

  app.get(LABOR_EXCEL_PROFILES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    try {
      const canWrite = session.user.roles.some(
        (role) => (WRITE_ROLES as readonly string[]).includes(role),
      )
      return await store.list(
        { organizationId: session.user.organizationId, userId: session.user.id },
        canWrite,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.post(LABOR_EXCEL_PROFILES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const body = laborExcelProfileSaveRequestSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(body.error, requestId),
      }))
    }
    try {
      const response = await store.save(
        { organizationId: session.user.organizationId, userId: session.user.id },
        null,
        body.data,
      )
      return reply.code(201).send(response)
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.post(LABOR_EXCEL_PROFILE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = laborExcelProfileParamsSchema.safeParse(request.params)
    const body = laborExcelProfileSaveRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const error = params.success ? body.error : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return await store.save(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.profileId,
        body.data,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  /** Salt okunur projeksiyon; dosyaya yazmaz (`written: false`). */
  app.get(LABOR_EXCEL_PROJECTION_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = laborExcelProjectionParamsSchema.safeParse(request.params)
    const query = projectionQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      const error = params.success ? query.error : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return await store.project(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        params.data.applicationId,
        query.data.profileId,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })
}
