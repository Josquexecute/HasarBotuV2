import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import { isTemporaryTrackedFile } from '@hasarbotu/domain'
import type { TrackingFile, TramerCommand } from '@hasarbotu/contracts'
import { withTransaction, type Queryable } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import type { SessionRow } from '../auth/store.js'

const audit = createAuditService()
export class TrackingError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) { super(message) }
}
export const canManageTracking = (session: SessionRow): boolean => session.user.roles.some((r) => ['admin','expert','case_manager'].includes(r))
export const canWriteTracking = (session: SessionRow): boolean => session.user.roles.some((r) => ['admin','expert','case_manager','secretary'].includes(r))

async function record(exec: Queryable, organizationId: string, caseId: string, action: string, actorUserId: string | undefined, details: unknown) {
  await audit.record(exec, { organizationId, entityType: 'case', entityId: caseId, action: `tracking.${action}`, actorUserId, details })
}

async function notify(exec: Queryable, organizationId: string, caseId: string, eventKey: string, kind: 'document' | 'tramer', title: string) {
  // An unassigned case retains its event. Assignment is reconciled before inbox reads.
  await exec.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
    SELECT $1,$2,c.id,c.responsible_user_id,$4,$5,$6 FROM cases c WHERE c.organization_id=$2 AND c.id=$3
    ON CONFLICT (organization_id,event_key) DO NOTHING`, [uuidv7(),organizationId,caseId,eventKey,kind,title])
}

export async function tramerCommand(pool: pg.Pool, session: SessionRow, caseId: string, input: TramerCommand) {
  if (!canWriteTracking(session)) throw new TrackingError(403, 'Bu işlem için yetkiniz yok.')
  return withTransaction(pool, async (db) => {
    const org = session.user.organizationId
    const found = await db.query('SELECT id FROM cases WHERE organization_id=$1 AND id::text=$2 FOR UPDATE', [org,caseId])
    if (!found.rowCount) throw new TrackingError(404, 'Dosya bulunamadı.')
    const active = (await db.query(`SELECT * FROM tramer_requests WHERE organization_id=$1 AND case_id=$2
      AND status IN ('entry_pending','result_pending') FOR UPDATE`, [org,caseId])).rows[0]
    if (input.action === 'assign') {
      if (!canManageTracking(session)) throw new TrackingError(403, 'Tramer atama yetkiniz yok.')
      const user = await db.query(`SELECT id FROM users WHERE organization_id=$1 AND id=$2 AND status='active'
        AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=users.id AND r.code IN ('admin','expert','case_manager','secretary'))`, [org,input.assignedUserId])
      if (!user.rowCount) throw new TrackingError(400, 'Aktif ve işlem yetkili çalışan seçin.')
      if (active?.assigned_user_id === input.assignedUserId) return
      if (active) await db.query('UPDATE tramer_requests SET assigned_user_id=$2,version=version+1,updated_at=now() WHERE id=$1', [active.id,input.assignedUserId])
      else await db.query('INSERT INTO tramer_requests(id,organization_id,case_id,assigned_user_id) VALUES($1,$2,$3,$4)', [uuidv7(),org,caseId,input.assignedUserId])
      await record(db,org,caseId,'tramer_assigned',session.user.id,{ previousAssignedUserId: active?.assigned_user_id ?? null, assignedUserId: input.assignedUserId })
      return
    }
    if (!active || active.version !== input.expectedVersion) throw new TrackingError(409, 'İş değişti; listeyi yenileyin.')
    if (active.assigned_user_id !== session.user.id && !canManageTracking(session)) throw new TrackingError(403, 'Bu Tramer işi size atanmamış.')
    if (input.action === 'number') {
      if (active.status !== 'entry_pending') throw new TrackingError(409, 'Başvuru numarası zaten kaydedilmiş.')
      // The database unique constraint also arbitrates simultaneous submissions from different cases.
      try {
        await db.query("UPDATE tramer_requests SET application_number=$2,status='result_pending',version=version+1,updated_at=now() WHERE id=$1", [active.id,input.applicationNumber])
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new TrackingError(409, 'Başvuru numarası başka bir işlemde kayıtlı.')
        throw error
      }
      await record(db,org,caseId,'tramer_number_saved',session.user.id,{ applicationNumber: input.applicationNumber, previousStatus: active.status, status: 'result_pending' })
    } else {
      await db.query("UPDATE tramer_requests SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1", [active.id])
      await record(db,org,caseId,'tramer_cancelled',session.user.id,{ applicationNumber: active.application_number, previousStatus: active.status, status: 'cancelled', reason: input.reason })
      await notify(db,org,caseId,`tramer:${active.id}:cancelled`,'tramer',`Tramer iptal edildi: ${input.reason}`)
    }
  })
}

export async function observeFile(pool: pg.Pool, organizationId: string, agentId: string, input: TrackingFile) {
  return withTransaction(pool, async (db) => {
    const location = (await db.query(`SELECT * FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`, [organizationId,input.caseId])).rows[0]
    if (!location || location.version !== input.locationVersion || location.storage_root_key !== input.storageRootKey
      || !input.relativePath.startsWith(`${location.relative_path}/`)) throw new TrackingError(409,'Dosya konumu değişti; yeniden tarayın.')
    const fileName = input.relativePath.split('/').at(-1)!
    if (isTemporaryTrackedFile(fileName)) throw new TrackingError(400,'Geçici dosya işlenemez.')
    let tracked = (await db.query(`SELECT * FROM tracked_files WHERE organization_id=$1 AND case_id=$2 AND storage_root_key=$3 AND relative_path=$4 FOR UPDATE`, [organizationId,input.caseId,input.storageRootKey,input.relativePath])).rows[0]
    if (tracked?.current_hash === input.contentHash && tracked.available) return { changed: false }
    const previous = tracked ? (await db.query('SELECT document_type FROM document_observations WHERE file_id=$1 AND revision=$2', [tracked.id,tracked.revision])).rows[0] : undefined
    if (tracked) {
      tracked = (await db.query('UPDATE tracked_files SET current_hash=$2,revision=revision+1,available=true WHERE id=$1 RETURNING *', [tracked.id,input.contentHash])).rows[0]
    } else {
      tracked = (await db.query(`INSERT INTO tracked_files(id,organization_id,case_id,storage_root_key,relative_path,current_hash,revision)
        VALUES($1,$2,$3,$4,$5,$6,1) RETURNING *`, [uuidv7(),organizationId,input.caseId,input.storageRootKey,input.relativePath,input.contentHash])).rows[0]
    }
    const id = uuidv7()
    await db.query(`INSERT INTO document_observations(id,file_id,revision,content_hash,byte_size,file_name,document_type)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id,tracked.id,tracked.revision,input.contentHash,input.byteSize,fileName,previous?.document_type ?? null])
    await notify(db,organizationId,input.caseId,`document:${id}`,'document',`Evrak ${tracked.revision === 1 ? 'eklendi' : 'değişti'}: ${fileName} — kontrol bekliyor`)
    await record(db,organizationId,input.caseId,'document_observed',undefined,{ agentId, observationId: id, fileName, revision: tracked.revision, contentHash: input.contentHash })
    return { changed: true }
  })
}

