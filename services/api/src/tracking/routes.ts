import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { applicationNumberSchema, inferTrackedDocumentType, trackedDocumentTypeSchema, trackingFileSchema, trackingSnapshotSchema, trackingInboxSchema, tramerCommandSchema } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { requireAgent } from '../agent/auth.js'
import { createAgentStore } from '../agent/store.js'
import { failureBody } from '../errors/failure.js'
import { canManageTracking, canWriteTracking, observeFile, reconcileFiles, reviewDocument, reviewSbm, TrackingError, tramerCommand } from './store.js'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { registerTrackingResponseCompression } from './response-compression.js'
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema } from '@hasarbotu/contracts'
import { resolveFileLocations } from '../storage/file-location.js'

export function registerTrackingRoutes(app: FastifyInstance, options: { pool: pg.Pool; googleEnabled: boolean; automaticSbmEnabled: boolean }) {
  const { pool } = options
  const auth = createAuthStore(pool)
  const agents = createAgentStore(pool)
  const audit = createAuditService()
  // Encapsulation keeps these errors local to this feature.
  void app.register(async (routes) => {
    registerTrackingResponseCompression(routes)
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof TrackingError) return reply.code(error.status).send(failureBody(error.status === 403 ? 'forbidden' : error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : 'validation_error',error.message,String(request.id)))
      if (error instanceof z.ZodError) return reply.code(400).send(failureBody('validation_error','İstek alanları geçersiz.',String(request.id)))
      throw error
    })
    routes.get('/api/v1/tracking', async (request, reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const query = z.object({ caseId: z.string().uuid().optional(),includeCompleted: z.enum(['true','false']).optional(),includeNotifications: z.enum(['true','false']).optional() }).parse(request.query)
      const org = session.user.organizationId
      if (query.caseId && await auth.isCaseArchived(org, query.caseId)) throw new TrackingError(404, 'Dosya bulunamadı.')
      const user = session.user.id
      const manage = canManageTracking(session)
      // Deliver events from cases that acquired an owner after the event occurred.
      await pool.query(`UPDATE tracking_notifications n SET recipient_user_id=c.responsible_user_id
        FROM cases c WHERE n.case_id=c.id AND n.organization_id=$1 AND n.recipient_user_id IS NULL AND c.responsible_user_id IS NOT NULL`, [org])
      const [tramer,documents,notifications,connections,reviews,users,history,services] = await Promise.all([
        pool.query(`SELECT t.id,t.case_id AS "caseId",c.plate,c.office_number AS "officeNumber",t.assigned_user_id AS "assignedUserId",u.display_name AS "assignedName",
          t.application_number AS "applicationNumber",t.status,t.result_text AS "resultText",t.version,t.updated_at AS "updatedAt",((t.assigned_user_id=$3 OR $4) AND $5) AS "canEdit"
          FROM tramer_requests t JOIN cases c ON c.id=t.case_id JOIN users u ON u.id=t.assigned_user_id
          WHERE t.organization_id=$1 AND NOT c.is_archived AND ($2::uuid IS NULL OR t.case_id=$2)
          AND ($2::uuid IS NOT NULL OR (t.assigned_user_id=$3 AND ($6 OR t.status IN ('entry_pending','result_pending'))))
          ORDER BY t.updated_at DESC,t.id`, [org,query.caseId ?? null,user,manage,canWriteTracking(session),query.includeCompleted === 'true']),
        pool.query(`SELECT o.id,f.case_id AS "caseId",c.plate,c.office_number AS "officeNumber",o.file_name AS "fileName",f.relative_path AS "relativePath",o.status,o.document_type AS "documentType",o.observed_at AS "observedAt",
          f.case_id,f.storage_root_key,f.relative_path,o.observed_at AS created_at,l.storage_root_key AS "caseStorageRootKey",
          l.relative_path AS "caseRelativePath",(c.responsible_user_id=$3 AND o.status='pending') AS "canReview"
          FROM document_observations o JOIN tracked_files f ON f.id=o.file_id AND f.revision=o.revision JOIN cases c ON c.id=f.case_id
          JOIN case_locations l ON l.organization_id=f.organization_id AND l.case_id=f.case_id
          WHERE f.organization_id=$1 AND NOT c.is_archived AND f.available AND ($2::uuid IS NULL OR f.case_id=$2)
          AND ($2::uuid IS NOT NULL OR (c.responsible_user_id=$3 AND o.status='pending')) ORDER BY o.observed_at DESC`, [org,query.caseId ?? null,user]),
        query.includeNotifications === 'false' ? Promise.resolve({ rows: [] }) : pool.query(`SELECT n.id,n.case_id AS "caseId",c.plate,c.office_number AS "officeNumber",n.title,n.kind,n.read_at AS "readAt",n.presented_at AS "presentedAt",n.created_at AS "createdAt"
          FROM tracking_notifications n JOIN cases c ON c.id=n.case_id WHERE n.organization_id=$1 AND NOT c.is_archived AND c.responsible_user_id=$2
          AND ($3::uuid IS NULL OR n.case_id=$3) ORDER BY (n.read_at IS NULL) DESC,n.created_at DESC`, [org,user,query.caseId ?? null]),
        pool.query(`SELECT id,email,status,last_success_at AS "lastSuccessAt",last_error AS "lastError" FROM mail_connections WHERE organization_id=$1 AND ($2 OR connected_by=$3) ORDER BY email`, [org,manage,user]),
        pool.query(`SELECT m.id,m.application_number AS "applicationNumber",m.result_text AS "resultText",m.reason,c.email,m.received_at AS "receivedAt",
          t.case_id AS "caseId",cs.plate,cs.office_number AS "officeNumber",m.result_status AS "resultStatus",u.display_name AS "assignedName"
          FROM sbm_messages m JOIN mail_connections c ON c.id=m.connection_id
          LEFT JOIN tramer_requests t ON t.id=m.tramer_id LEFT JOIN cases cs ON cs.id=t.case_id LEFT JOIN users u ON u.id=t.assigned_user_id
          WHERE m.organization_id=$1 AND m.status='review' AND $2 AND ($3::uuid IS NULL OR t.case_id=$3)
          ORDER BY m.received_at DESC,m.id`, [org,manage,query.caseId ?? null]),
        pool.query(`SELECT id,display_name AS "displayName" FROM users WHERE organization_id=$1 AND status='active'
          AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=users.id AND r.code IN ('admin','expert','case_manager','secretary')) ORDER BY display_name`, [org]),
        query.caseId ? pool.query(`SELECT a.id,a.action,u.display_name AS actor,a.occurred_at AS "occurredAt",a.details
          FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.organization_id=$1 AND a.resource_id=$2 AND a.action LIKE 'tracking.%' ORDER BY a.occurred_at DESC`, [org,query.caseId]) : Promise.resolve({ rows: [] }),
        pool.query(`SELECT kind,CASE WHEN last_attempt_at < now()-interval '3 minutes' THEN 'stale' WHEN error_code IS NOT NULL AND error_code <> 'scan_in_progress' THEN 'error' ELSE 'running' END AS status,
          last_attempt_at AS "lastAttemptAt",last_success_at AS "lastSuccessAt" FROM tracking_health WHERE organization_id=$1 ORDER BY kind,source_id`, [org]),
      ])
      const effectiveDocuments = (await resolveFileLocations(pool,org,documents.rows)).filter(r =>
        r.storage_root_key === r.caseStorageRootKey && r.relative_path.startsWith(r.caseRelativePath + '/'))
      return trackingSnapshotSchema.parse(JSON.parse(JSON.stringify({ tramer: tramer.rows, documents: effectiveDocuments.map((r) => ({ ...r,relativePath: r.relative_path,documentType: r.documentType ?? inferTrackedDocumentType(r.relative_path.slice(r.caseRelativePath.length + 1)),canReview: r.canReview === true && canWriteTracking(session) })), notifications: notifications.rows, mailConnections: connections.rows, reviews: reviews.rows, users: users.rows, history: history.rows, services: services.rows, canManage: manage, googleEnabled: options.googleEnabled, automaticSbmEnabled: options.automaticSbmEnabled })))
    })
    routes.post('/api/v1/tracking/cases/:caseId/tramer', async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const { caseId } = z.object({ caseId: z.string().uuid() }).parse(request.params)
      await tramerCommand(pool,session,caseId,tramerCommandSchema.parse(request.body))
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/documents/:id/review', async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const input = z.object({ status: z.enum(['approved','rejected']), documentType: trackedDocumentTypeSchema, note: z.string().trim().max(2000) }).strict().parse(request.body)
      await reviewDocument(pool,session,id,input)
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/sbm/:id/review', async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      await reviewSbm(pool,session,id,z.discriminatedUnion('action',[
        z.object({ action: z.literal('apply'), applicationNumber: applicationNumberSchema, resultStatus: z.enum(['completed','cancelled']), note: z.string().trim().min(1).max(4000) }).strict(),
        z.object({ action: z.literal('dismiss'), note: z.string().trim().min(1).max(4000) }).strict(),
      ]).parse(request.body))
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/notifications/:id/:action', async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const { id,action } = z.object({ id: z.string().uuid(), action: z.enum(['read','presented']) }).parse(request.params)
      const column = action === 'read' ? 'read_at' : 'presented_at'
      await withTransaction(pool,async (db) => {
        const result = await db.query(`UPDATE tracking_notifications n SET ${column}=coalesce(n.${column},now())
          FROM cases c WHERE n.case_id=c.id AND NOT c.is_archived AND n.id=$1 AND n.organization_id=$2 AND c.responsible_user_id=$3 RETURNING n.id`, [id,session.user.organizationId,session.user.id])
        if (!result.rowCount) throw new TrackingError(404,'Bildirim bulunamadı.')
        await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,
          action: `tracking.notification_${action}`,entityType: 'tracking_notification',entityId: id,requestId: String(request.id) })
      })
      return reply.code(204).send()
    })
    routes.get('/api/v1/tracking/notifications/pending',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const preference = (await pool.query('SELECT preferences FROM user_notification_preferences WHERE organization_id=$1 AND user_id=$2', [session.user.organizationId,session.user.id])).rows[0]
      const preferences = notificationPreferencesSchema.parse(preference?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES)
      const rows = (await pool.query(`SELECT n.id,n.case_id AS "caseId",c.plate,n.title,
        (n.kind='tramer' AND n.event_key ~ '^tramer:[^:]+:((completed|cancelled)$|result-review:)') AS "isResult",
        (n.kind='tramer' AND n.event_key ~ '^tramer:[^:]+:result-review:') AS "requiresReview"
        FROM tracking_notifications n JOIN cases c ON c.id=n.case_id
        WHERE n.organization_id=$1 AND NOT c.is_archived AND c.responsible_user_id=$2
        AND n.read_at IS NULL AND n.presented_at IS NULL
        AND ($3 OR (n.kind='tramer' AND n.event_key ~ '^tramer:[^:]+:((completed|cancelled)$|result-review:)'))
        ORDER BY "isResult" DESC,n.created_at,n.id LIMIT 20`, [session.user.organizationId,session.user.id,preferences.showPopups])).rows
      return { notifications: rows, preferences }
    })
    routes.get('/api/v1/tracking/notifications/inbox',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const query = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1),read: z.enum(['all','unread','read']).default('unread'),caseId: z.string().uuid().optional() }).strict().parse(request.query)
      const scope = 'n.organization_id=$1 AND c.responsible_user_id=$2 AND NOT c.is_archived AND ($3::uuid IS NULL OR c.id=$3)'
      const filter = `${scope} AND ($4='all' OR ($4='unread' AND n.read_at IS NULL) OR ($4='read' AND n.read_at IS NOT NULL))`
      const params = [session.user.organizationId,session.user.id,query.caseId ?? null,query.read]
      const [counts,rows] = await Promise.all([
        pool.query(`SELECT count(*)::int AS total,(SELECT count(*)::int FROM tracking_notifications n JOIN cases c ON c.id=n.case_id WHERE ${scope} AND n.read_at IS NULL) AS unread
          FROM tracking_notifications n JOIN cases c ON c.id=n.case_id WHERE ${filter}`,params),
        pool.query(`SELECT n.id,n.case_id AS "caseId",c.plate,c.office_number AS "officeNumber",n.title,n.kind,n.read_at AS "readAt",n.presented_at AS "presentedAt",n.created_at AS "createdAt"
          FROM tracking_notifications n JOIN cases c ON c.id=n.case_id WHERE ${filter} ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET $5`,[...params,(query.page-1)*50]),
      ])
      return trackingInboxSchema.parse(JSON.parse(JSON.stringify({ notifications: rows.rows,...counts.rows[0],page: query.page })))
    })
    routes.post('/api/v1/tracking/notifications/read-all',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const input = z.object({ caseId: z.string().uuid().optional() }).strict().parse(request.body)
      await withTransaction(pool,async (db) => {
        // All pages of the current user's inbox, bounded by this transaction.
        // New arrivals and existing read timestamps are preserved.
        const result = await db.query(`UPDATE tracking_notifications n SET read_at=now()
          FROM cases c WHERE n.case_id=c.id AND c.organization_id=n.organization_id
          AND n.organization_id=$1 AND c.responsible_user_id=$2 AND NOT c.is_archived
          AND n.read_at IS NULL AND n.created_at<=now() AND ($3::uuid IS NULL OR c.id=$3)`,
        [session.user.organizationId,session.user.id,input.caseId ?? null])
        if (result.rowCount) await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,
          action: 'tracking.notifications_read_all',requestId: String(request.id),details: { count: result.rowCount } })
      })
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/notifications/dismiss',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const input = z.object({ ids: z.array(z.string().uuid()).min(1).max(20).optional(),ordinary: z.literal(true).optional() }).strict()
        .refine(value => !value.ids || !value.ordinary).parse(request.body)
      await withTransaction(pool,async (db) => {
        // Result popups acknowledge displayed IDs; ordinary backlog dismissal
        // never consumes a Tramer result. Inbox read timestamps stay unchanged.
        const result = await db.query(`UPDATE tracking_notifications n SET presented_at=now()
          FROM cases c WHERE n.case_id=c.id AND n.organization_id=$1
          AND c.responsible_user_id=$2 AND NOT c.is_archived
          AND n.presented_at IS NULL AND n.read_at IS NULL AND n.created_at<=now()
          AND ($3::uuid[] IS NULL OR n.id=ANY($3::uuid[]))
          AND (NOT $4 OR NOT (n.kind='tramer' AND n.event_key ~ '^tramer:[^:]+:((completed|cancelled)$|result-review:)'))`,
        [session.user.organizationId,session.user.id,input.ids ?? null,input.ordinary === true])
        if (result.rowCount) await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,
          action: 'tracking.notifications_dismissed',requestId: String(request.id),details: { count: result.rowCount } })
      })
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/mail/:id/disconnect', async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      if (!canManageTracking(session)) throw new TrackingError(403,'Bağlantı yönetim yetkiniz yok.')
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      await withTransaction(pool,async (db) => {
        const result = await db.query(`UPDATE mail_connections SET status='disconnected',encrypted_refresh_token=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id`, [id,session.user.organizationId])
        if (!result.rowCount) throw new TrackingError(404,'Bağlantı bulunamadı.')
        await createAuditService().record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,action: 'tracking.mail_disconnected',entityType: 'mail_connection',entityId: id })
      })
      return reply.code(204).send()
    })
    routes.get('/api/v1/tracking/agent/locations', async (request,reply) => {
      const agent = await requireAgent(agents,request,reply)
      if (!agent) return
      const { cursor } = z.object({ cursor: z.string().uuid().optional() }).parse(request.query)
      const rows = (await pool.query(`SELECT l.case_id AS "caseId",l.storage_root_key AS "storageRootKey",l.relative_path AS "relativePath",l.version,now() AS "scanStartedAt"
        FROM case_locations l JOIN storage_roots r ON r.organization_id=l.organization_id AND r.root_key=l.storage_root_key
        JOIN cases c ON c.organization_id=l.organization_id AND c.id=l.case_id
        WHERE l.organization_id=$1 AND r.is_active AND NOT c.is_archived AND ($2::uuid IS NULL OR l.case_id>$2) ORDER BY l.case_id LIMIT 100`, [agent.organizationId,cursor ?? null])).rows
      return { locations: rows, nextCursor: rows.length === 100 ? rows.at(-1)?.caseId : null }
    })
    routes.post('/api/v1/tracking/agent/observations', async (request,reply) => {
      const agent = await requireAgent(agents,request,reply)
      if (!agent) return
      return observeFile(pool,agent.organizationId,agent.id,trackingFileSchema.parse(request.body))
    })
    routes.post('/api/v1/tracking/agent/health',async (request,reply) => {
      const agent = await requireAgent(agents,request,reply)
      if (!agent) return
      const { ok,phase } = z.object({ ok: z.boolean(),phase: z.enum(['scanning','complete']).optional() }).strict().parse(request.body)
      await pool.query(`INSERT INTO tracking_health(organization_id,kind,source_id,last_success_at,error_code)
        VALUES($1,'folder',$2,CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN $3 THEN NULL WHEN $4 THEN 'scan_in_progress' ELSE 'scan_incomplete' END)
        ON CONFLICT(organization_id,kind,source_id) DO UPDATE SET last_attempt_at=now(),
        last_success_at=CASE WHEN $3 THEN now() ELSE tracking_health.last_success_at END,error_code=excluded.error_code`, [agent.organizationId,agent.id,ok,phase === 'scanning'])
      return reply.code(204).send()
    })
    routes.post('/api/v1/tracking/agent/reconcile',async (request,reply) => {
      const agent = await requireAgent(agents,request,reply)
      if (!agent) return
      const input = z.object({ caseId: z.string().uuid(),locationVersion: z.number().int().positive(),scanStartedAt: z.string().datetime(),paths: z.array(trackingFileSchema.shape.relativePath).max(50_000) }).strict().parse(request.body)
      await reconcileFiles(pool,agent.organizationId,input)
      return reply.code(204).send()
    })
  })
}
