import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { parseSourcePlateFolderName, plateSearchKey } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { enqueueVerifyJob } from '../agent/enqueue.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const sourceFolderRelocationSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  decision: z.string().trim().min(1).max(1000),
  bindings: z.array(z.strictObject({
    caseId: idSchema,
    sourceFolderId: z.string().regex(/^[0-9]+$/),
    relativePath: relativePathSchema,
    expectedCaseVersion: z.number().int().positive(),
    expectedLifecycleStatus: z.enum(['open', 'closed']),
    physicallyClosed: z.boolean(),
    previousLocation: z.strictObject({ id: idSchema, storageRootKey: storageRootKeySchema, relativePath: relativePathSchema, version: z.number().int().positive() }),
    identity: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('registered') }),
      z.strictObject({ kind: z.literal('v1'), stableSourceIdentity: digest, sourceFileHash: digest }),
    ]),
  })).min(1).max(10_000),
})
export type SourceFolderRelocation = z.infer<typeof sourceFolderRelocationSchema>
interface Queryable { query: pg.Pool['query'] }
interface Actor { organizationId: string; actorUserId: string; requestId: string }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code: string): never => { throw new Error(code) }

/** Source moves update locations only. Physical closed placement cannot authorize a business closure. */
export async function planSourceFolderRelocation(db: Queryable, organizationId: string, input: SourceFolderRelocation) {
  idSchema.parse(organizationId)
  const parsed = sourceFolderRelocationSchema.parse(input)
  const manifest = { ...parsed, bindings: [...parsed.bindings].sort((a, b) => a.caseId.localeCompare(b.caseId)) }
  for (const field of ['caseId', 'sourceFolderId', 'relativePath'] as const) {
    if (new Set(manifest.bindings.map(b => b[field].toLowerCase())).size !== manifest.bindings.length) fail('folder_relocation_duplicate')
  }
  if (!(await db.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active', [organizationId, manifest.storageRootKey])).rowCount) fail('folder_active_root_required')
  for (const binding of manifest.bindings) {
    const row = (await db.query('SELECT plate_normalized,lifecycle_status,version FROM cases WHERE organization_id=$1 AND id=$2 AND NOT is_archived FOR SHARE', [organizationId, binding.caseId])).rows[0]
    if (!row) fail('folder_relocation_case_not_found')
    const plate = parseSourcePlateFolderName(binding.relativePath.split('/').at(-1)!)?.plate
    if (!plate || plateSearchKey(plate) !== row.plate_normalized) fail('folder_relocation_plate_mismatch')
    if (row.version !== binding.expectedCaseVersion || row.lifecycle_status !== binding.expectedLifecycleStatus) fail('folder_relocation_case_changed')
    const closed = binding.relativePath.split('/').slice(0, -1).some(p => p.toLocaleUpperCase('tr').startsWith('KAPALI'))
    if (closed !== binding.physicallyClosed) fail('folder_relocation_placement_mismatch')
    const current = (await db.query('SELECT id,storage_root_key,relative_path,version FROM case_locations WHERE organization_id=$1 AND case_id=$2 FOR SHARE', [organizationId, binding.caseId])).rows[0]
    const previous = binding.previousLocation
    if (!current || current.id !== previous.id || current.storage_root_key !== previous.storageRootKey || current.relative_path !== previous.relativePath || current.version !== previous.version) fail('folder_relocation_location_changed')
    if (previous.storageRootKey !== manifest.storageRootKey || previous.relativePath.toLowerCase() === binding.relativePath.toLowerCase()) fail('folder_relocation_move_required')
    if ((await db.query('SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2 AND lower(relative_path)=lower($3) AND case_id<>$4', [organizationId, manifest.storageRootKey, binding.relativePath, binding.caseId])).rowCount) fail('folder_relocation_location_in_use')
    const registrations = (await db.query('SELECT case_id,storage_root_key,source_folder_id FROM case_folder_registrations WHERE organization_id=$1 AND (case_id=$2 OR (storage_root_key=$3 AND source_folder_id=$4)) FOR SHARE', [organizationId, binding.caseId, manifest.storageRootKey, binding.sourceFolderId])).rows
    if (binding.identity.kind === 'registered') {
      if (registrations.length !== 1 || registrations[0].case_id !== binding.caseId || registrations[0].storage_root_key !== manifest.storageRootKey || registrations[0].source_folder_id !== binding.sourceFolderId) fail('folder_relocation_registered_identity_required')
    } else {
      if (registrations.length) fail('folder_relocation_already_registered')
      const origin = await db.query(`SELECT 1 FROM v1_import_records r
        LEFT JOIN v1_import_record_reconciliations x ON x.legacy_import_record_id=r.id AND x.organization_id=r.organization_id
        WHERE r.organization_id=$1 AND r.case_id=$2 AND r.item_type='case' AND r.target_type='case' AND r.target_id=$2
          AND r.status IN ('created','backfilled','skipped_existing') AND coalesce(r.stable_source_identity,x.stable_source_identity)=$3`, [organizationId, binding.caseId, binding.identity.stableSourceIdentity])
      if (!origin.rowCount) fail('folder_relocation_v1_identity_required')
    }
  }
  const payload = { organizationId, manifest }
  return { ...payload, planHash: hash(payload) }
}

/** The verifier must attest the live folder ID, absent old path and, for V1, current sidecar hash/identity. */
export async function applySourceFolderRelocation(pool: pg.Pool, actor: Actor,
  plan: Awaited<ReturnType<typeof planSourceFolderRelocation>>, approvedHash: string,
  verifySource: (binding: SourceFolderRelocation['bindings'][number], storageRootKey: string) => Promise<void>) {
  const { planHash, ...payload } = plan
  if (actor.organizationId !== plan.organizationId || approvedHash !== planHash || hash(payload) !== approvedHash) fail('folder_relocation_approval_mismatch')
  for (const binding of plan.manifest.bindings) await verifySource(binding, plan.manifest.storageRootKey)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!(await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.organizationId, actor.actorUserId])).rowCount) fail('folder_admin_required')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${actor.organizationId}:${plan.manifest.storageRootKey}`])
    if ((await client.query("SELECT 1 FROM audit_events WHERE organization_id=$1 AND action='cases.source_folders_relocated' AND details->>'planDigest'=$2", [actor.organizationId, approvedHash])).rowCount) {
      await client.query('COMMIT')
      return { relocated: 0, alreadyApplied: true }
    }
    if ((await planSourceFolderRelocation(client, actor.organizationId, plan.manifest)).planHash !== approvedHash) fail('folder_relocation_plan_stale')
    const audit = createAuditService()
    for (const binding of plan.manifest.bindings) {
      const previous = binding.previousLocation, version = previous.version + 1
      await client.query(`UPDATE case_locations SET relative_path=$1,source='imported',verification_status='pending',version=version+1,updated_at=now()
        WHERE organization_id=$2 AND id=$3`, [binding.relativePath, actor.organizationId, previous.id])
      // Live identity + absent old path attest a completed physical move. Keep its path chain
      // so immutable document versions and tracked-file approvals follow the same case.
      await client.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,previous_storage_root_key,previous_relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,'pending','system',$8,$9)`, [uuidv7(), actor.organizationId, binding.caseId, plan.manifest.storageRootKey, binding.relativePath, previous.storageRootKey, previous.relativePath, actor.actorUserId, actor.requestId])
      const evidence = { identity: binding.identity, previousLocation: previous, decision: plan.manifest.decision, planDigest: approvedHash, physicallyClosed: binding.physicallyClosed, preservedLifecycleStatus: binding.expectedLifecycleStatus }
      if (binding.identity.kind === 'registered') {
        await client.query(`UPDATE case_folder_registrations SET source_relative_path=$1,evidence=evidence||jsonb_build_object('lastRelocation',$2::jsonb)
          WHERE organization_id=$3 AND case_id=$4`, [binding.relativePath, JSON.stringify(evidence), actor.organizationId, binding.caseId])
      } else {
        await client.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [uuidv7(), actor.organizationId, binding.caseId, plan.manifest.storageRootKey, binding.sourceFolderId, binding.relativePath, JSON.stringify(evidence), approvedHash, actor.actorUserId])
      }
      await enqueueVerifyJob(client, { organizationId: actor.organizationId, type: 'verify_case_location', targetType: 'case_location', targetId: previous.id, targetVersion: version,
        payload: { storageRootKey: plan.manifest.storageRootKey, relativePath: binding.relativePath, kind: 'directory', declaredHash: null, declaredSize: null } })
      await audit.record(client, { ...actor, action: 'case.location_updated', entityType: 'case', entityId: binding.caseId, details: evidence })
    }
    await audit.record(client, { ...actor, action: 'cases.source_folders_relocated', entityType: 'organization', entityId: actor.organizationId, details: { planDigest: approvedHash, relocated: plan.manifest.bindings.length, businessRecordsPreserved: true } })
    await client.query('COMMIT')
    return { relocated: plan.manifest.bindings.length, alreadyApplied: false }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