export async function reviewDocument(pool: pg.Pool, session: SessionRow, id: string, input: { status: 'approved' | 'rejected'; documentType: string; note: string }) {
  if (!canWriteTracking(session)) throw new TrackingError(403,'Kontrol yetkiniz yok.')
  await withTransaction(pool, async (db) => {
    const row = (await db.query(`SELECT o.*,f.organization_id,f.case_id,f.revision AS current_revision,c.responsible_user_id
      FROM document_observations o JOIN tracked_files f ON f.id=o.file_id JOIN cases c ON c.id=f.case_id
      WHERE o.id::text=$1 AND f.organization_id=$2 FOR UPDATE OF o,f,c`, [id,session.user.organizationId])).rows[0]
    if (!row) throw new TrackingError(404,'Evrak bulunamadı.')
    const location = (await db.query('SELECT storage_root_key,relative_path FROM case_locations WHERE organization_id=$1 AND case_id=$2', [row.organization_id,row.case_id])).rows[0]
    const file = (await db.query('SELECT * FROM tracked_files WHERE id=$1', [row.file_id])).rows[0]
    if (!file.available || !location || location.storage_root_key !== file.storage_root_key || !file.relative_path.startsWith(`${location.relative_path}/`)) throw new TrackingError(409,'Evrakın güncel konumu değişmiş; yeniden tarama gerekiyor.')
    if (row.responsible_user_id !== session.user.id) throw new TrackingError(403,'Evrakı dosya sorumlusu kontrol etmelidir.')
    if (row.revision !== row.current_revision || row.status !== 'pending') throw new TrackingError(409,'Evrak değişti veya zaten kontrol edildi.')
    await db.query(`UPDATE document_observations SET status=$2,document_type=$3,review_note=$4,reviewed_by=$5,reviewed_at=now() WHERE id=$1`, [id,input.status,input.documentType,input.note,session.user.id])
    await record(db,row.organization_id,row.case_id,'document_reviewed',session.user.id,{ observationId: id, fileName: row.file_name, contentHash: row.content_hash, status: input.status, documentType: input.documentType, note: input.note })
  })
}

