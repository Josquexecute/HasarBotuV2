import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { folderRecoveryQuerySchema } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { listFolderRecovery, requestFolderCheck } from './folder-recovery-store.js'

export function registerFolderRecoveryRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const auth = createAuthStore(pool)
  app.get('/api/v1/administration/folder-recovery', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ['admin'])
    if (!session) return
    const input = folderRecoveryQuerySchema.safeParse(request.query)
    if (!input.success) return reply.code(400).send(failureBody('validation_error', 'Plaka girin.', String(request.id)))
    return listFolderRecovery(pool, session.user.organizationId, input.data.search)
  })
  app.post('/api/v1/administration/folder-recovery/check', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ['admin'])
    if (!session) return
    if (request.body !== undefined && (request.body === null || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length)) {
      return reply.code(400).send(failureBody('validation_error', 'Bu işlem dosya veya klasör seçimi kabul etmez.', String(request.id)))
    }
    return reply.code(202).send(await requestFolderCheck(pool, {
      organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id),
    }))
  })
}
