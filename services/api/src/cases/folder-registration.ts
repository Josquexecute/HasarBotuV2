import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { decideV1ClaimTypeFromEvidence, parseSourcePlateFolderName, plateSearchKey, type PlateNumber } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { enqueueVerifyJob } from '../agent/enqueue.js'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const folderRegistrationManifestSchema = z.strictObject({
  schemaVersion: z.literal('hasarbotu-folder-registration/1'),
  storageRootKey: storageRootKeySchema,
  responsibleUserId: idSchema,
  expertUserId: idSchema,
  decision: z.string().trim().min(1).max(1000),
  folders: z.array(z.strictObject({
    sourceFolderId: z.string().regex(/^[0-9]+$/),
    relativePath: relativePathSchema,
    physicallyClosed: z.boolean(),
    caseType: z.enum(['traffic', 'casco']).nullable(),
    evidence: z.strictObject({
      inventoryHash: sha256,
      evidenceHash: sha256,
      kinds: z.array(z.enum(['k_ruhsat', 'm_ruhsat', 's_ruhsat', 'kasko_policy_context', 'm_traffic_policy', 'traffic_policy_context', 'ktt_context', 'accident_report_context', 'statement_context', 'traffic_policy_content', 'casco_policy_content'])),
      userTypeDecision: z.string().trim().min(1).max(1000).optional(),
    }),
  })).min(1).max(10_000),
})
export type FolderRegistrationManifest = z.infer<typeof folderRegistrationManifestSchema>
type Folder = FolderRegistrationManifest['folders'][number]
interface Actor { organizationId: string; actorUserId: string; requestId: string }
interface Queryable { query: pg.Pool['query'] }
export interface FolderRegistrationPlan {
  organizationId: string
  manifest: FolderRegistrationManifest
  entries: { sourceFolderId: string; plate: PlateNumber; caseId: string | null }[]
  planHash: string
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code: string): never => { throw new Error(code) }

