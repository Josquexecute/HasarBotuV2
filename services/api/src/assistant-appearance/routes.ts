import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assistantAppearanceResponseSchema, assistantAppearanceUpdateSchema, DEFAULT_ASSISTANT_APPEARANCE, zodErrorToApiError } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { sanitizeAssistantImage } from './image.js'
import { isLegacyDesktop } from '../legacy-desktop-responses.js'

export function registerAssistantAppearanceRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const auth = createAuthStore(pool), audit = createAuditService()
  app.get('/api/v1/me/assistant-appearance', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const row = (await pool.query('SELECT appearance,version FROM user_assistant_preferences WHERE organization_id=$1 AND user_id=$2', [session.user.organizationId, session.user.id])).rows[0]
    return assistantAppearanceResponseSchema.parse({ userId: session.user.id, version: row?.version ?? 0, appearance: row?.appearance ?? DEFAULT_ASSISTANT_APPEARANCE })
  })
  app.put('/api/v1/me/assistant-appearance', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const parsed = assistantAppearanceUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) })
    const input = parsed.data
    if (input.expectedUserId !== session.user.id) return reply.code(409).send(failureBody('conflict', 'Hesap değişti. Ayarları yeniden yükleyin.', String(request.id)))
    if (input.appearance.customImage) {
      try { input.appearance.customImage = await sanitizeAssistantImage(input.appearance.customImage) }
      catch { return reply.code(400).send(failureBody('validation_error', 'Görsel geçersiz. PNG, JPG veya WebP görselini yeniden seçin.', String(request.id))) }
    }
    const saved = await withTransaction(pool, async (db) => {
      const current = (await db.query('SELECT appearance,version FROM user_assistant_preferences WHERE organization_id=$1 AND user_id=$2 FOR UPDATE', [session.user.organizationId, session.user.id])).rows[0]
      if ((current?.version ?? 0) !== input.expectedVersion) return undefined
      // Older clients omit this field; only explicit null resets automatic eyes.
      if (!Object.hasOwn(input.appearance, 'eyeColor') && current?.appearance?.eyeColor !== undefined) {
        input.appearance.eyeColor = current.appearance.eyeColor
      }
      if (isLegacyDesktop(request.headers['user-agent']) && !Object.hasOwn(input.appearance, 'customImage') && current?.appearance?.customImage !== undefined) {
        input.appearance.customImage = current.appearance.customImage
      }
      const result = await db.query(`INSERT INTO user_assistant_preferences(user_id,organization_id,appearance) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET appearance=excluded.appearance,version=user_assistant_preferences.version+1,updated_at=now()
        WHERE user_assistant_preferences.organization_id=$2 AND user_assistant_preferences.version=$4 RETURNING appearance,version`, [session.user.id, session.user.organizationId, JSON.stringify(input.appearance), input.expectedVersion])
      const row = result.rows[0]
      if (!row) return undefined
      await audit.record(db, { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id), action: 'user.assistant_appearance_updated', entityType: 'user', entityId: session.user.id,
        details: { fromVersion: input.expectedVersion, toVersion: row.version } })
      return assistantAppearanceResponseSchema.parse({ userId: session.user.id, version: row.version, appearance: row.appearance })
    })
    return saved ?? reply.code(409).send(failureBody('conflict', 'Ayarlar başka bir oturumda değişti. Yeniden yükleyin.', String(request.id)))
  })
}
