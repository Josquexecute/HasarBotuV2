import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { buildV1SourceIdentityMaterial, buildV1StableItemIdentityMaterial } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { readV1Sidecar } from './store.js'
import { insertItemMetadata, insertStableProvenance, type V1ProvenanceSource } from './remediation.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const registeredNotesManifestSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  bindings: z.array(z.strictObject({ caseId: idSchema, expectedCaseVersion: z.number().int().positive(), sourceFolderId: z.string().regex(/^[0-9]+$/), relativePath: relativePathSchema,
    sourceIdentity: hashSchema, sourceFileHash: hashSchema })).min(1).max(100),
})
type Manifest = z.infer<typeof registeredNotesManifestSchema>
type Actor = { organizationId: string; actorUserId: string; requestId: string }
function fail(code: string): never { throw new Error(code) }

async function sourceEntry(rootPath: string, binding: Manifest['bindings'][number]) {
  const root = resolve(rootPath), absolutePath = resolve(root, ...binding.relativePath.split('/'))
  if (!absolutePath.startsWith(root + sep)) fail('registered_notes_source_outside_root')
  let current = root
  for (const segment of binding.relativePath.split('/')) { current = join(current, segment);const info = await lstat(current);if (!info.isDirectory() || info.isSymbolicLink()) fail('registered_notes_unsafe_source') }
  const sidecarDirectory = await lstat(join(absolutePath, '_HASARBOTU'))
  const sidecarFile = await lstat(join(absolutePath, '_HASARBOTU', 'takip.json'))
  if (!sidecarDirectory.isDirectory() || sidecarDirectory.isSymbolicLink() || !sidecarFile.isFile() || sidecarFile.isSymbolicLink()) fail('registered_notes_unsafe_source')
  const folder = { absolutePath, relativePath: binding.relativePath, hasJson: true, hasTxt: false }
  const source = await readV1Sidecar(folder)
  if (!source.jsonParse?.ok || source.jsonHash !== binding.sourceFileHash) fail('registered_notes_source_changed')
  const data = source.jsonParse.data
  const identity = buildV1SourceIdentityMaterial({ caseKey: data.caseIdentity?.caseKey, createdAt: data.metadata?.createdAt })
  if (!identity.ok || digest(identity.material) !== binding.sourceIdentity) fail('registered_notes_identity_changed')
  const seen = new Set<string>()
  for (const note of data.notes) {
    if (!note.id.trim() || !note.text.trim() || note.text.trim().length > 5000 || seen.has(note.id)) fail('registered_notes_invalid_item')
    seen.add(note.id)
  }
  return { folder, sourceHash: source.jsonHash, sourceIdentity: binding.sourceIdentity, schemaVersion: source.jsonParse.schemaVersion,
    sourceWriteId: data.metadata?.writeId?.trim() || null, sourceRevision: data.metadata?.revision ?? null, data }
}