/** Register observed folders as cases, independently of historical V1 payloads. */
export async function planFolderRegistration(db: Queryable, organizationId: string, input: FolderRegistrationManifest): Promise<FolderRegistrationPlan> {
  idSchema.parse(organizationId)
  const parsed = folderRegistrationManifestSchema.parse(input)
  const manifest = { ...parsed, folders: [...parsed.folders].sort((a, b) => a.sourceFolderId.localeCompare(b.sourceFolderId)) }
  if (new Set(manifest.folders.map(f => f.sourceFolderId)).size !== manifest.folders.length
    || new Set(manifest.folders.map(f => f.relativePath.toLocaleLowerCase('tr'))).size !== manifest.folders.length) fail('folder_duplicate_source')
  const root = await db.query('SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active FOR SHARE', [organizationId, manifest.storageRootKey])
  if (!root.rowCount) fail('folder_active_root_required')
  for (const [id, role] of [[manifest.responsibleUserId, 'case_manager'], [manifest.expertUserId, 'expert']]) {
    const account = await db.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code=$3) FOR SHARE OF u`, [organizationId, id, role])
    if (!account.rowCount) fail('folder_active_assignment_required')
  }
  const entries: FolderRegistrationPlan['entries'] = []
  for (const folder of manifest.folders) {
    const segments = folder.relativePath.split('/')
    const parsedName = parseSourcePlateFolderName(segments.at(-1)!)
    if (!parsedName) fail('folder_plate_required')
    const physicallyClosed = segments.slice(0, -1).some(s => s.toLocaleUpperCase('tr').startsWith('KAPALI'))
    if (physicallyClosed !== folder.physicallyClosed) fail('folder_lifecycle_evidence_mismatch')
    const classification = decideV1ClaimTypeFromEvidence({ sidecarClaimType: 'unknown', evidenceKinds: folder.evidence.kinds })
    if (classification.caseType !== folder.caseType && !folder.evidence.userTypeDecision) fail('folder_type_evidence_required')
    const registered = await db.query(`SELECT r.case_id,c.plate_normalized FROM case_folder_registrations r
      JOIN cases c ON c.id=r.case_id AND c.organization_id=r.organization_id
      WHERE r.organization_id=$1 AND r.storage_root_key=$2 AND r.source_folder_id=$3`, [organizationId, manifest.storageRootKey, folder.sourceFolderId])
    if (registered.rows[0]) {
      if (registered.rows[0].plate_normalized !== plateSearchKey(parsedName!.plate)) fail('folder_registered_plate_changed')
      entries.push({ sourceFolderId: folder.sourceFolderId, plate: parsedName!.plate, caseId: registered.rows[0].case_id })
      continue
    }
    const bound = await db.query('SELECT case_id FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2 AND lower(relative_path)=lower($3)', [organizationId, manifest.storageRootKey, folder.relativePath])
    if (bound.rowCount) fail('folder_location_already_bound')
    // A plate is not a case identity. Existing cases require explicit reconciliation;
    // distinct source folders within this new batch may legitimately share a plate.
    const candidate = await db.query('SELECT 1 FROM cases WHERE organization_id=$1 AND plate_normalized=$2', [organizationId, plateSearchKey(parsedName!.plate)])
    if (candidate.rowCount) fail('folder_existing_plate_requires_reconciliation')
    entries.push({ sourceFolderId: folder.sourceFolderId, plate: parsedName!.plate, caseId: null })
  }
  const payload = { organizationId, manifest, entries }
  return { ...payload, planHash: hash(payload) }
}

/** Caller must reread source identity, sidecar absence and evidence before the DB transaction. */
export async function applyFolderRegistration(pool: pg.Pool, actor: Actor, plan: FolderRegistrationPlan, approvedHash: string,
  verifySource: (folder: Folder, storageRootKey: string) => Promise<void>) {
  const { planHash, ...payload } = plan
  if (planHash !== approvedHash || hash(payload) !== approvedHash) fail('folder_plan_approval_mismatch')
  if (actor.organizationId !== plan.organizationId) fail('folder_actor_tenant_mismatch')
  for (const folder of plan.manifest.folders) await verifySource(folder, plan.manifest.storageRootKey)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const admin = await client.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.organizationId, actor.actorUserId])
    if (!admin.rowCount) fail('folder_admin_required')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-registration:${actor.organizationId}:${plan.manifest.storageRootKey}`])
    const replay = await client.query("SELECT 1 FROM audit_events WHERE organization_id=$1 AND action='cases.folders_registered' AND details->>'planDigest'=$2", [actor.organizationId, approvedHash])
    if (replay.rowCount) { await client.query('COMMIT'); return { created: 0, alreadyApplied: true, caseIds: [] as string[] } }
    const fresh = await planFolderRegistration(client, actor.organizationId, plan.manifest)
    if (fresh.planHash !== approvedHash) fail('folder_plan_stale')
    const audit = createAuditService()
    const year = Number((await client.query("SELECT to_char(now() AT TIME ZONE 'Europe/Istanbul','YYYY') AS office_year")).rows[0].office_year)
    const caseIds: string[] = []
    for (const [index, folder] of fresh.manifest.folders.entries()) {
      if (fresh.entries[index]!.caseId !== null) continue
      const caseId = uuidv7(), locationId = uuidv7()
      const sequence = (await client.query(`INSERT INTO office_counters(organization_id,office_year,last_sequence) VALUES($1,$2,1)
        ON CONFLICT(organization_id,office_year) DO UPDATE SET last_sequence=office_counters.last_sequence+1 RETURNING last_sequence`, [actor.organizationId, year])).rows[0].last_sequence
      await client.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,
        lifecycle_status,workflow_stage,responsible_user_id,expert_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [caseId, actor.organizationId, year, sequence, `${year}/${sequence}`, folder.caseType,
        fresh.entries[index]!.plate, plateSearchKey(fresh.entries[index]!.plate), folder.physicallyClosed ? 'closed' : 'open', folder.physicallyClosed ? 'closed' : 'new_notification', fresh.manifest.responsibleUserId, fresh.manifest.expertUserId])
      await client.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
        VALUES($1,$2,$3,$4,$5,'pending','imported')`, [locationId, actor.organizationId, caseId, fresh.manifest.storageRootKey, folder.relativePath])
      await client.query(`INSERT INTO case_location_history(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source,changed_by_user_id,request_id)
        VALUES($1,$2,$3,$4,$5,'pending','imported',$6,$7)`, [uuidv7(), actor.organizationId, caseId, fresh.manifest.storageRootKey, folder.relativePath, actor.actorUserId, actor.requestId])
      await client.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [uuidv7(), actor.organizationId, caseId, fresh.manifest.storageRootKey, folder.sourceFolderId, folder.relativePath,
        JSON.stringify({ ...folder.evidence, physicallyClosed: folder.physicallyClosed, historicalPayloadAvailable: false, closureTimeKnown: false, decision: fresh.manifest.decision }), approvedHash, actor.actorUserId])
      await enqueueVerifyJob(client, { organizationId: actor.organizationId, type: 'verify_case_location', targetType: 'case_location', targetId: locationId, targetVersion: 1,
        payload: { storageRootKey: fresh.manifest.storageRootKey, relativePath: folder.relativePath, kind: 'directory', declaredHash: null, declaredSize: null } })
      await audit.record(client, { ...actor, action: 'case.created', entityType: 'case', entityId: caseId,
        details: { source: 'folder_registration', sourceFolderId: folder.sourceFolderId, planDigest: approvedHash, historicalPayloadAvailable: false, observedLifecycleStatus: folder.physicallyClosed ? 'closed' : 'open' } })
      await audit.record(client, { ...actor, action: 'case.location_assigned', entityType: 'case', entityId: caseId,
        details: { storageRootKey: fresh.manifest.storageRootKey, relativePath: folder.relativePath, verificationStatus: 'pending', source: 'imported', toVersion: 1 } })
      caseIds.push(caseId)
    }
    await audit.record(client, { ...actor, action: 'cases.folders_registered', entityType: 'organization', entityId: actor.organizationId, details: { planDigest: approvedHash, created: caseIds.length } })
    await client.query('COMMIT')
    return { created: caseIds.length, alreadyApplied: false, caseIds }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
