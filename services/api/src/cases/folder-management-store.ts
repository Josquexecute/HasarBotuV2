import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import { parsePlateNumber, plateSearchKey } from '@hasarbotu/domain'
import { folderManagementResponseSchema, type FolderManagementDecision } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { latestCheck } from './folder-recovery-store.js'
import { enqueueVerifyJob } from '../agent/enqueue.js'

// The append-only decision is authoritative, just like the existing inventory archive decision.
export const folderManagementJoin = `LEFT JOIN LATERAL (SELECT details FROM audit_events
  WHERE organization_id=c.organization_id AND resource_id=c.id::text AND action='case.folder_management_changed'
  ORDER BY occurred_at DESC,id DESC LIMIT 1) m ON true`
const activeOperations = `(EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
    AND o.status NOT IN ('ready','failed','stale','cancelled')) OR
  EXISTS(SELECT 1 FROM case_lifecycle_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
    AND o.status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')) OR
  EXISTS(SELECT 1 FROM case_workspace_provisionings o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
    AND o.status NOT IN ('ready','failed','stale','cancelled')) OR
  EXISTS(SELECT 1 FROM field_photo_uploads o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
    AND o.status IN ('receiving','queued','processing')) OR
  EXISTS(SELECT 1 FROM jobs j WHERE j.organization_id=c.organization_id AND j.status IN ('pending','leased') AND (
    j.target_type='file_operation' AND j.target_id IN (SELECT id FROM case_file_operations WHERE organization_id=c.organization_id AND case_id=c.id)
    OR j.target_type='workspace_provisioning' AND j.target_id IN (SELECT id FROM case_workspace_provisionings WHERE organization_id=c.organization_id AND case_id=c.id))))`

export async function listFolderManagement(pool: pg.Pool, organizationId: string, search: string, includeRemoved: boolean) {
  const plate = parsePlateNumber(search)
  const normalized = plate.ok ? plateSearchKey(plate.value) : ''
  const rows = !normalized ? [] : (await pool.query(`SELECT c.id AS "caseId",c.plate,c.office_number AS "officeNumber",
    c.version,l.version AS "locationVersion",c.is_archived AS archived,c.lifecycle_status AS "lifecycleStatus",l.relative_path AS "relativePath",
    c.case_type AS "caseType",c.insurer_claim_number AS "insurerClaimNumber",c.loss_date::text AS "lossDate",
    l.storage_root_key AS "storageRootKey",r.source_folder_id AS "sourceFolderId",l.updated_at AS "locationUpdatedAt",
    m.details->>'disposition' disposition,m.details->>'explanation' explanation,
    ${activeOperations} AS "hasActiveOperations",
    (SELECT count(*)::int FROM documents d WHERE d.organization_id=c.organization_id AND d.case_id=c.id) AS "documentCount",
    (SELECT count(*)::int FROM case_notes n WHERE n.organization_id=c.organization_id AND n.case_id=c.id) AS "noteCount",
    CASE WHEN c.is_archived AND coalesce(i.details->>'managedArchive','false')<>'true'
        AND coalesce(m.details->>'disposition','')<>'recovery_requested' THEN 'manually_archived'
      WHEN c.is_archived OR l.id IS NULL OR l.verification_status<>'verified' OR d.occurred_at>l.updated_at
        THEN 'needs_check' ELSE 'verified' END status
    FROM cases c LEFT JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
    LEFT JOIN case_folder_registrations r ON r.organization_id=c.organization_id AND r.case_id=c.id
    ${folderManagementJoin}
    LEFT JOIN LATERAL (SELECT details FROM audit_events WHERE organization_id=c.organization_id AND resource_id=c.id::text
      AND action='case.office_inventory_reconciled' ORDER BY occurred_at DESC,id DESC LIMIT 1) i ON true
    LEFT JOIN LATERAL (SELECT occurred_at FROM audit_events WHERE organization_id=c.organization_id AND resource_id=c.id::text
      AND action='case.office_inventory_deferred' ORDER BY occurred_at DESC,id DESC LIMIT 1) d ON true
    WHERE c.organization_id=$1 AND strpos(c.plate_normalized,$2)>0
      AND ($3 OR coalesce(m.details->>'disposition','')<>'removed') ORDER BY c.updated_at DESC,c.id LIMIT 51`,
  [organizationId, normalized, includeRemoved])).rows
  return folderManagementResponseSchema.parse(JSON.parse(JSON.stringify({
    items: rows.slice(0, 50), truncated: rows.length > 50, latestCheck: await latestCheck(pool, organizationId),
  })))
}

type DecisionResult = 'ok' | 'not_found' | 'changed' | 'active' | 'invalid_state'
export async function decideFolderManagement(pool: pg.Pool, actor: { organizationId: string; actorUserId: string; requestId: string },
  caseId: string, input: FolderManagementDecision): Promise<DecisionResult> {
  return withTransaction(pool, async db => {
    // Use the scanner's lock order so a concurrent scan cannot republish an operator removal.
    const root = (await db.query('SELECT storage_root_key FROM case_locations WHERE organization_id=$1 AND case_id=$2', [actor.organizationId, caseId])).rows[0]
    if (root) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${actor.organizationId}:${root.storage_root_key}`])
    const row = (await db.query(`SELECT c.version,c.is_archived,m.details->>'disposition' disposition
      FROM cases c ${folderManagementJoin} WHERE c.organization_id=$1 AND c.id=$2 FOR UPDATE OF c`, [actor.organizationId, caseId])).rows[0]
    if (!row) return 'not_found'
    if (row.version !== input.expectedVersion) return 'changed'
    if ((await db.query(`SELECT 1 FROM cases c WHERE c.organization_id=$1 AND c.id=$2 AND ${activeOperations}`, [actor.organizationId, caseId])).rowCount) return 'active'
    if (input.action === 'remove' && row.disposition === 'removed'
      || input.action === 'recover' && !row.is_archived
      || input.action === 'dispute' && row.disposition === 'removed') return 'invalid_state'
    const location = (await db.query('SELECT * FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR UPDATE', [actor.organizationId, caseId])).rows[0]
    if ((location?.version ?? null) !== input.expectedLocationVersion) return 'changed'
    if (input.action === 'dispute') {
      if (!location) return 'invalid_state'
      // A suspected wrong link must stop being usable for file writes until independently verified.
      await db.query("UPDATE case_locations SET verification_status='pending',version=version+1,updated_at=now() WHERE id=$1", [location.id])
      await db.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,'pending','system',$6,$7)`, [uuidv7(), actor.organizationId, caseId, location.storage_root_key, location.relative_path, actor.actorUserId, actor.requestId])
      await enqueueVerifyJob(db, { organizationId: actor.organizationId, type: 'verify_case_location', targetType: 'case_location',
        targetId: location.id, targetVersion: location.version + 1,
        payload: { storageRootKey: location.storage_root_key, relativePath: location.relative_path, kind: 'directory', declaredHash: null, declaredSize: null } })
    }
    await db.query(`UPDATE cases SET is_archived=CASE WHEN $3='remove' THEN true ELSE is_archived END,
      version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`, [actor.organizationId, caseId, input.action])
    await createAuditService().record(db, { ...actor, action: 'case.folder_management_changed', entityType: 'case', entityId: caseId,
      details: { ...input, disposition: input.action === 'remove' ? 'removed' : input.action === 'recover' ? 'recovery_requested' : row.disposition ?? null,
        previousArchived: row.is_archived, previousDisposition: row.disposition ?? null, previousLocation: location ?? null,
        childRecordsPreserved: true, physicalFilesUnchanged: true } })
    return 'ok'
  })
}