/** Import generic history only. Type conflicts stay unresolved; no case field or lifecycle is changed. */
export async function applyRegisteredV1Notes(pool: pg.Pool, actor: Actor, rootPath: string, manifestInput: Manifest, approvedHash: string,
  verifySource: (binding: Manifest['bindings'][number]) => Promise<void>) {
  const manifest = registeredNotesManifestSchema.parse(manifestInput)
  const planHash = digest(JSON.stringify({ organizationId: actor.organizationId, manifest }))
  if (planHash !== approvedHash) fail('registered_notes_approval_mismatch')
  const sources: Array<Awaited<ReturnType<typeof sourceEntry>>> = []
  for (const binding of manifest.bindings) { await verifySource(binding);sources.push(await sourceEntry(rootPath, binding)) }
  return withTransaction(pool, async db => {
    if (!(await db.query(`SELECT 1 FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.organizationId, actor.actorUserId])).rowCount) fail('registered_notes_admin_required')
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`registered-v1-notes:${actor.organizationId}`])
    let notesCreated = 0, alreadyImported = 0
    for (const [index, binding] of manifest.bindings.entries()) {
      const row = (await db.query(`SELECT c.version,l.storage_root_key,l.relative_path,r.source_folder_id FROM cases c
        JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
        JOIN case_folder_registrations r ON r.organization_id=c.organization_id AND r.case_id=c.id
        WHERE c.organization_id=$1 AND c.id=$2 AND NOT c.is_archived FOR UPDATE OF c,l,r`, [actor.organizationId, binding.caseId])).rows[0]
      if (!row || row.version !== binding.expectedCaseVersion || row.storage_root_key !== manifest.storageRootKey || row.relative_path !== binding.relativePath || row.source_folder_id !== binding.sourceFolderId) fail('registered_notes_binding_changed')
      const source = sources[index]!
      const revision = (await db.query(`SELECT id FROM v1_import_source_revisions WHERE organization_id=$1 AND stable_source_identity=$2 AND source_file_hash=$3 ORDER BY recorded_at DESC LIMIT 1`, [actor.organizationId, binding.sourceIdentity, binding.sourceFileHash])).rows[0]
      if (!revision) fail('registered_notes_archived_revision_required')
      // These provenance writers consume only source descriptors; the full import planner is deliberately not fabricated.
      const descriptor: V1ProvenanceSource = {
        folder: { relativePath: binding.relativePath },
        sourceHash: source.sourceHash, sourceIdentity: source.sourceIdentity, schemaVersion: source.schemaVersion, sourceWriteId: source.sourceWriteId, sourceRevision: source.sourceRevision,
      }
      for (const note of source.data.notes) {
        const material = buildV1StableItemIdentityMaterial(binding.sourceIdentity, 'note', note.id)
        if (!material) fail('registered_notes_item_identity_required')
        const stableItem = digest(material)
        const existing = (await db.query('SELECT case_id,target_id FROM v1_import_records WHERE organization_id=$1 AND stable_source_identity=$2 AND stable_item_identity=$3', [actor.organizationId, binding.sourceIdentity, stableItem])).rows[0]
        if (existing) { if (existing.case_id !== binding.caseId) fail('registered_notes_existing_target_conflict');alreadyImported++;continue }
        if ((await db.query('SELECT 1 FROM case_notes WHERE organization_id=$1 AND case_id=$2 AND body=$3', [actor.organizationId, binding.caseId, note.text.trim()])).rowCount) fail('registered_notes_duplicate_content_review_required')
        const noteId = uuidv7(), occurredAt = note.createdAt.trim() && Number.isFinite(Date.parse(note.createdAt)) ? new Date(note.createdAt).toISOString() : null
        await db.query("INSERT INTO case_notes(id,organization_id,case_id,note_type,body,created_by_user_id,created_at) VALUES($1,$2,$3,'internal',$4,$5,COALESCE($6::timestamptz,now()))", [noteId, actor.organizationId, binding.caseId, note.text.trim(), actor.actorUserId, occurredAt])
        if (!await insertStableProvenance(db, actor, descriptor, revision.id, 'note', note.id, stableItem, 'case_note', noteId, 'created', binding.caseId)) fail('registered_notes_provenance_conflict')
        if (!await insertItemMetadata(db, actor, descriptor, { caseId: binding.caseId, stableItemIdentity: stableItem, itemType: 'note', nativeItemId: note.id, targetType: 'case_note', targetId: noteId, sourceAuthor: note.createdBy,
          sourceOccurredAt: occurredAt, snapshot: { id: note.id, text: note.text, createdBy: note.createdBy, createdAt: note.createdAt } })) fail('registered_notes_metadata_conflict')
        notesCreated++
      }
    }
    if (notesCreated) await createAuditService().record(db, { ...actor, action: 'v1_registered_notes.imported', entityType: 'organization', entityId: actor.organizationId,
      details: { planHash, sources: manifest.bindings.length, notesCreated, alreadyImported, caseFieldsPreserved: true, classificationsUnresolved: true } })
    return { planHash, notesCreated, alreadyImported, caseFieldsPreserved: true as const }
  })
}
