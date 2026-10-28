import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const targetSchema = z.strictObject({ sourceFolderId: z.string().regex(/^\d+$/), relativePath: relativePathSchema })
export const identityRepairDecisionSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relationship: z.enum(['duplicate_claim', 'distinct_claims']),
  evidenceSha256: digest,
  // Each reference must identify independently checked official claim evidence, including the duplicate's history.
  cases: z.array(z.strictObject({ caseId: idSchema, officialEvidenceReference: z.string().trim().min(1).max(1000), target: targetSchema.nullable() })).length(2),
})
type Decision = z.infer<typeof identityRepairDecisionSchema>
interface Queryable { query: pg.Pool['query'] }
interface Actor { organizationId: string; actorUserId: string; requestId: string }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code: string): never => { throw new Error(code) }

async function snapshot(db: Queryable, organizationId: string, caseIds: string[]) {
  const rows = (await db.query(`SELECT c.id,c.version,c.is_archived,c.insurer_id,c.insurer_claim_number,c.loss_date::text,
    to_jsonb(l) location,to_jsonb(r) registration FROM cases c
    JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
    LEFT JOIN case_folder_registrations r ON r.organization_id=c.organization_id AND r.case_id=c.id
    WHERE c.organization_id=$1 AND c.id=ANY($2::uuid[]) ORDER BY c.id`, [organizationId, caseIds])).rows
  if (rows.length !== 2) fail('identity_repair_cases_required')
  const histories: Record<string, unknown> = {}
  // Include the content and review state, not just counts: equal counts can hide concurrent edits.
  for (const table of ['case_notes', 'documents', 'tracked_files', 'case_notice_sheets', 'tramer_requests', 'case_file_operations', 'case_lifecycle_operations', 'case_workspace_provisionings']) {
    histories[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.case_id,to_jsonb(t)::text),'[]') data
      FROM ${table} t WHERE organization_id=$1 AND case_id=ANY($2::uuid[])`, [organizationId, caseIds])).rows[0].data
  }
  for (const table of ['document_versions', 'document_observations']) {
    const join = table === 'document_versions' ? 'documents d ON d.id=t.document_id' : 'tracked_files d ON d.id=t.file_id'
    histories[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') data FROM ${table} t
      JOIN ${join} WHERE d.organization_id=$1 AND d.case_id=ANY($2::uuid[])`, [organizationId, caseIds])).rows[0].data
  }
  return { rows, histories }
}

async function assertIdle(db: Queryable, org: string, ids: string[]) {
  const active = await db.query(`SELECT 1 FROM cases c WHERE c.organization_id=$1 AND c.id=ANY($2::uuid[]) AND (
    EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('ready','failed','stale','cancelled')) OR
    EXISTS(SELECT 1 FROM case_lifecycle_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')) OR
    EXISTS(SELECT 1 FROM field_photo_uploads o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status IN ('receiving','queued','processing')) OR
    EXISTS(SELECT 1 FROM case_workspace_provisionings o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('ready','failed','stale','cancelled')) OR
    EXISTS(SELECT 1 FROM jobs j WHERE j.organization_id=c.organization_id AND j.status IN ('pending','leased') AND
      (j.target_id=c.id OR j.target_id IN (SELECT id FROM case_locations WHERE case_id=c.id) OR
       j.target_id IN (SELECT id FROM case_file_operations WHERE case_id=c.id) OR
       j.target_id IN (SELECT id FROM case_workspace_provisionings WHERE case_id=c.id) OR
       j.target_id IN (SELECT v.id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.case_id=c.id) OR
       j.target_id IN (SELECT id FROM photos WHERE case_id=c.id) OR
       j.target_id IN (SELECT e.id FROM document_text_extractions e JOIN document_versions v ON v.id=e.document_version_id JOIN documents d ON d.id=v.document_id WHERE d.case_id=c.id) OR
       j.target_id IN (SELECT o.id FROM document_ocr_runs o JOIN document_versions v ON v.id=o.document_version_id JOIN documents d ON d.id=v.document_id WHERE d.case_id=c.id))))`, [org, ids])
  if (active.rowCount) fail('identity_repair_operation_active')
}

