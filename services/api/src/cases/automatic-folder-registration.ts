import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '@hasarbotu/contracts'
import { parseSourcePlateFolderName, plateSearchKey } from '@hasarbotu/domain'
import { applyFolderRegistration, planFolderRegistration, type FolderRegistrationManifest } from './folder-registration.js'

const sourceId = z.string().regex(/^[0-9]+$/)
export const automaticFolderPolicySchema = z.strictObject({
  schemaVersion: z.literal('hasarbotu-automatic-folders/1'),
  organizationId: idSchema,
  storageRootKey: storageRootKeySchema,
  actorUserId: idSchema,
  responsibleUserId: idSchema,
  expertUserId: idSchema,
  decision: z.string().trim().min(1).max(1000),
  baselineSourceFolderIds: z.array(sourceId).max(100_000),
})
export type AutomaticFolderPolicy = z.infer<typeof automaticFolderPolicySchema>
export interface ObservedPlateFolder {
  sourceFolderId: string
  relativePath: string
  historicalPayloadAvailable: boolean
  observationHash: string
  stableV1Identity?: string
}
export interface AutomaticFolderSummary {
  observed: number
  created: number
  existing: number
  baseline: number
  deferred: number
  issues: { sourceFolderId: string; code: string }[]
}
const expectedFailures = new Set([
  'folder_plan_stale', 'folder_location_already_bound', 'folder_registered_plate_changed',
  'folder_active_assignment_required', 'folder_admin_required', 'folder_active_root_required',
  'source_changed', 'source_unavailable', 'historical_case_reconciliation_required',
])

/** Authorized recurring creation; old folders, case fields and V1 history are never rewritten. */
export async function registerAutomaticFolders(
  pool: pg.Pool,
  input: AutomaticFolderPolicy,
  folders: readonly ObservedPlateFolder[],
  verifySource: (folder: ObservedPlateFolder) => Promise<void>,
  signal?: AbortSignal,
): Promise<AutomaticFolderSummary> {
  const policy = automaticFolderPolicySchema.parse(input)
  const baseline = new Set(policy.baselineSourceFolderIds)
  const summary: AutomaticFolderSummary = { observed: folders.length, created: 0, existing: 0, baseline: 0, deferred: 0, issues: [] }
  // Reject a corrupt/ambiguous inventory before making any changes.
  if (new Set(folders.map(f => f.sourceFolderId)).size !== folders.length
    || new Set(folders.map(f => f.relativePath.toLocaleLowerCase('tr'))).size !== folders.length) throw new Error('automatic_folder_duplicate_inventory')
  for (const folder of folders) {
    sourceId.parse(folder.sourceFolderId)
    relativePathSchema.parse(folder.relativePath)
    z.string().regex(/^[a-f0-9]{64}$/).parse(folder.observationHash)
    if (folder.stableV1Identity) z.string().regex(/^[a-f0-9]{64}$/).parse(folder.stableV1Identity)
    if (!parseSourcePlateFolderName(folder.relativePath.split('/').at(-1)!)) throw new Error('automatic_folder_plate_required')
  }
  for (const folder of folders) {
    if (signal?.aborted) break
    if (baseline.has(folder.sourceFolderId)) { summary.baseline++; continue }
    try {
      const registered = await pool.query(`SELECT case_id FROM case_folder_registrations
        WHERE organization_id=$1 AND storage_root_key=$2 AND source_folder_id=$3`, [policy.organizationId, policy.storageRootKey, folder.sourceFolderId])
      const bound = await pool.query(`SELECT case_id FROM case_locations
        WHERE organization_id=$1 AND storage_root_key=$2 AND lower(relative_path)=lower($3)`, [policy.organizationId, policy.storageRootKey, folder.relativePath])
      if (registered.rowCount || bound.rowCount) { summary.existing++; continue }
      if (folder.stableV1Identity) {
        const historical = await pool.query(`SELECT r.target_id FROM v1_import_records r
          LEFT JOIN v1_import_record_reconciliations c ON c.organization_id=r.organization_id AND c.legacy_import_record_id=r.id
          WHERE r.organization_id=$1 AND r.item_type='case' AND r.target_type='case'
            AND r.status IN ('created','backfilled','skipped_existing')
            AND coalesce(r.stable_source_identity,c.stable_source_identity)=$2`, [policy.organizationId, folder.stableV1Identity])
        if (historical.rowCount) throw new Error('historical_case_reconciliation_required')
      }
      const plate = parseSourcePlateFolderName(folder.relativePath.split('/').at(-1)!)!.plate
      const candidateIds = (await pool.query('SELECT id::text FROM cases WHERE organization_id=$1 AND plate_normalized=$2',
        [policy.organizationId, plateSearchKey(plate)])).rows.map(row => row.id as string).sort()
      // A new stable pCloud folder ID represents a distinct source, even if the plate recurs.
      // Never merge it with an existing case using only a plate number.
      const manifest: FolderRegistrationManifest = {
        schemaVersion: 'hasarbotu-folder-registration/1', storageRootKey: policy.storageRootKey,
        responsibleUserId: policy.responsibleUserId, expertUserId: policy.expertUserId, decision: policy.decision,
        folders: [{ sourceFolderId: folder.sourceFolderId, relativePath: folder.relativePath,
          physicallyClosed: folder.relativePath.split('/').slice(0, -1).some(s => s.toLocaleUpperCase('tr').startsWith('KAPALI')),
          caseType: null, historicalPayloadAvailable: folder.historicalPayloadAvailable, existingPlateCaseIds: candidateIds,
          evidence: { inventoryHash: folder.observationHash, evidenceHash: folder.observationHash, kinds: [],
            ...(candidateIds.length ? { userIdentityDecision: policy.decision } : {}) } }],
      }
      const plan = await planFolderRegistration(pool, policy.organizationId, manifest)
      const result = await applyFolderRegistration(pool, {
        organizationId: policy.organizationId, actorUserId: policy.actorUserId,
        requestId: 'automatic-folder-' + createHash('sha256').update(folder.sourceFolderId).digest('hex').slice(0, 24),
      }, plan, plan.planHash, async () => { if (signal?.aborted) throw new Error('source_unavailable'); await verifySource(folder) })
      summary.created += result.created
      if (!result.created) summary.existing++
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      // Unexpected DB/audit/programming failures stop the cycle, preserving their diagnostics.
      if (!expectedFailures.has(code)) throw error
      summary.deferred++
      summary.issues.push({ sourceFolderId: folder.sourceFolderId, code })
    }
  }
  return summary
}
