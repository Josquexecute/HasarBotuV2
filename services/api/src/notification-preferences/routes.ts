import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesResponseSchema, notificationPreferencesUpdateSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { failureBody } from '../errors/failure.js'

export function registerNotificationPreferencesRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const auth = createAuthStore(pool), audit = createAuditService()
  app.get('/api/v1/me/notification-preferences', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const row = (await pool.query('SELECT preferences,version FROM user_notification_preferences WHERE organization_id=$1 AND user_id=$2', [session.user.organizationId, session.user.id])).rows[0]
    return notificationPreferencesResponseSchema.parse({ userId: session.user.id, version: row?.version ?? 0, preferences: row?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES })
  })
  app.put('/api/v1/me/notification-preferences', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const parsed = notificationPreferencesUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) })
    const input = parsed.data
    if (input.expectedUserId !== session.user.id) return reply.code(409).send(failureBody('conflict', 'Hesap değişti. Ayarları yeniden yükleyin.', String(request.id)))
    const saved = await withTransaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`notification-preferences:${session.user.id}`])
      const current = (await db.query('SELECT version FROM user_notification_preferences WHERE organization_id=$1 AND user_id=$2 FOR UPDATE', [session.user.organizationId, session.user.id])).rows[0]
      if ((current?.version ?? 0) !== input.expectedVersion) return undefined
      const row = (await db.query(`INSERT INTO user_notification_preferences(user_id,organization_id,preferences) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences,version=user_notification_preferences.version+1,updated_at=now()
        WHERE user_notification_preferences.organization_id=$2 AND user_notification_preferences.version=$4 RETURNING preferences,version`, [session.user.id, session.user.organizationId, JSON.stringify(input.preferences), input.expectedVersion])).rows[0]
      if (!row) return undefined
      await audit.record(db, { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id), action: 'user.notification_preferences_updated', entityType: 'user', entityId: session.user.id, details: { fromVersion: input.expectedVersion, toVersion: row.version } })
      return notificationPreferencesResponseSchema.parse({ userId: session.user.id, version: row.version, preferences: row.preferences })
    })
    return saved ?? reply.code(409).send(failureBody('conflict', 'Ayarlar başka oturumda değişti. Yeniden yükleyin.', String(request.id)))
  })
}
