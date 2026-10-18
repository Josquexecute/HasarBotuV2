import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, statfs } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import { fieldUploadSchema, fieldPhotoJobSchema, type FieldUpload, type fieldUploadInitSchema, type fieldPhotoResultSchema } from '@hasarbotu/contracts'
import type { z } from 'zod'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import type { AuthedAgent } from '../agent/auth.js'

type Actor = { organizationId: string; actorUserId: string; requestId: string }
type UploadInput = z.infer<typeof fieldUploadInitSchema>
type PhotoResult = z.infer<typeof fieldPhotoResultSchema>
interface Row {
  id: string; case_id: string; kind: string; original_file_name: string; byte_size: number; received_bytes: number
  status: string; output_file_name: string | null; output_bytes: number | null; last_error_code: string | null
  created_at: Date; uploaded_by?: string
  uploaded_by_user_id: string
}
export class FieldPhotoError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}
const fail = (code: string, status = 409): never => { throw new FieldPhotoError(code, status) }
const dto = (row: Row): FieldUpload => fieldUploadSchema.parse({ id: row.id, caseId: row.case_id, kind: row.kind,
  fileName: row.original_file_name, byteSize: row.byte_size, receivedBytes: row.received_bytes, status: row.status,
  outputFileName: row.status === 'ready' ? row.output_file_name : null, outputBytes: row.status === 'ready' ? row.output_bytes : null,
  errorCode: row.last_error_code, createdAt: row.created_at.toISOString(), uploadedBy: row.uploaded_by ?? '', uploadedByUserId: row.uploaded_by_user_id })
const activeOperationSql = `EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('ready','stale','cancelled'))
  OR EXISTS(SELECT 1 FROM case_lifecycle_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('closed','reopened','blocked','failed','stale','cancelled'))
  OR EXISTS(SELECT 1 FROM case_workspace_provisionings o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('ready','failed','stale','cancelled'))`

