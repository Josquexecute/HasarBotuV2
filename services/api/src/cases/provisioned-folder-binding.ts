import { createHash } from 'node:crypto'
import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import type { AutomaticFolderPolicy, ObservedPlateFolder } from './automatic-folder-registration.js'

/** Bind the cloud identity to its creating workspace, never to a plate/name candidate. */
export async function bindProvisionedFolder(pool: pg.Pool, policy: AutomaticFolderPolicy,
  folder: ObservedPlateFolder, verifySource: () => Promise<void>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${policy.organizationId}:${policy.storageRootKey}`])
    const plan = (await client.query(`SELECT w.case_id,w.status FROM case_workspace_provisionings w
      WHERE w.organization_id=$1 AND w.id=$2 AND w.storage_root_key=$3 FOR UPDATE OF w`,
    [policy.organizationId, folder.workspaceId, policy.storageRootKey])).rows[0]
    if (!plan) throw new Error('folder_workspace_identity_unknown')
    if (plan.status !== 'ready') throw new Error('folder_workspace_pending')
    const location = (await client.query('SELECT storage_root_key,relative_path FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
      [policy.organizationId, plan.case_id])).rows[0]
    if (location?.storage_root_key !== policy.storageRootKey || location.relative_path !== folder.relativePath) throw new Error('folder_workspace_location_changed')
    const registrations = (await client.query(`SELECT case_id,source_folder_id FROM case_folder_registrations
      WHERE organization_id=$1 AND (case_id=$2 OR (storage_root_key=$3 AND source_folder_id=$4))`,
    [policy.organizationId, plan.case_id, policy.storageRootKey, folder.sourceFolderId])).rows
    if (registrations.length) {
      if (registrations.length !== 1 || registrations[0].case_id !== plan.case_id || registrations[0].source_folder_id !== folder.sourceFolderId) throw new Error('folder_identity_owner_conflict')
      await client.query('COMMIT')
      return
    }
    if (!(await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`,
    [policy.organizationId, policy.actorUserId])).rowCount) throw new Error('folder_admin_required')
    if (!(await client.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active',
      [policy.organizationId, policy.storageRootKey])).rowCount) throw new Error('folder_active_root_required')
    await verifySource()
    const evidence = { workspaceId: folder.workspaceId, observationHash: folder.observationHash, decision: policy.decision }
    const planHash = createHash('sha256').update(JSON.stringify({ organizationId: policy.organizationId, folder, caseId: plan.case_id })).digest('hex')
    await client.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [uuidv7(), policy.organizationId, plan.case_id, policy.storageRootKey, folder.sourceFolderId,
      folder.relativePath, JSON.stringify(evidence), planHash, policy.actorUserId])
    await createAuditService().record(client, { organizationId: policy.organizationId, actorUserId: policy.actorUserId,
      requestId: `workspace-cloud-binding-${folder.workspaceId}`, action: 'case.workspace_cloud_bound', entityType: 'case', entityId: plan.case_id,
      details: { ...evidence, sourceFolderId: folder.sourceFolderId, planDigest: planHash } })
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
