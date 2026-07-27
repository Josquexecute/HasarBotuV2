import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASE_VEHICLE_OWNERS_ROUTE,
  caseVehicleOwnersParamsSchema,
  caseVehicleOwnersSaveRequestSchema,
  failureEnvelopeSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { CaseVehicleOwnersError, createCaseVehicleOwnersStore } from './store.js'

export interface CaseVehicleOwnersRoutesOptions {
  readonly pool: pg.Pool
}

const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const READ_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const

const FAILURE_CODES = {
  CASE_NOT_FOUND: 'not_found',
  CASE_CLOSED: 'conflict',
  OWNERS_SET_VERSION_CONFLICT: 'version_conflict',
  OWNERS_INVALID: 'validation_error',
} as const

export function registerCaseVehicleOwnersRoutes(
  app: FastifyInstance,
  options: CaseVehicleOwnersRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseVehicleOwnersStore(options.pool)

  const handle = (reply: FastifyReply, requestId: string, error: unknown) => {
    if (error instanceof CaseVehicleOwnersError) {
      return reply.code(error.status).send(failureBody(
        FAILURE_CODES[error.code],
        'Vehicle owners request could not be completed.',
        requestId,
      ))
    }
    throw error
  }

  app.get(CASE_VEHICLE_OWNERS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = caseVehicleOwnersParamsSchema.safeParse(request.params)
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

  app.put(CASE_VEHICLE_OWNERS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = caseVehicleOwnersParamsSchema.safeParse(request.params)
    const body = caseVehicleOwnersSaveRequestSchema.safeParse(request.body)
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
        { owners: body.data.owners, expectedSetVersion: body.data.expectedSetVersion },
      )
    } catch (error) {
      return handle(reply, requestId, error)
    }
  })
}
