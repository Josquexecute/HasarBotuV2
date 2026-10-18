import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { FIELD_PHOTO_CHUNK_BYTES, FIELD_PHOTO_MAX_JPEG_BYTES, fieldUploadInitSchema, fieldPhotoResultSchema } from '@hasarbotu/contracts'
import { requireAnyRole } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createAgentStore } from '../agent/store.js'
import { requireAgent } from '../agent/auth.js'
import { createFieldPhotoStore, FieldPhotoError } from './store.js'

const idSchema = z.uuid()
const leaseSchema = z.strictObject({ leaseToken: z.uuid() })
const roles = ['admin', 'expert', 'case_manager', 'secretary'] as const

export function registerFieldPhotoRoutes(app: FastifyInstance, options: { pool: pg.Pool; directory: string }) {
  const store = createFieldPhotoStore(options.pool, options.directory), auth = createAuthStore(options.pool), agents = createAgentStore(options.pool)
  // Encapsulation keeps binary parsers and typed errors local to this subsystem.
  app.register(async field => {
    field.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
    field.setErrorHandler((error, request, reply) => {
      if (error instanceof FieldPhotoError) return reply.code(error.status).send({ code: error.code })
      if (error instanceof z.ZodError) return reply.code(400).send({ code: 'validation_error' })
      if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) return reply.code(error.statusCode).send({ code: 'invalid_request' })
      request.log.error({ err: error }, 'Field photo operation failed')
      return reply.code(500).send({ code: 'field_photo_unavailable' })
    })
    field.addHook('onSend', async (_request, reply, payload) => { reply.header('cache-control', 'private, no-store'); reply.header('x-content-type-options', 'nosniff'); return payload })
    field.get('/api/v1/field/cases', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      const { q } = z.strictObject({ q: z.string().max(40).default('') }).parse(request.query)
      return { items: await store.search(session.user.organizationId, q) }
    })
    field.get('/api/v1/field/cases/:caseId/photos', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      return { items: await store.list(session.user.organizationId, idSchema.parse((request.params as { caseId: string }).caseId)) }
    })
    field.post('/api/v1/field/cases/:caseId/uploads', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      return store.init({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) },
        idSchema.parse((request.params as { caseId: string }).caseId), fieldUploadInitSchema.parse(request.body))
    })
    field.put('/api/v1/field/uploads/:uploadId/chunk', { bodyLimit: FIELD_PHOTO_CHUNK_BYTES }, async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      const { offset } = z.strictObject({ offset: z.coerce.number().int().nonnegative() }).parse(request.query)
      if (!Buffer.isBuffer(request.body)) throw new FieldPhotoError('invalid_chunk', 400)
      return store.chunk({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) },
        idSchema.parse((request.params as { uploadId: string }).uploadId), offset, request.body)
    })
    field.post('/api/v1/field/uploads/:uploadId/finish', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      return store.finish({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) }, idSchema.parse((request.params as { uploadId: string }).uploadId))
    })
    field.post('/api/v1/field/uploads/:uploadId/retry', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      await store.retry({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) }, idSchema.parse((request.params as { uploadId: string }).uploadId))
      return { ok: true }
    })
    field.post('/api/v1/field/uploads/:uploadId/cancel', async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      await store.cancel({ organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) }, idSchema.parse((request.params as { uploadId: string }).uploadId))
      return { ok: true }
    })
    for (const suffix of ['jpeg', 'original']) field.get(`/api/v1/field/uploads/:uploadId/${suffix}`, async (request, reply) => {
      const session = await requireAnyRole(auth, request, reply, roles); if (!session) return
      const result = await store.content(session.user.organizationId, idSchema.parse((request.params as { uploadId: string }).uploadId), suffix === 'original')
      reply.header('content-type', suffix === 'jpeg' ? 'image/jpeg' : 'application/octet-stream')
      reply.header('content-disposition', `${suffix === 'jpeg' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(result.fileName)}`)
      return reply.send(result.stream)
    })
    field.post('/api/v1/field-agent/uploads/claim', async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      return { job: await store.claim(agent) }
    })
    field.get('/api/v1/field-agent/uploads/:uploadId/original', async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      const token = z.uuid().parse(request.headers['x-upload-lease'])
      reply.header('content-type', 'application/octet-stream')
      return reply.send(await store.originalForAgent(agent, idSchema.parse((request.params as { uploadId: string }).uploadId), token))
    })
    field.post('/api/v1/field-agent/uploads/:uploadId/prepare', async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      await store.prepare(agent, idSchema.parse((request.params as { uploadId: string }).uploadId), fieldPhotoResultSchema.parse(request.body))
      return { ok: true }
    })
    field.put('/api/v1/field-agent/uploads/:uploadId/jpeg', { bodyLimit: FIELD_PHOTO_MAX_JPEG_BYTES }, async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      const token = z.uuid().parse(request.headers['x-upload-lease'])
      if (!Buffer.isBuffer(request.body)) throw new FieldPhotoError('invalid_jpeg', 400)
      await store.jpeg(agent, idSchema.parse((request.params as { uploadId: string }).uploadId), token, request.body)
      return { ok: true }
    })
    field.post('/api/v1/field-agent/uploads/:uploadId/complete', async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      await store.complete(agent, idSchema.parse((request.params as { uploadId: string }).uploadId), leaseSchema.parse(request.body).leaseToken, String(request.id))
      return { ok: true }
    })
    field.post('/api/v1/field-agent/uploads/:uploadId/failure', async (request, reply) => {
      const agent = await requireAgent(agents, request, reply); if (!agent) return
      const body = z.strictObject({ leaseToken: z.uuid(), code: z.enum(['storage_unavailable','case_not_fresh','unsupported_image','image_too_large','image_conversion_failed','case_location_changed','photo_write_failed']), retryable: z.boolean() }).parse(request.body)
      await store.reportFailure(agent, idSchema.parse((request.params as { uploadId: string }).uploadId), body.leaseToken, body.code, body.retryable)
      return { ok: true }
    })
  })
}
