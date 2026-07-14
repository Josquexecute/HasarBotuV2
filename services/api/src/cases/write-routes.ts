import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  CASES_ROUTE,
  CASE_DETAIL_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseCreateRequestSchema,
  caseDetailParamsSchema,
  caseDetailResponseSchema,
  caseUpdateRequestSchema,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  zodErrorToApiError,
  type ApiErrorCode,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { requireSession } from '../auth/guard.js'
import { createAuthStore } from './../auth/store.js'
import { createCasesWriteStore, hashRequestBody, ReferenceCheckError } from './write-store.js'

export interface CasesWriteRoutesOptions {
  readonly pool: pg.Pool
}

const CREATE_SCOPE = 'cases.create'

function sendValidation(reply: FastifyReply, requestId: string, path: string, code: string): void {
  void reply.code(400).send(
    failureEnvelopeSchema.parse({
      ok: false,
      error: {
        code: 'validation_error' satisfies ApiErrorCode,
        message: 'Request validation failed.',
        fieldErrors: [{ path, code, message: 'Field value is not allowed.' }],
        requestId,
      },
    }),
  )
}

/**
 * Cases yazma uclari (Paket 09): olusturma zorunlu Idempotency-Key ile,
 * guncelleme expectedVersion optimistic locking ile calisir. Her basarili
 * yazma A1 audit kaydi uretir; kapanis/yeniden acma bu pakette YOKTUR.
 */
export function registerCasesWriteRoutes(app: FastifyInstance, options: CasesWriteRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const writeStore = createCasesWriteStore(options.pool)

  app.post(CASES_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const keyHeader = request.headers[IDEMPOTENCY_KEY_HEADER]
    const keyParsed = idempotencyKeySchema.safeParse(
      Array.isArray(keyHeader) ? keyHeader[0] : keyHeader,
    )
    if (!keyParsed.success) {
      sendValidation(reply, requestId, IDEMPOTENCY_KEY_HEADER, 'idempotency_key_required')
      return
    }

    const parsed = caseCreateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    const actor = {
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
    }
    const requestHash = hashRequestBody(parsed.data)

    const replay = await writeStore.findIdempotent(actor.organizationId, CREATE_SCOPE, keyParsed.data)
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply
          .code(409)
          .send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      return reply.code(replay.responseStatus).send(replay.responseBody)
    }

    try {
      const item = await writeStore.createCase(actor, parsed.data, {
        scope: CREATE_SCOPE,
        key: keyParsed.data,
        requestHash,
        buildResponse: (created) => caseDetailResponseSchema.parse({ case: created }),
      })
      if (item === null) {
        // Es zamanli ayni anahtar: saklanan sonucu yeniden oku.
        const raced = await writeStore.findIdempotent(actor.organizationId, CREATE_SCOPE, keyParsed.data)
        if (raced !== undefined && raced.requestHash === requestHash) {
          return reply.code(raced.responseStatus).send(raced.responseBody)
        }
        return reply
          .code(409)
          .send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      }
      return reply.code(201).send(caseDetailResponseSchema.parse({ case: item }))
    } catch (error) {
      if (error instanceof ReferenceCheckError) {
        sendValidation(reply, requestId, error.field, error.code)
        return
      }
      throw error
    }
  })

  app.patch(CASE_DETAIL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return

    const params = caseDetailParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }),
      )
    }
    const parsed = caseUpdateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(
        failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }),
      )
    }

    try {
      const outcome = await writeStore.updateCase(
        {
          organizationId: session.user.organizationId,
          actorUserId: session.user.id,
          requestId,
        },
        params.data.caseId,
        parsed.data,
      )
      if (outcome.kind === 'not_found') {
        return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      }
      if (outcome.kind === 'version_conflict') {
        return reply
          .code(409)
          .send(failureBody('version_conflict', 'Case was modified by another operation.', requestId))
      }
      return caseDetailResponseSchema.parse({ case: outcome.item })
    } catch (error) {
      if (error instanceof ReferenceCheckError) {
        sendValidation(reply, requestId, error.field, error.code)
        return
      }
      throw error
    }
  })
}