export async function reconcileFiles(pool: pg.Pool, organizationId: string, input: { caseId: string; locationVersion: number; scanStartedAt: string; paths: string[] }) {
  await withTransaction(pool,async (db) => {
    const location = (await db.query('SELECT * FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR UPDATE', [organizationId,input.caseId])).rows[0]
    if (!location || location.version !== input.locationVersion) throw new TrackingError(409,'Tarama sırasında konum değişti.')
    const removed = await db.query(`UPDATE tracked_files SET available=false WHERE organization_id=$1 AND case_id=$2 AND available
      AND storage_root_key=$3 AND left(relative_path,length($4::text)+1)=$4||'/' AND NOT(relative_path=ANY($5::text[]))
      AND EXISTS (SELECT 1 FROM document_observations o WHERE o.file_id=tracked_files.id AND o.revision=tracked_files.revision AND o.observed_at <= $6::timestamptz)
      RETURNING *`, [organizationId,input.caseId,location.storage_root_key,location.relative_path,input.paths,input.scanStartedAt])
    for (const file of removed.rows) {
      await notify(db,organizationId,input.caseId,`document:${file.id}:${file.revision}:missing`,'document',`Evrak artık klasörde bulunmuyor: ${file.relative_path.split('/').at(-1)}`)
      await record(db,organizationId,input.caseId,'document_missing',undefined,{ fileName: file.relative_path.split('/').at(-1) })
    }
  })
}

export interface SbmResult {
  applicationNumber: string | null
  status: 'completed' | 'cancelled' | null
  text: string
  evidenceHash: string
  reason: string | null
}

export async function ingestSbmResult(pool: pg.Pool, input: { connectionId: string; messageId: string; receivedAt: Date; result: SbmResult; automatic: boolean }) {
  await withTransaction(pool, async (db) => {
    const connection = (await db.query("SELECT * FROM mail_connections WHERE id=$1 AND status <> 'disconnected' FOR SHARE", [input.connectionId])).rows[0]
    if (!connection) throw new TrackingError(409,'E-posta bağlantısı kapalı.')
    const r = input.result
    const id = uuidv7()
    const inserted = await db.query(`INSERT INTO sbm_messages(id,organization_id,connection_id,provider_message_id,application_number,result_status,result_text,evidence_hash,status,reason,received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'review',$9,$10) ON CONFLICT(connection_id,provider_message_id) DO NOTHING RETURNING id`,
    [id,connection.organization_id,connection.id,input.messageId,r.applicationNumber,r.status,r.text,r.evidenceHash,r.reason ?? 'pending_match',input.receivedAt])
    if (!inserted.rowCount) return
    const request = r.applicationNumber === null ? undefined : (await db.query('SELECT * FROM tramer_requests WHERE organization_id=$1 AND application_number=$2 FOR UPDATE', [connection.organization_id,r.applicationNumber])).rows[0]
    let reason = r.reason ?? (!request ? 'unmatched_number' : !input.automatic ? 'parser_not_validated' : null)
    if (request && !reason) {
      if (request.status === r.status && request.result_text === r.text) {
        await db.query("UPDATE sbm_messages SET status='duplicate',reason='duplicate_result',tramer_id=$2 WHERE id=$1", [id,request.id])
        await record(db,connection.organization_id,request.case_id,'sbm_duplicate',undefined,{ applicationNumber: r.applicationNumber, sourceAccount: connection.email, messageId: input.messageId })
        return
      }
      if (request.status !== 'result_pending') reason = 'conflicting_or_terminal_result'
    }
    if (reason || !request || !r.status) {
      await db.query('UPDATE sbm_messages SET reason=$2,tramer_id=$3 WHERE id=$1', [id,reason ?? 'ambiguous_result',request?.id ?? null])
      return
    }
    await applyResult(db,request,connection.email,id,r,undefined)
  })
}

