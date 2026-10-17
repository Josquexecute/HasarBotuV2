import type pg from 'pg'
import { relativePathSchema } from '@hasarbotu/contracts'
import { parseSourcePlateFolderName, plateSearchKey } from '@hasarbotu/domain'
import { createAuditService } from '../audit/service.js'
import { automaticFolderPolicySchema, type AutomaticFolderPolicy } from './automatic-folder-registration.js'

export interface OfficeFolderObservation {
  relativePath: string
  sourceFolderId: string
}
const key = (path: string) => path.normalize('NFC').toLocaleUpperCase('tr')

/** Explicit office-only policy: reconcile observed placement, retain every business/child record. */
export async function reconcileOfficeFolderInventory(pool: pg.Pool, input: AutomaticFolderPolicy,
  folders: readonly OfficeFolderObservation[], scanStartedAt: string, verifyInventory: () => Promise<void>) {
  const policy = automaticFolderPolicySchema.parse(input)
  if (!Number.isFinite(Date.parse(scanStartedAt)) || !folders.length) throw new Error('office_inventory_incomplete')
  const byPath = new Map<string, OfficeFolderObservation>()
  const identities = new Set<string>()
  for (const folder of folders) {
    relativePathSchema.parse(folder.relativePath)
    if (!/^\d{4} OFİS\//u.test(key(folder.relativePath)) || !/^\d+$/u.test(folder.sourceFolderId)
      || !parseSourcePlateFolderName(folder.relativePath.split('/').at(-1)!)
      || byPath.has(key(folder.relativePath)) || identities.has(folder.sourceFolderId)) throw new Error('office_inventory_invalid')
    byPath.set(key(folder.relativePath), folder)
    identities.add(folder.sourceFolderId)
  }
  await verifyInventory()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${policy.organizationId}:${policy.storageRootKey}`])
    if (!(await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`,
    [policy.organizationId, policy.actorUserId])).rowCount) throw new Error('folder_admin_required')
    if (!(await client.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active',
      [policy.organizationId, policy.storageRootKey])).rowCount) throw new Error('folder_active_root_required')
    const rows = (await client.query(`SELECT c.id,c.plate_normalized,c.is_archived,c.lifecycle_status,c.workflow_stage,c.version,
      l.relative_path,r.source_folder_id,
      (SELECT a.details FROM audit_events a WHERE a.organization_id=c.organization_id AND a.resource_id=c.id::text
        AND a.action='case.office_inventory_reconciled' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) previous_inventory,
      (EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
        AND o.status NOT IN ('ready','failed','stale','cancelled')) OR
       EXISTS(SELECT 1 FROM case_lifecycle_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
        AND o.status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')) OR
       EXISTS(SELECT 1 FROM case_workspace_provisionings o WHERE o.organization_id=c.organization_id AND o.case_id=c.id
        AND o.status NOT IN ('ready','failed','stale','cancelled'))) operation_active
      FROM cases c LEFT JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
      LEFT JOIN case_folder_registrations r ON r.organization_id=c.organization_id AND r.case_id=c.id
      WHERE c.organization_id=$1 AND c.created_at<$3::timestamptz
        AND (l.storage_root_key=$2 OR l.id IS NULL) FOR UPDATE OF c`, [policy.organizationId, policy.storageRootKey, scanStartedAt])).rows
    const result = { archived: 0, restored: 0, statusUpdated: 0, inventoryDeferred: 0 }
    const audit = createAuditService()
    for (const row of rows) {
      // Only this reconciler's archives may be automatically restored.
      if (row.is_archived && !row.previous_inventory?.managedArchive) continue
      const observed = row.relative_path ? byPath.get(key(row.relative_path)) : undefined
      const present = observed && (!row.source_folder_id || row.source_folder_id === observed.sourceFolderId)
        && plateSearchKey(parseSourcePlateFolderName(observed.relativePath.split('/').at(-1)!)!.plate) === row.plate_normalized
      const archived = !present
      const closed = present && observed.relativePath.split('/').slice(0, -1).some(p => key(p).startsWith('KAPALI'))
      const status = present ? (closed ? 'closed' : 'open') : row.lifecycle_status
      const changedStatus = status !== row.lifecycle_status
      if (archived === row.is_archived && !changedStatus) continue
      if (row.operation_active) { result.inventoryDeferred++; continue }
      const previousStage = row.previous_inventory?.openStage
      const openStage = row.workflow_stage === 'closed' ? (typeof previousStage === 'string' ? previousStage : 'new_notification') : row.workflow_stage
      const stage = changedStatus ? (closed ? 'closed' : openStage) : row.workflow_stage
      await client.query(`UPDATE cases SET is_archived=$1,lifecycle_status=$2,workflow_stage=$3,version=version+1,updated_at=now()
        WHERE organization_id=$4 AND id=$5`, [archived, status, stage, policy.organizationId, row.id])
      await audit.record(client, { organizationId: policy.organizationId, actorUserId: policy.actorUserId,
        requestId: 'office-inventory-' + scanStartedAt, action: 'case.office_inventory_reconciled', entityType: 'case', entityId: row.id,
        details: { decision: policy.decision, managedArchive: archived, reason: present ? 'verified_office_placement' : 'outside_or_missing_office_folder',
          relativePath: row.relative_path, sourceFolderId: observed?.sourceFolderId ?? row.source_folder_id,
          previousStatus: row.lifecycle_status, status, previousStage: row.workflow_stage, openStage,
          previousArchived: row.is_archived, fromVersion: row.version, toVersion: row.version + 1,
          closureTimeUnknown: changedStatus && closed, childRecordsPreserved: true } })
      if (archived) result.archived++
      else if (row.is_archived) result.restored++
      if (changedStatus) result.statusUpdated++
    }
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
