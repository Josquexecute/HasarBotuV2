import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  CASE_KASCO_MANDATORY_CHECK_GATE_ROUTE,
  CASE_KASCO_MANDATORY_CHECK_HISTORY_ROUTE,
  CASE_KASCO_MANDATORY_CHECK_ROUTE,
  failureEnvelopeSchema,
  kascoMandatoryCheckConfirmRequestSchema,
  kascoMandatoryCheckGateParamsSchema,
  kascoMandatoryCheckGateResponseSchema,
  kascoMandatoryCheckHistoryResponseSchema,
  kascoMandatoryCheckParamsSchema,
  kascoMandatoryCheckResponseSchema,
  zodErrorToApiError,
  type ApiErrorCode,
  type RoleCode,
} from '@hasarbotu/contracts'
import { requireAnyRole } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { failureBody } from '../errors/failure.js'
import { createKascoMandatoryCheckStore } from './store.js'

/** Tüm roller okuyabilir (labor-workbook-apply ile aynı ilke); onay/kayıt
 * yalnız eksper seviyesi rollerdedir (storage/file-operations WRITE_ROLES
 * ile aynı sınır -- kanıtlı bir dosya/kimlik bulgusu kaydetmek fiziksel bir
 * kritik işlem kadar sorumluluk taşır). */
const READ_ROLES = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const satisfies readonly RoleCode[]
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const satisfies readonly RoleCode[]

function canWrite(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number]))
}

const ERROR_CODES: Record<string, ApiErrorCode> = {
  not_applicable_case_type: 'conflict',
  case_closed: 'conflict',
  invalid_result_for_check: 'validation_error',
  evidence_not_verified: 'conflict',
  version_conflict: 'version_conflict',
}
/** HTTP durum kodu, hata anlamıyla (validation=400, conflict/version=409) tutarlı olmalıdır. */
const HTTP_STATUS_CODES: Record<string, number> = {
  not_applicable_case_type: 409,
  case_closed: 409,
  invalid_result_for_check: 400,
  evidence_not_verified: 409,
  version_conflict: 409,
}

export interface KascoMandatoryCheckRoutesOptions {
  readonly pool: pg.Pool
}

export function registerKascoMandatoryCheckRoutes(app: FastifyInstance, options: KascoMandatoryCheckRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  const store = createKascoMandatoryCheckStore(options.pool)

  app.get(CASE_KASCO_MANDATORY_CHECK_GATE_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = kascoMandatoryCheckGateParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const gate = await store.getGate(session.user.organizationId, params.data.caseId, canWrite(session.user.roles))
    if (gate === undefined) return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    return kascoMandatoryCheckGateResponseSchema.parse({ gate })
  })

  app.get(CASE_KASCO_MANDATORY_CHECK_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = kascoMandatoryCheckParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const gate = await store.getGate(session.user.organizationId, params.data.caseId, canWrite(session.user.roles))
    if (gate === undefined) return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    const check = gate.checks.find((item) => item.checkCode === params.data.checkCode)
    if (check === undefined) return reply.code(404).send(failureBody('not_found', 'Check not found.', requestId))
    return kascoMandatoryCheckResponseSchema.parse({ check })
  })

  app.get(CASE_KASCO_MANDATORY_CHECK_HISTORY_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, READ_ROLES)
    if (session === undefined) return
    const params = kascoMandatoryCheckParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const items = await store.getHistory(session.user.organizationId, params.data.caseId, params.data.checkCode)
    if (items === undefined) return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    return kascoMandatoryCheckHistoryResponseSchema.parse({ items })
  })

  app.put(CASE_KASCO_MANDATORY_CHECK_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = kascoMandatoryCheckParamsSchema.safeParse(request.params)
    const body = kascoMandatoryCheckConfirmRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const error = !params.success ? params.error : (body as { success: false; error: unknown }).error
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(error as never, requestId) }))
    }
    const outcome = await store.confirmCheck(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      params.data.caseId,
      params.data.checkCode,
      body.data,
    )
    if (outcome.kind === 'not_found') {
      return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
    }
    if (outcome.kind !== 'ok') {
      return reply.code(HTTP_STATUS_CODES[outcome.kind] ?? 400).send(
        failureBody(ERROR_CODES[outcome.kind] ?? 'conflict', 'Kasco mandatory check could not be confirmed.', requestId),
      )
    }
    return kascoMandatoryCheckResponseSchema.parse({ check: outcome.check })
  })
}