async function applyResult(db: Queryable, request: { id: string; organization_id: string; case_id: string; status: string }, email: string, messageId: string, result: SbmResult, actor: string | undefined) {
  await db.query('UPDATE tramer_requests SET status=$2,result_text=$3,version=version+1,updated_at=now() WHERE id=$1', [request.id,result.status,result.text])
  await db.query("UPDATE sbm_messages SET status='applied',reason='matched',tramer_id=$2,reviewed_by=$3,reviewed_at=CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END WHERE id=$1", [messageId,request.id,actor ?? null])
  await notify(db,request.organization_id,request.case_id,`tramer:${request.id}:${result.status}`,'tramer',`Tramer ${result.status === 'completed' ? 'sonuçlandı' : 'iptal edildi'} — ${result.applicationNumber}`)
  await record(db,request.organization_id,request.case_id,'sbm_result',actor,{ applicationNumber: result.applicationNumber, sourceAccount: email, messageId, previousStatus: request.status, status: result.status, resultText: result.text })
}

export async function reviewSbm(pool: pg.Pool, session: SessionRow, id: string, input: { action: 'apply'; applicationNumber: string; resultStatus: 'completed' | 'cancelled'; note: string } | { action: 'dismiss'; note: string }) {
  if (!canManageTracking(session)) throw new TrackingError(403,'Sonuç kontrol yetkiniz yok.')
  await withTransaction(pool, async (db) => {
    const message = (await db.query(`SELECT m.*,c.email FROM sbm_messages m JOIN mail_connections c ON c.id=m.connection_id
      WHERE m.id::text=$1 AND m.organization_id=$2 FOR UPDATE OF m`, [id,session.user.organizationId])).rows[0]
    if (!message) throw new TrackingError(404,'Sonuç bulunamadı.')
    if (message.status !== 'review') throw new TrackingError(409,'Sonuç zaten kontrol edildi.')
    if (input.action === 'dismiss') {
      await db.query("UPDATE sbm_messages SET status='dismissed',reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1", [id,input.note,session.user.id])
      await audit.record(db,{ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'tracking.sbm_dismissed', entityType: 'sbm_message', entityId: id, details: { note: input.note, sourceAccount: message.email } })
      return
    }
    const request = (await db.query("SELECT * FROM tramer_requests WHERE organization_id=$1 AND application_number=$2 FOR UPDATE", [session.user.organizationId,input.applicationNumber])).rows[0]
    if (!request || request.status !== 'result_pending') throw new TrackingError(409,'Bu numara için sonuç bekleyen işlem yok; terminal durum değiştirilemez.')
    await db.query('UPDATE sbm_messages SET application_number=$2,result_status=$3 WHERE id=$1', [id,input.applicationNumber,input.resultStatus])
    await applyResult(db,request,message.email,id,{ applicationNumber: input.applicationNumber, status: input.resultStatus, text: input.note, evidenceHash: message.evidence_hash, reason: null },session.user.id)
  })
}
