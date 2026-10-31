import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { parseSourcePlateFolderName, plateSearchKey } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { enqueueVerifyJob } from '../agent/enqueue.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const locationSchema = z.strictObject({ id: idSchema, storageRootKey: storageRootKeySchema, relativePath: relativePathSchema, version: z.number().int().positive() })
export const folderLocationReconciliationSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  decision: z.string().trim().min(1).max(1000),
  bindings: z.array(z.strictObject({
    caseId: idSchema, sourceFolderId: z.string().regex(/^[0-9]+$/), relativePath: relativePathSchema,
    expectedCaseVersion: z.number().int().positive(), physicallyClosed: z.boolean(),
    stableSourceIdentity: digest, sourceFileHash: digest,
    previousLocation: locationSchema.nullable(),
  })).min(1).max(10_000),
})
export type FolderLocationReconciliation = z.infer<typeof folderLocationReconciliationSchema>
interface Queryable { query: pg.Pool['query'] }
interface Actor { organizationId: string; actorUserId: string; requestId: string }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code: string): never => { throw new Error(code) }

/** Only an existing V1 import's immutable identity can authorize a location repair. */
export async function planFolderLocationReconciliation(db: Queryable, organizationId: string, input: FolderLocationReconciliation) {
  idSchema.parse(organizationId)
  const parsed = folderLocationReconciliationSchema.parse(input)
  const manifest = { ...parsed, bindings: [...parsed.bindings].sort((a, b) => a.caseId.localeCompare(b.caseId)) }
  if (new Set(manifest.bindings.map(b => b.caseId)).size !== manifest.bindings.length
    || new Set(manifest.bindings.map(b => b.sourceFolderId)).size !== manifest.bindings.length
    || new Set(manifest.bindings.map(b => b.relativePath.toLowerCase())).size !== manifest.bindings.length) fail('folder_binding_duplicate')
  if (!(await db.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active', [organizationId, manifest.storageRootKey])).rowCount) fail('folder_active_root_required')
  for (const binding of manifest.bindings) {
    const result = await db.query('SELECT plate_normalized,lifecycle_status,version FROM cases WHERE organization_id=$1 AND id=$2 AND NOT is_archived FOR SHARE', [organizationId, binding.caseId])
    const row = result.rows[0]
    if (!row) fail('folder_binding_case_not_found')
    const plate = parseSourcePlateFolderName(binding.relativePath.split('/').at(-1)!)?.plate
    if (!plate || plateSearchKey(plate) !== row.plate_normalized) fail('folder_binding_plate_mismatch')
    if (row.version !== binding.expectedCaseVersion) fail('folder_binding_case_version_changed')
    const closed = binding.relativePath.split('/').slice(0, -1).some(p => p.toLocaleUpperCase('tr').startsWith('KAPALI'))
    if (closed !== binding.physicallyClosed || row.lifecycle_status !== (closed ? 'closed' : 'open')) fail('folder_binding_lifecycle_mismatch')
    const origin = await db.query(`SELECT 1 FROM v1_import_records r
      LEFT JOIN v1_import_record_reconciliations reconciliation ON reconciliation.legacy_import_record_id=r.id AND reconciliation.organization_id=r.organization_id
      WHERE r.organization_id=$1 AND r.case_id=$2 AND r.item_type='case' AND r.target_type='case' AND r.target_id=$2
        AND r.status IN ('created','backfilled','skipped_existing')
        AND coalesce(r.stable_source_identity,reconciliation.stable_source_identity)=$3`, [organizationId, binding.caseId, binding.stableSourceIdentity])
    if (!origin.rowCount) fail('folder_binding_v1_identity_required')
    const current = (await db.query('SELECT id,storage_root_key,relative_path,version FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR SHARE', [organizationId, binding.caseId])).rows[0]
    const location = current ? { id: current.id, storageRootKey: current.storage_root_key, relativePath: current.relative_path, version: current.version } : null
    if (JSON.stringify(location) !== JSON.stringify(binding.previousLocation)) fail('folder_binding_location_changed')
    if ((await db.query(`SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2 AND hb_folder_path_key(relative_path)=hb_folder_path_key($3) AND case_id<>$4
      UNION ALL SELECT 1 FROM case_workspace_provisionings WHERE organization_id=$1 AND storage_root_key=$2 AND hb_folder_path_key(relative_path)=hb_folder_path_key($3) AND case_id<>$4
      UNION ALL SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND destination_storage_root_key=$2 AND hb_folder_path_key(destination_relative_path)=hb_folder_path_key($3)
        AND case_id<>$4 AND status NOT IN ('ready','stale','cancelled')`, [organizationId, manifest.storageRootKey, binding.relativePath, binding.caseId])).rowCount) fail('folder_binding_location_in_use')
    if ((await db.query('SELECT 1 FROM case_folder_registrations WHERE organization_id=$1 AND (case_id=$2 OR (storage_root_key=$3 AND source_folder_id=$4))', [organizationId, binding.caseId, manifest.storageRootKey, binding.sourceFolderId])).rowCount) fail('folder_binding_already_registered')
  }
  const payload = { organizationId, manifest }
  return { ...payload, planHash: hash(payload) }
}

/** verifySource must check live V1 identity/hash, folder ID, and absence of the old source for a move. */
export async function applyFolderLocationReconciliation(pool: pg.Pool, actor: Actor,
  plan: Awaited<ReturnType<typeof planFolderLocationReconciliation>>, approvedHash: string,
  verifySource: (binding: FolderLocationReconciliation['bindings'][number], storageRootKey: string) => Promise<void>) {
  const { planHash, ...payload } = plan
  if (actor.organizationId !== plan.organizationId || planHash !== approvedHash || hash(payload) !== approvedHash) fail('folder_binding_approval_mismatch')
  for (const binding of plan.manifest.bindings) await verifySource(binding, plan.manifest.storageRootKey)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!(await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.organizationId, actor.actorUserId])).rowCount) fail('folder_admin_required')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${actor.organizationId}:${plan.manifest.storageRootKey}`])
    if ((await client.query("SELECT 1 FROM audit_events WHERE organization_id=$1 AND action='cases.folder_locations_reconciled' AND details->>'planDigest'=$2", [actor.organizationId, approvedHash])).rowCount) { await client.query('COMMIT'); return { reconciled: 0, alreadyApplied: true } }
    if ((await planFolderLocationReconciliation(client, actor.organizationId, plan.manifest)).planHash !== approvedHash) fail('folder_binding_plan_stale')
    const audit = createAuditService()
    for (const binding of plan.manifest.bindings) {
      const previous = binding.previousLocation
      const locationId = previous?.id ?? uuidv7(), version = (previous?.version ?? 0) + 1
      if (previous) await client.query(`UPDATE case_locations SET storage_root_key=$1,relative_path=$2,source='imported',verification_status='pending',version=version+1,updated_at=now()
        WHERE organization_id=$3 AND id=$4`, [plan.manifest.storageRootKey, binding.relativePath, actor.organizationId, locationId])
      else await client.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
        VALUES($1,$2,$3,$4,$5,'pending','imported')`, [locationId, actor.organizationId, binding.caseId, plan.manifest.storageRootKey, binding.relativePath])
      await client.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,'pending','imported',$6,$7)`, [uuidv7(), actor.organizationId, binding.caseId, plan.manifest.storageRootKey, binding.relativePath, actor.actorUserId, actor.requestId])
      await client.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [uuidv7(), actor.organizationId, binding.caseId, plan.manifest.storageRootKey, binding.sourceFolderId, binding.relativePath,
        JSON.stringify({ stableSourceIdentity: binding.stableSourceIdentity, sourceFileHash: binding.sourceFileHash, previousLocation: previous, decision: plan.manifest.decision, bindingOnly: true, historicalDataPreserved: true }), approvedHash, actor.actorUserId])
      await enqueueVerifyJob(client, { organizationId: actor.organizationId, type: 'verify_case_location', targetType: 'case_location', targetId: locationId, targetVersion: version,
        payload: { storageRootKey: plan.manifest.storageRootKey, relativePath: binding.relativePath, kind: 'directory', declaredHash: null, declaredSize: null } })
      await audit.record(client, { ...actor, action: previous ? 'case.location_updated' : 'case.location_assigned', entityType: 'case', entityId: binding.caseId,
        details: { source: 'v1_identity_location_reconciliation', sourceFolderId: binding.sourceFolderId, planDigest: approvedHash, previousPath: previous?.relativePath ?? null, relativePath: binding.relativePath, fromVersion: previous?.version ?? null, toVersion: version } })
    }
    await audit.record(client, { ...actor, action: 'cases.folder_locations_reconciled', entityType: 'organization', entityId: actor.organizationId, details: { planDigest: approvedHash, reconciled: plan.manifest.bindings.length } })
    await client.query('COMMIT')
    return { reconciled: plan.manifest.bindings.length, alreadyApplied: false }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