export async function planIdentityRepair(db: Queryable, organizationId: string, input: Decision) {
  idSchema.parse(organizationId)
  const parsed = identityRepairDecisionSchema.parse(input)
  const decision = { ...parsed, cases: [...parsed.cases].sort((a, b) => a.caseId.localeCompare(b.caseId)) }
  const ids = decision.cases.map(c => c.caseId), targets = decision.cases.flatMap(c => c.target ? [c.target] : [])
  if (new Set(ids).size !== 2 || targets.length !== (decision.relationship === 'duplicate_claim' ? 1 : 2)
    || new Set(targets.map(t => t.sourceFolderId)).size !== targets.length
    || new Set(targets.map(t => t.relativePath.normalize('NFC').toUpperCase().normalize('NFC'))).size !== targets.length) fail('identity_repair_decision_invalid')
  if (!(await db.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active', [organizationId, decision.storageRootKey])).rowCount) fail('folder_active_root_required')
  await assertIdle(db, organizationId, ids)
  const before = await snapshot(db, organizationId, ids)
  for (const row of before.rows) {
    if (row.location.storage_root_key !== decision.storageRootKey || (row.registration && row.registration.storage_root_key !== decision.storageRootKey)) fail('identity_repair_root_mismatch')
    if (row.registration && !targets.some(t => t.sourceFolderId === row.registration.source_folder_id)) fail('identity_repair_identity_discarded')
    const target = decision.cases.find(c => c.caseId === row.id)!.target
    if (!target && !row.is_archived) fail('identity_repair_archived_duplicate_required')
    if (!target) continue
    // No temporary paths or deletion: occupied-path swaps require a separately approved physical relocation.
    if ((await db.query(`SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2 AND case_id<>$3
      AND hb_folder_path_key(relative_path)=hb_folder_path_key($4)
      UNION ALL SELECT 1 FROM case_workspace_provisionings WHERE organization_id=$1 AND storage_root_key=$2 AND case_id<>$3
      AND hb_folder_path_key(relative_path)=hb_folder_path_key($4)
      UNION ALL SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND destination_storage_root_key=$2 AND case_id<>$3
      AND hb_folder_path_key(destination_relative_path)=hb_folder_path_key($4) AND status NOT IN ('ready','stale','cancelled')`, [organizationId, decision.storageRootKey, row.id, target.relativePath])).rowCount) fail('identity_repair_target_occupied')
    if ((await db.query(`SELECT 1 FROM case_folder_registrations WHERE organization_id=$1 AND storage_root_key=$2
      AND source_folder_id=$3 AND NOT(case_id=ANY($4::uuid[]))`, [organizationId, decision.storageRootKey, target.sourceFolderId, ids])).rowCount) fail('identity_repair_identity_occupied')
  }
  const payload = { schemaVersion: 'folder-identity-repair/1' as const, organizationId, decision, before }
  return { ...payload, planHash: hash(payload) }
}
export type IdentityRepairPlan = Awaited<ReturnType<typeof planIdentityRepair>>
export interface RepairAssurance {
  /** Must reattest live cloud IDs, absent retired paths, and EVERY file hash against the approved evidence. No writes. */
  verifySource: (plan: IdentityRepairPlan) => Promise<void>
  /** Must create and restore-check a database backup plus independent, hash-verified folder copies before returning digests. */
  backup: (plan: IdentityRepairPlan) => Promise<{ databaseSha256: string; folderManifestSha256: string; restoreProofSha256: string }>
  /** Write and fsync the rollback receipt to the protected backup before the DB commit. A write failure aborts the repair. */
  persistReceipt: (receipt: unknown) => Promise<void>
}

async function lockRepair(client: pg.PoolClient, actor: Actor, plan: IdentityRepairPlan) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${actor.organizationId}:${plan.decision.storageRootKey}`])
  if (!(await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
    AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.organizationId, actor.actorUserId])).rowCount) fail('folder_admin_required')
  const ids = plan.decision.cases.map(c => c.caseId)
  await client.query('SELECT id FROM cases WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [actor.organizationId, ids])
  await client.query('SELECT id FROM case_locations WHERE organization_id=$1 AND case_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [actor.organizationId, ids])
  await assertIdle(client, actor.organizationId, ids)
}

/** Maintenance-only entry point; intentionally no public HTTP route or automatic caller. Never moves/deletes customer files. */
export async function applyIdentityRepair(pool: pg.Pool, actor: Actor, plan: IdentityRepairPlan,
  approval: { operatorId: string; approvedPlanHash: string; approvedAt: string }, assurance: RepairAssurance) {
  const { planHash, ...payload } = plan
  if (actor.organizationId !== plan.organizationId || approval.operatorId !== actor.actorUserId || approval.approvedPlanHash !== planHash
    || hash(payload) !== planHash || !Number.isFinite(Date.parse(approval.approvedAt))) fail('identity_repair_approval_required')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockRepair(client, actor, plan)
    const ids = plan.decision.cases.map(c => c.caseId)
    const current = await snapshot(client, actor.organizationId, ids)
    const replay = (await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND action='cases.folder_identity_repaired'
      AND details->>'planDigest'=$2`, [actor.organizationId, planHash])).rows[0]
    if (replay) {
      if (hash(current) !== replay.details.afterDigest) fail('identity_repair_post_apply_drift')
      await assurance.verifySource(plan)
      await client.query('COMMIT')
      return { alreadyApplied: true, receipt: null }
    }
    if (hash(current) !== hash(plan.before)) fail('identity_repair_plan_stale')
    if ((await planIdentityRepair(client, actor.organizationId, plan.decision)).planHash !== planHash) fail('identity_repair_plan_stale')
    await assurance.verifySource(plan)
    const backup = await assurance.backup(plan)
    for (const value of Object.values(backup)) digest.parse(value)
    if (Object.keys(backup).sort().join() !== 'databaseSha256,folderManifestSha256,restoreProofSha256') fail('identity_repair_backup_required')
    await client.query('DELETE FROM case_folder_registrations WHERE organization_id=$1 AND case_id=ANY($2::uuid[])', [actor.organizationId, ids])
    const audit = createAuditService()
    for (const item of plan.decision.cases) {
      const old = plan.before.rows.find(r => r.id === item.caseId)!, target = item.target
      if (target) {
        const registration = plan.before.rows.map(r => r.registration).find(r => r?.source_folder_id === target.sourceFolderId)
        await client.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,coalesce($10::timestamptz,now()))`, [registration?.id ?? uuidv7(), actor.organizationId, item.caseId,
          plan.decision.storageRootKey, target.sourceFolderId, target.relativePath, JSON.stringify({ ...registration?.evidence, identityRepair: { planHash, previousBinding: registration ?? null } }),
          planHash, registration?.created_by_user_id ?? actor.actorUserId, registration?.created_at ?? null])
      }
      await client.query(`UPDATE case_locations SET relative_path=$1,verification_status=$2,version=version+1,updated_at=now() WHERE organization_id=$3 AND case_id=$4`,
        [target?.relativePath ?? old.location.relative_path, target ? 'verified' : 'missing', actor.organizationId, item.caseId])
      // No relocation path chain is asserted: this is an identity correction, not evidence that document ownership moved.
      await client.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,$6,'system',$7,$8)`, [uuidv7(), actor.organizationId, item.caseId, plan.decision.storageRootKey,
        target?.relativePath ?? old.location.relative_path, target ? 'verified' : 'missing', actor.actorUserId, actor.requestId])
      await audit.record(client, { ...actor, action: 'case.folder_identity_repaired', entityType: 'case', entityId: item.caseId, details: { planDigest: planHash, relationship: plan.decision.relationship, historyPreserved: true } })
    }
    await assurance.verifySource(plan)
    const after = await snapshot(client, actor.organizationId, ids)
    if (hash(after.histories) !== hash(plan.before.histories)
      || after.rows.some(row => row.version !== plan.before.rows.find(r => r.id === row.id)!.version)) fail('identity_repair_history_changed')
    const receipt = { plan, after, backup }, receiptHash = hash(receipt)
    await assurance.persistReceipt(receipt)
    await audit.record(client, { ...actor, action: 'cases.folder_identity_repaired', entityType: 'organization', entityId: actor.organizationId,
      details: { planDigest: planHash, receiptDigest: receiptHash, beforeDigest: hash(plan.before), afterDigest: hash(after), backup, operatorId: approval.operatorId, approvedAt: approval.approvedAt } })
    await client.query('COMMIT')
    return { alreadyApplied: false, receipt }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function rollbackIdentityRepair(pool: pg.Pool, actor: Actor,
  receipt: NonNullable<Awaited<ReturnType<typeof applyIdentityRepair>>['receipt']>, approvedReceiptHash: string,
  verifyBackup: () => Promise<void>) {
  if (actor.organizationId !== receipt.plan.organizationId || hash(receipt) !== approvedReceiptHash) fail('identity_repair_rollback_approval_required')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockRepair(client, actor, receipt.plan)
    const applied = await client.query(`SELECT 1 FROM audit_events WHERE organization_id=$1 AND action='cases.folder_identity_repaired' AND details->>'receiptDigest'=$2`, [actor.organizationId, approvedReceiptHash])
    if (!applied.rowCount) fail('identity_repair_receipt_unknown')
    const ids = receipt.plan.decision.cases.map(c => c.caseId)
    const replay = await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND action='cases.folder_identity_rolled_back' AND details->>'receiptDigest'=$2`, [actor.organizationId, approvedReceiptHash])
    if (replay.rowCount) {
      if (hash(await snapshot(client, actor.organizationId, ids)) !== replay.rows[0].details.afterDigest) fail('identity_repair_rollback_drift')
      await client.query('COMMIT'); return { alreadyRolledBack: true }
    }
    if (hash(await snapshot(client, actor.organizationId, ids)) !== hash(receipt.after)) fail('identity_repair_rollback_drift')
    await verifyBackup()
    await client.query('DELETE FROM case_folder_registrations WHERE organization_id=$1 AND case_id=ANY($2::uuid[])', [actor.organizationId, ids])
    for (const row of receipt.plan.before.rows) {
      const r = row.registration, l = row.location
      if (r) await client.query(`INSERT INTO case_folder_registrations SELECT * FROM jsonb_populate_record(NULL::case_folder_registrations,$1::jsonb)`, [JSON.stringify(r)])
      await client.query(`UPDATE case_locations SET relative_path=$1,verification_status=$2,source=$3,version=version+1,updated_at=now() WHERE organization_id=$4 AND case_id=$5`,
        [l.relative_path, l.verification_status, l.source, actor.organizationId, row.id])
      await client.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,$6,'system',$7,$8)`, [uuidv7(), actor.organizationId, row.id, l.storage_root_key,l.relative_path,l.verification_status,actor.actorUserId,actor.requestId])
    }
    await createAuditService().record(client, { ...actor, action: 'cases.folder_identity_rolled_back', entityType: 'organization', entityId: actor.organizationId,
      details: { receiptDigest: approvedReceiptHash, planDigest: receipt.plan.planHash, afterDigest: hash(await snapshot(client, actor.organizationId, ids)), historyPreserved: true } })
    await client.query('COMMIT')
    return { alreadyRolledBack: false }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
