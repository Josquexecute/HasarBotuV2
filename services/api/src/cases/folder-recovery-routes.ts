import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { folderRecoveryQuerySchema, folderManagementQuerySchema, folderManagementDecisionSchema, idSchema } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireAnyRole } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { listFolderRecovery, requestFolderCheck } from './folder-recovery-store.js'
import { decideFolderManagement, listFolderManagement } from './folder-management-store.js'

export function registerFolderRecoveryRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const auth = createAuthStore(pool)
  app.get('/api/v1/administration/folder-management', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ['admin'])
    if (!session) return
    const input = folderManagementQuerySchema.safeParse(request.query)
    if (!input.success) return reply.code(400).send(failureBody('validation_error', 'Geçerli bir plaka girin.', String(request.id)))
    return listFolderManagement(pool, session.user.organizationId, input.data.search, input.data.includeRemoved === 'true')
  })
  // This administration route deliberately accepts archived records. Daily case routes keep their archive guard.
  app.post<{ Params: { recordId: string } }>('/api/v1/administration/folder-management/:recordId/decision', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, ['admin'])
    if (!session) return
    const input = folderManagementDecisionSchema.safeParse(request.body)
    const caseId = idSchema.safeParse(request.params.recordId)
    if (!input.success || !caseId.success) return reply.code(400).send(failureBody('validation_error', 'İşlem, güncel kayıt sürümü ve en az üç karakterlik açıklama gerekli.', String(request.id)))
    const result = await decideFolderManagement(pool, { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id) }, caseId.data, input.data)
    if (result === 'not_found') return reply.code(404).send(failureBody('not_found', 'Kayıt bulunamadı.', String(request.id)))
    if (result !== 'ok') return reply.code(409).send(failureBody('conflict', result === 'changed' ? 'Kayıt değişti. Bul ile güncelleyip tekrar deneyin.'
      : result === 'active' ? 'Devam eden klasör veya fotoğraf işlemi var. Tamamlandıktan sonra tekrar deneyin.' : 'Bu işlem kaydın güncel durumuna uygun değil. Listeyi yenileyin.', String(request.id)))
    return reply.code(204).send()
  })
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
