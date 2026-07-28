import type { FastifyInstance, FastifyReply } from 'fastify'
import type pg from 'pg'
import {
  DOCUMENTS_ROUTE,
  DOCUMENT_DETAIL_ROUTE,
  DOCUMENT_REGISTER_SCOPE,
  PHOTOS_ROUTE,
  PHOTO_DETAIL_ROUTE,
  PHOTO_REGISTER_SCOPE,
  IDEMPOTENCY_KEY_HEADER,
  caseScopedParamsSchema,
  documentDetailResponseSchema,
  documentParamsSchema,
  documentRegisterResponseSchema,
  documentsListResponseSchema,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  metadataListQuerySchema,
  photoDetailResponseSchema,
  photoParamsSchema,
  photoRegisterResponseSchema,
  photosListResponseSchema,
  registerDocumentRequestSchema,
  registerPhotoRequestSchema,
  zodErrorToApiError,
  type ApiErrorCode,
  type RoleCode,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody } from '../db/idempotency.js'
import { createDocumentsStore } from './store.js'

/** HB-011: belge/fotoğraf kaydı case-operations notu/görevi ile aynı sınıf clerical yazma işidir. */
const WRITE_ROLES = ['admin', 'expert', 'case_manager', 'secretary'] as const satisfies readonly RoleCode[]

export interface DocumentRoutesOptions {
  readonly pool: pg.Pool
}

function sendFieldError(reply: FastifyReply, requestId: string, path: string, code: string): void {
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

function normalizeQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw }
  for (const key of ['page', 'pageSize']) {
    const value = normalized[key]
    if (typeof value === 'string' && /^\d+$/.test(value)) normalized[key] = Number(value)
  }
  return normalized
}

function pageInfo(page: number, pageSize: number, totalItems: number) {
  return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }
}

/**
 * Belge/fotoğraf metadata uçları (Paket 13). Registration oturum + zorunlu
 * Idempotency-Key ile; kayıt daima `pending` (istemci `ready` set edemez).
 * Okuma uçları oturum + kiracı kapsamlıdır. Mutlak yol hiçbir yanıta girmez.
 */
export function registerDocumentRoutes(app: FastifyInstance, options: DocumentRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const store = createDocumentsStore(options.pool)

  function readIdempotencyKey(request: { headers: Record<string, unknown> }): string | undefined {
    const header = request.headers[IDEMPOTENCY_KEY_HEADER]
    const parsed = idempotencyKeySchema.safeParse(Array.isArray(header) ? header[0] : header)
    return parsed.success ? parsed.data : undefined
  }

  app.post(DOCUMENTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return

    const params = caseScopedParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const key = readIdempotencyKey(request)
    if (key === undefined) {
      sendFieldError(reply, requestId, IDEMPOTENCY_KEY_HEADER, 'idempotency_key_required')
      return
    }
    const parsed = registerDocumentRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    }

    const outcome = await store.registerDocument(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      params.data.caseId,
      parsed.data,
      { scope: DOCUMENT_REGISTER_SCOPE, key, requestHash: hashRequestBody(parsed.data) },
    )
    switch (outcome.kind) {
      case 'validation':
        sendFieldError(reply, requestId, outcome.field, outcome.code)
        return
      case 'not_found':
        return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      case 'unknown_reference':
        sendFieldError(reply, requestId, outcome.field, 'unknown_reference')
        return
      case 'version_conflict':
        return reply.code(409).send(failureBody('version_conflict', 'Document was modified by another operation.', requestId))
      case 'idempotency_conflict':
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      case 'replay':
        return reply.code(outcome.status).send(outcome.body)
      case 'ok':
        return reply.code(201).send(documentRegisterResponseSchema.parse(outcome.response))
    }
  })

  app.get(DOCUMENTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = caseScopedParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const query = metadataListQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!query.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(query.error, requestId) }))
    }
    const result = await store.listDocuments(session.user.organizationId, params.data.caseId, query.data)
    return documentsListResponseSchema.parse({
      items: result.items,
      pageInfo: pageInfo(query.data.page, query.data.pageSize, result.totalItems),
    })
  })

  app.get(DOCUMENT_DETAIL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = documentParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const detail = await store.getDocumentDetail(session.user.organizationId, params.data.documentId)
    if (detail === undefined) return reply.code(404).send(failureBody('not_found', 'Document not found.', requestId))
    return documentDetailResponseSchema.parse({ document: detail })
  })

  app.post(PHOTOS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAnyRole(authStore, request, reply, WRITE_ROLES)
    if (session === undefined) return
    const params = caseScopedParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const key = readIdempotencyKey(request)
    if (key === undefined) {
      sendFieldError(reply, requestId, IDEMPOTENCY_KEY_HEADER, 'idempotency_key_required')
      return
    }
    const parsed = registerPhotoRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    }

    const outcome = await store.registerPhoto(
      { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId },
      params.data.caseId,
      parsed.data,
      { scope: PHOTO_REGISTER_SCOPE, key, requestHash: hashRequestBody(parsed.data) },
    )
    switch (outcome.kind) {
      case 'validation':
        sendFieldError(reply, requestId, outcome.field, outcome.code)
        return
      case 'not_found':
        return reply.code(404).send(failureBody('not_found', 'Case not found.', requestId))
      case 'unknown_reference':
        sendFieldError(reply, requestId, outcome.field, 'unknown_reference')
        return
      case 'idempotency_conflict':
        return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
      case 'replay':
        return reply.code(outcome.status).send(outcome.body)
      case 'ok':
        return reply.code(201).send(photoRegisterResponseSchema.parse(outcome.response))
    }
  })

  app.get(PHOTOS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = caseScopedParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const query = metadataListQuerySchema.safeParse(normalizeQuery(request.query as Record<string, unknown>))
    if (!query.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(query.error, requestId) }))
    }
    const result = await store.listPhotos(session.user.organizationId, params.data.caseId, query.data)
    return photosListResponseSchema.parse({
      items: result.items,
      pageInfo: pageInfo(query.data.page, query.data.pageSize, result.totalItems),
    })
  })

  app.get(PHOTO_DETAIL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return
    const params = photoParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const photo = await store.getPhoto(session.user.organizationId, params.data.photoId)
    if (photo === undefined) return reply.code(404).send(failureBody('not_found', 'Photo not found.', requestId))
    return photoDetailResponseSchema.parse({ photo })
  })
}