export function createFieldPhotoStore(pool: pg.Pool, directory: string) {
  if (!isAbsolute(directory)) throw new Error('field_photo_directory_must_be_absolute')
  const audit = createAuditService()
  const file = (id: string, kind: 'original' | 'jpeg' = 'original') => join(directory, `${id}.${kind === 'jpeg' ? 'jpg' : 'bin'}`)
  async function ensureDirectory() {
    await mkdir(directory, { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe_field_photo_directory')
  }
  async function location(db: pg.PoolClient, organizationId: string, caseId: string) {
    const row = (await db.query(`SELECT l.storage_root_key,l.relative_path,l.version,c.lifecycle_status,(${activeOperationSql}) busy
      FROM cases c JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
      JOIN storage_roots r ON r.organization_id=l.organization_id AND r.root_key=l.storage_root_key AND r.is_active
      WHERE c.organization_id=$1 AND c.id=$2 AND NOT c.is_archived AND l.verification_status='verified' FOR UPDATE OF c`, [organizationId, caseId])).rows[0]
    if (!row) fail('case_unavailable', 404)
    if (row.lifecycle_status !== 'open' || row.busy) fail('case_busy')
    if (!/^\d{4} OFİS\//u.test(row.relative_path.normalize('NFC').toLocaleUpperCase('tr'))) fail('case_outside_office')
    return row
  }
  async function owned(db: pg.PoolClient, actor: Actor, id: string) {
    const row = (await db.query(`SELECT f.*,u.display_name uploaded_by FROM field_photo_uploads f JOIN users u ON u.id=f.uploaded_by_user_id
      WHERE f.id=$1 AND f.organization_id=$2 AND f.uploaded_by_user_id=$3 FOR UPDATE OF f`, [id, actor.organizationId, actor.actorUserId])).rows[0]
    if (!row) fail('upload_not_found', 404)
    return row
  }
  async function leased(db: pg.PoolClient, agent: AuthedAgent, id: string, token: string) {
    const row = (await db.query(`SELECT * FROM field_photo_uploads WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, agent.organizationId])).rows[0]
    if (!row) fail('upload_not_found', 404)
    if (row.leased_by_agent_id !== agent.id || row.lease_token !== token || row.status !== 'processing' || row.lease_expires_at <= new Date()) fail('lease_lost')
    const current = await location(db, agent.organizationId, row.case_id)
    if (current.version !== row.location_version || current.relative_path !== row.relative_path || current.storage_root_key !== row.storage_root_key) fail('case_location_changed')
    return row
  }
  return {
    async search(organizationId: string, query: string) {
      const key = query.toLocaleUpperCase('tr').replace(/[^A-Z0-9]/gu, '')
      if (key.length < 2) return []
      return (await pool.query(`SELECT c.id,c.plate,c.office_number "officeNumber",c.lifecycle_status status,
        (l.verification_status='verified' AND c.lifecycle_status='open') "canUpload"
        FROM cases c JOIN case_locations l ON l.case_id=c.id AND l.organization_id=c.organization_id
        WHERE c.organization_id=$1 AND NOT c.is_archived AND c.plate_normalized LIKE $2
          AND upper(l.relative_path) ~ '^\\d{4} OFİS/' ORDER BY c.office_year DESC,c.office_sequence DESC LIMIT 30`, [organizationId, `%${key}%`])).rows
    },
    async list(organizationId: string, caseId: string) {
      const exists = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2 AND NOT is_archived', [organizationId, caseId])
      if (!exists.rowCount) fail('case_unavailable', 404)
      return (await pool.query(`SELECT f.*,u.display_name uploaded_by FROM field_photo_uploads f JOIN users u ON u.id=f.uploaded_by_user_id
        WHERE f.organization_id=$1 AND f.case_id=$2 ORDER BY f.created_at DESC LIMIT 200`, [organizationId, caseId])).rows.map(dto)
    },
    async init(actor: Actor, caseId: string, input: UploadInput) {
      await ensureDirectory()
      return withTransaction(pool, async db => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended('field-photo-storage',0))")
        const current = await location(db, actor.organizationId, caseId)
        const previous = (await db.query('SELECT f.*,u.display_name uploaded_by FROM field_photo_uploads f JOIN users u ON u.id=f.uploaded_by_user_id WHERE f.organization_id=$1 AND f.uploaded_by_user_id=$2 AND f.client_key=$3', [actor.organizationId, actor.actorUserId, input.clientKey])).rows[0]
        if (previous) {
          if (previous.case_id !== caseId || previous.content_hash !== input.contentHash || previous.byte_size !== input.byteSize || previous.kind !== input.kind) fail('idempotency_conflict')
          if (previous.last_error_code !== 'upload_cancelled') return dto(previous)
        }
        const space = await statfs(directory)
        const reserved = Number((await db.query("SELECT coalesce(sum(byte_size-received_bytes),0)::text bytes FROM field_photo_uploads WHERE status='receiving'")).rows[0].bytes)
        if (space.bavail * space.bsize < reserved + input.byteSize - (previous?.received_bytes ?? 0) + 500 * 1024 * 1024) fail('storage_full', 503)
        const count = (await db.query("SELECT count(*)::int n FROM field_photo_uploads WHERE organization_id=$1 AND uploaded_by_user_id=$2 AND status IN ('receiving','queued','processing')", [actor.organizationId, actor.actorUserId])).rows[0].n
        if (count >= 100) fail('upload_queue_full', 429)
        if (previous) {
          await db.query("UPDATE field_photo_uploads SET status='receiving',last_error_code=NULL,updated_at=now() WHERE id=$1", [previous.id])
          return dto({ ...previous, status: 'receiving', last_error_code: null })
        }
        const row = (await db.query(`INSERT INTO field_photo_uploads(id,organization_id,case_id,uploaded_by_user_id,client_key,kind,original_file_name,byte_size,content_hash,storage_root_key,relative_path,location_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [uuidv7(), actor.organizationId, caseId, actor.actorUserId, input.clientKey, input.kind, input.fileName, input.byteSize, input.contentHash, current.storage_root_key, current.relative_path, current.version])).rows[0]
        await audit.record(db, { ...actor, action: 'photo.upload_started', entityType: 'case', entityId: caseId, details: { uploadId: row.id, kind: input.kind, byteSize: input.byteSize } })
        return dto(row)
      })
    },
    async chunk(actor: Actor, id: string, offset: number, bytes: Buffer) {
      return withTransaction(pool, async db => {
        const row = await owned(db, actor, id)
        if (row.status !== 'receiving') fail('upload_not_receiving')
        if (!bytes.length || offset < 0 || offset + bytes.length > row.byte_size || offset > row.received_bytes) fail('upload_offset_conflict')
        let handle
        try { handle = await open(file(id), 'r+') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; handle = await open(file(id), 'wx+') }
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size < row.received_bytes) throw new Error('field_original_corrupted')
          if (offset < row.received_bytes) {
            if (offset + bytes.length > row.received_bytes) fail('upload_offset_conflict')
            const previous = Buffer.alloc(bytes.length); await handle.read(previous, 0, previous.length, offset)
            if (!previous.equals(bytes)) fail('upload_chunk_conflict')
            return dto(row)
          }
          // Recover an uncommitted append after a crash using the committed database offset.
          await handle.truncate(row.received_bytes)
          let written = 0
          while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, offset + written)).bytesWritten
          await handle.sync()
          row.received_bytes += bytes.length
          await db.query('UPDATE field_photo_uploads SET received_bytes=$2,updated_at=now() WHERE id=$1', [id, row.received_bytes])
          return dto(row)
        } finally { await handle.close() }
      })
    },
    async finish(actor: Actor, id: string) {
      return withTransaction(pool, async db => {
        const row = await owned(db, actor, id)
        if (row.status !== 'receiving') return dto(row)
        if (row.received_bytes !== row.byte_size) fail('upload_incomplete')
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(file(id))) hash.update(chunk)
        if (hash.digest('hex') !== row.content_hash) fail('upload_hash_mismatch')
        await db.query("UPDATE field_photo_uploads SET status='queued',updated_at=now() WHERE id=$1", [id])
        row.status = 'queued'
        await audit.record(db, { ...actor, action: 'photo.upload_received', entityType: 'case', entityId: row.case_id, details: { uploadId: id, originalPreserved: true } })
        return dto(row)
      })
    },
    async retry(actor: Actor, id: string) {
      return withTransaction(pool, async db => {
        const row = (await db.query('SELECT * FROM field_photo_uploads WHERE id=$1 AND organization_id=$2 FOR UPDATE', [id, actor.organizationId])).rows[0]
        if (!row) fail('upload_not_found', 404)
        if (['queued','processing','ready'].includes(row.status)) return
        if (row.status !== 'failed' || !['storage_unavailable','case_not_fresh','photo_write_failed','case_busy','case_location_changed'].includes(row.last_error_code)) fail('upload_not_retryable')
        const current = await location(db, actor.organizationId, row.case_id)
        await db.query("UPDATE field_photo_uploads SET status='queued',attempt_count=0,last_error_code=NULL,storage_root_key=$2,relative_path=$3,location_version=$4,next_attempt_at=now(),updated_at=now() WHERE id=$1", [id, current.storage_root_key, current.relative_path, current.version])
        await audit.record(db, { ...actor, action: 'photo.upload_retried', entityType: 'case', entityId: row.case_id, details: { uploadId: id } })
      })
    },
    async cancel(actor: Actor, id: string) {
      return withTransaction(pool, async db => {
        const row = await owned(db, actor, id)
        if (row.last_error_code === 'upload_cancelled') return
        if (row.status !== 'receiving') fail('upload_not_receiving')
        await db.query("UPDATE field_photo_uploads SET status='failed',last_error_code='upload_cancelled',updated_at=now() WHERE id=$1", [id])
        await audit.record(db, { ...actor, action: 'photo.upload_cancelled', entityType: 'case', entityId: row.case_id, details: { uploadId: id, receivedBytes: row.received_bytes } })
      })
    },
    async claim(agent: AuthedAgent) {
      return withTransaction(pool, async db => {
        const candidates = (await db.query(`SELECT f.* FROM field_photo_uploads f WHERE f.organization_id=$1 AND f.next_attempt_at<=now()
          AND (f.status='queued' OR f.status='processing' AND f.lease_expires_at<now())
          AND NOT EXISTS(SELECT 1 FROM field_photo_uploads p WHERE p.case_id=f.case_id AND p.status='processing' AND p.lease_expires_at>=now())
          ORDER BY f.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [agent.organizationId])).rows
        const row = candidates[0]
        if (!row) return null
        try {
          const current = await location(db, agent.organizationId, row.case_id)
          if ((await db.query("SELECT 1 FROM field_photo_uploads WHERE case_id=$1 AND id<>$2 AND status='processing' AND lease_expires_at>=now()", [row.case_id, row.id])).rowCount) return null
          // Moves between receiving and processing are safe: only the current verified folder is used.
          if (row.output_file_name && (current.version !== row.location_version || current.relative_path !== row.relative_path)) fail('case_location_changed')
          row.location_version = current.version; row.relative_path = current.relative_path; row.storage_root_key = current.storage_root_key
        } catch (error) {
          if (!(error instanceof FieldPhotoError)) throw error
          await db.query("UPDATE field_photo_uploads SET status='failed',last_error_code=$2,updated_at=now() WHERE id=$1", [row.id, error.code])
          return null
        }
        const token = randomUUID()
        await db.query(`UPDATE field_photo_uploads SET status='processing',leased_by_agent_id=$2,lease_token=$3,lease_expires_at=now()+interval '180 seconds',attempt_count=attempt_count+1,
          storage_root_key=$4,relative_path=$5,location_version=$6,updated_at=now() WHERE id=$1`, [row.id, agent.id, token, row.storage_root_key, row.relative_path, row.location_version])
        return fieldPhotoJobSchema.parse({ id: row.id, caseId: row.case_id, kind: row.kind, contentHash: row.content_hash, byteSize: row.byte_size,
          storageRootKey: row.storage_root_key, relativePath: row.relative_path, leaseToken: token, outputFileName: row.output_file_name })
      })
    },
    async originalForAgent(agent: AuthedAgent, id: string, token: string) {
      await withTransaction(pool, db => leased(db, agent, id, token))
      return createReadStream(file(id))
    },
    async prepare(agent: AuthedAgent, id: string, result: PhotoResult) {
      return withTransaction(pool, async db => {
        const row = await leased(db, agent, id, result.leaseToken)
        const prefix = row.kind === 'damage' ? 'HASAR ' : row.kind === 'chassis' ? 'ŞASE' : 'KM'
        if (!result.fileName.startsWith(prefix)) fail('photo_kind_mismatch', 400)
        const collision = await db.query(`SELECT 1 FROM field_photo_uploads WHERE organization_id=$1 AND storage_root_key=$2 AND relative_path=$3 AND output_file_name=$4 AND id<>$5`, [agent.organizationId, row.storage_root_key, row.relative_path, result.fileName, id])
        if (collision.rowCount) fail('photo_name_conflict')
        await db.query(`UPDATE field_photo_uploads SET output_file_name=$2,output_bytes=$3,output_hash=$4,output_width=$5,output_height=$6,lease_expires_at=now()+interval '180 seconds',updated_at=now() WHERE id=$1`,
        [id, result.fileName, result.byteSize, result.contentHash, result.width, result.height])
      })
    },
    async jpeg(agent: AuthedAgent, id: string, token: string, bytes: Buffer) {
      return withTransaction(pool, async db => {
        const row = await leased(db, agent, id, token)
        if (bytes.length !== row.output_bytes || createHash('sha256').update(bytes).digest('hex') !== row.output_hash || bytes[0] !== 255 || bytes[1] !== 216) fail('photo_hash_mismatch')
        const temporary = `${file(id, 'jpeg')}.pending`
        const handle = await open(temporary, 'w')
        try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        await rename(temporary, file(id, 'jpeg'))
      })
    },
    async complete(agent: AuthedAgent, id: string, token: string, requestId: string) {
      return withTransaction(pool, async db => {
        const previous = (await db.query("SELECT status,lease_token,leased_by_agent_id FROM field_photo_uploads WHERE organization_id=$1 AND id=$2", [agent.organizationId, id])).rows[0]
        if (previous?.status === 'ready' && previous.leased_by_agent_id === agent.id && previous.lease_token === token) return
        const row = await leased(db, agent, id, token)
        const jpeg = await readFile(file(id, 'jpeg'))
        if (!row.output_file_name || jpeg.length !== row.output_bytes || createHash('sha256').update(jpeg).digest('hex') !== row.output_hash) fail('photo_hash_mismatch')
        const photoId = uuidv7()
        await db.query(`INSERT INTO photos(id,organization_id,case_id,original_file_name,display_name,extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at,registered_by_user_id,request_id)
          VALUES($1,$2,$3,$4,$4,'jpg','image/jpeg',$5,$6,$7,$8,'upload','ready',true,true,now(),$9,$10)`,
        [photoId, agent.organizationId, row.case_id, row.output_file_name, row.output_bytes, row.output_hash, row.storage_root_key, `${row.relative_path}/${row.output_file_name}`, row.uploaded_by_user_id, requestId])
        await db.query("UPDATE field_photo_uploads SET status='ready',photo_id=$2,last_error_code=NULL,updated_at=now() WHERE id=$1", [id, photoId])
        await audit.record(db, { organizationId: agent.organizationId, actorUserId: row.uploaded_by_user_id, requestId, action: 'photo.upload_published', entityType: 'case', entityId: row.case_id,
          details: { uploadId: id, photoId, agentId: agent.id, fileName: row.output_file_name, originalPreserved: true, byteSize: row.output_bytes } })
      })
    },
    async reportFailure(agent: AuthedAgent, id: string, token: string, code: string, retryable: boolean) {
      return withTransaction(pool, async db => {
        const row = (await db.query('SELECT * FROM field_photo_uploads WHERE id=$1 AND organization_id=$2 FOR UPDATE', [id, agent.organizationId])).rows[0]
        if (!row || row.status !== 'processing' || row.leased_by_agent_id !== agent.id || row.lease_token !== token) fail('lease_lost')
        await db.query(`UPDATE field_photo_uploads SET status=$2,last_error_code=$3,next_attempt_at=now()+interval '30 seconds',lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
        [id, retryable && row.attempt_count < 10 ? 'queued' : 'failed', code])
      })
    },
    async content(organizationId: string, id: string, original = false) {
      const row = (await pool.query(`SELECT f.* FROM field_photo_uploads f JOIN cases c ON c.id=f.case_id AND c.organization_id=f.organization_id
        WHERE f.organization_id=$1 AND f.id=$2 AND NOT c.is_archived AND f.status='ready'`, [organizationId, id])).rows[0]
      if (!row) fail('photo_not_found', 404)
      return { stream: createReadStream(file(id, original ? 'original' : 'jpeg')), fileName: original ? row.original_file_name : row.output_file_name }
    },
  }
}
