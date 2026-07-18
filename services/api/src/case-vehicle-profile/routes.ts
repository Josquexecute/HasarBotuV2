import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_VEHICLE_PROFILE_ROUTE,
  caseVehicleProfileParamsSchema,
  caseVehicleProfileSaveRequestSchema,
  failureEnvelopeSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { CaseVehicleProfileError, createCaseVehicleProfileStore } from './store.js'

export interface CaseVehicleProfileRoutesOptions {
  readonly pool: pg.Pool
}

const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const READ_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const

const FAILURE_CODES = {
  CASE_NOT_FOUND: 'not_found',
  CASE_CLOSED: 'conflict',
  PROFILE_VERSION_CONFLICT: 'version_conflict',
  PROFILE_FIELDS_INVALID: 'validation_error',
  PROFILE_REASON_REQUIRED: 'validation_error',
} as const

export function registerCaseVehicleProfileRoutes(
  app: FastifyInstance,
  options: CaseVehicleProfileRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseVehicleProfileStore(options.pool)

  const handle = (reply: FastifyReply, requestId: string, error: unknown) => {
    if (error instanceof CaseVehicleProfileError) {
      return reply.code(error.status).send(failureBody(
        FAILURE_CODES[error.code],
        'Vehicle profile request could not be completed.',
        requestId,
      ))
    }
    throw error
  }

  app.get(CASE_VEHICLE_PROFILE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = caseVehicleProfileParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(params.error, requestId),
      }))
    }
    const canEdit = session.user.roles.some((role) => (WRITE_ROLES as readonly string[]).includes(role))
    try {
      return await store.read(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        canEdit,
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })

  app.put(CASE_VEHICLE_PROFILE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = caseVehicleProfileParamsSchema.safeParse(request.params)
    const body = caseVehicleProfileSaveRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const error = params.success ? body.error : params.error
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(error as never, requestId),
      }))
    }
    try {
      return await store.save(
        { organizationId: session.user.organizationId, userId: session.user.id },
        params.data.caseId,
        {
          fields: body.data.fields,
          expectedVersion: body.data.expectedVersion,
          reason: body.data.reason,
        },
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })
}
