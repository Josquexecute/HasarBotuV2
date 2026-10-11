import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema } from '@hasarbotu/contracts'
import { normalizeV1ResolutionName } from '@hasarbotu/domain'
import { createAuditService } from '../audit/service.js'
import { parseV1TakipJson } from './schema.js'

const sourceSchema = z.strictObject({ relativePath: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/u) })
export const v1AssignmentManifestSchema = z.strictObject({
  schemaVersion: z.literal('hasarbotu-v1-assignments/1.0.0'),
  rootPath: z.string().min(1),
  expertUserId: idSchema,
  expertSourceNames: z.array(z.string().trim().min(1)).min(1),
  responsibleMappings: z.array(z.strictObject({ sourceName: z.string().trim().min(1), userId: idSchema })),
  cases: z.array(z.strictObject({
    caseId: idSchema, expectedVersion: z.number().int().positive(),
    expectedResponsibleUserId: idSchema.nullable(), expectedExpertUserId: idSchema.nullable(), source: sourceSchema,
  })).min(1).max(10_000),
})
export type V1AssignmentManifest = z.infer<typeof v1AssignmentManifestSchema>
interface Queryable { query: pg.Pool['query'] }
interface Actor { organizationId: string; actorUserId: string; requestId: string }
interface AssignmentEntry {
  caseId: string; expectedVersion: number; beforeResponsibleUserId: string | null; beforeExpertUserId: string | null
  responsibleUserId: string | null; expertUserId: string; source: z.infer<typeof sourceSchema>
  closedAt: string | null; closedByUserId: string | null
}
export interface V1AssignmentPlan {
  schemaVersion: 'hasarbotu-v1-assignment-plan/1.0.0'
  organizationId: string
  manifest: V1AssignmentManifest
  accountEvidence: { id: string; displayName: string; roles: string[] }[]
  entries: AssignmentEntry[]
  planHash: string
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fail = (code: string): never => { throw new Error(code) }
const normalized = (name: string) => normalizeV1ResolutionName(name)
const isUnassigned = (name: string) => ['', 'atanmadi', 'atanmadı'].includes(normalized(name))

async function readSource(root: string, source: z.infer<typeof sourceSchema>) {
  const segments = source.relativePath.split(/[\\/]/u)
  if (path.isAbsolute(source.relativePath) || segments.some(part => !part || part === '.' || part === '..')) fail('assignment_source_path_invalid')
  let current = root
  for (const part of [...segments, '_HASARBOTU', 'takip.json']) {
    current = path.join(current, part)
    if ((await lstat(current)).isSymbolicLink()) fail('assignment_source_symlink')
  }
  const resolved = await realpath(current)
  const relative = path.relative(root, resolved)
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('assignment_source_outside_root')
  const bytes = await readFile(resolved)
  if (digest(bytes) !== source.sha256) fail('assignment_source_hash_changed')
  const parsed = parseV1TakipJson(bytes.toString('utf8'))
  if (!parsed.ok) return fail('assignment_source_invalid')
  return parsed.data
}

/** Historical import correction only; ordinary closed-case PATCH remains locked. */
export async function planV1AssignmentRemediation(db: Queryable, organizationId: string, input: V1AssignmentManifest): Promise<V1AssignmentPlan> {
  const manifest = v1AssignmentManifestSchema.parse(input)
  idSchema.parse(organizationId)
  if (new Set(manifest.cases.map(row => row.caseId)).size !== manifest.cases.length) fail('assignment_duplicate_case')
  const mappings = new Map<string, string>()
  for (const mapping of manifest.responsibleMappings) {
    const name = normalized(mapping.sourceName)
    if (isUnassigned(name) || mappings.has(name)) fail('assignment_responsible_mapping_invalid')
    mappings.set(name, mapping.userId)
  }
  const userIds = [...new Set([manifest.expertUserId, ...mappings.values()])].sort()
  const accounts = (await db.query(`SELECT u.id::text,u.display_name,u.status,
    ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id ORDER BY r.code) roles
    FROM users u WHERE u.organization_id=$1 AND u.id=ANY($2::uuid[]) ORDER BY u.id FOR SHARE OF u`, [organizationId, userIds])).rows as { id: string; display_name: string; status: string; roles: string[] }[]
  if (accounts.length !== userIds.length || accounts.some(row => row.status !== 'active')) fail('assignment_account_inactive_or_cross_tenant')
  if (!accounts.find(row => row.id === manifest.expertUserId)?.roles.includes('expert')) fail('assignment_expert_role_required')
  for (const id of mappings.values()) if (!accounts.find(row => row.id === id)?.roles.includes('case_manager')) fail('assignment_responsible_role_required')
  const root = await realpath(manifest.rootPath)
  const expertNames = new Set(manifest.expertSourceNames.map(normalized))
  const entries: AssignmentEntry[] = []
  for (const item of [...manifest.cases].sort((a, b) => a.caseId.localeCompare(b.caseId))) {
    const result = await db.query(`SELECT c.version,c.lifecycle_status,c.responsible_user_id::text,c.expert_user_id::text,
      c.closed_at,c.closed_by_user_id::text,
      EXISTS(SELECT 1 FROM eksist_sources e WHERE e.organization_id=c.organization_id AND e.case_id=c.id AND e.reviewed_fields ? 'automatic') source_readonly
      FROM cases c WHERE c.organization_id=$1 AND c.id=$2`, [organizationId, item.caseId])
    const row = result.rows[0]
    if (!row) fail('assignment_case_not_found')
    if (row.lifecycle_status !== 'closed') fail('assignment_closed_case_required')
    if (row.source_readonly) fail('assignment_eksist_source_readonly')
    if (row.version !== item.expectedVersion || row.responsible_user_id !== item.expectedResponsibleUserId || row.expert_user_id !== item.expectedExpertUserId) fail('assignment_case_changed')
    const provenance = await db.query(`SELECT 1 FROM v1_import_records WHERE organization_id=$1 AND case_id=$2
      AND source_relative_path=$3 AND source_file_hash=$4 AND target_type='case' LIMIT 1`, [organizationId, item.caseId, item.source.relativePath, item.source.sha256])
    if (!provenance.rowCount) fail('assignment_import_provenance_required')
    const source = await readSource(root, item.source)
    if (!expertNames.has(normalized(source.assignment?.eksper ?? ''))) fail('assignment_source_expert_unmapped')
    const responsibleName = source.assignment?.sorumlu ?? ''
    const responsibleUserId = isUnassigned(responsibleName) ? null : mappings.get(normalized(responsibleName))
    if (responsibleUserId === undefined) throw new Error('assignment_source_responsible_unmapped')
    entries.push({ caseId: item.caseId, expectedVersion: row.version, beforeResponsibleUserId: row.responsible_user_id,
      beforeExpertUserId: row.expert_user_id, responsibleUserId, expertUserId: manifest.expertUserId, source: item.source,
      closedAt: row.closed_at === null ? null : new Date(row.closed_at).toISOString(), closedByUserId: row.closed_by_user_id })
  }
  const payload = { schemaVersion: 'hasarbotu-v1-assignment-plan/1.0.0' as const, organizationId, manifest,
    accountEvidence: accounts.map(row => ({ id: row.id, displayName: row.display_name, roles: row.roles })), entries }
  return { ...payload, planHash: digest(JSON.stringify(payload)) }
}

function verifyPlanHash(plan: V1AssignmentPlan, approvedHash: string) {
  const { planHash, ...payload } = plan
  if (planHash !== approvedHash || digest(JSON.stringify(payload)) !== approvedHash) fail('assignment_plan_approval_mismatch')
}

/** Exact approved plan, active admin, source/provenance and row locks; all-or-nothing audit. */
export async function applyV1AssignmentRemediation(pool: pg.Pool, actor: Actor, approvedPlan: V1AssignmentPlan, approvedHash: string) {
  verifyPlanHash(approvedPlan, approvedHash)
  if (approvedPlan.organizationId !== actor.organizationId) fail('assignment_actor_tenant_mismatch')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const admin = await client.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.organization_id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.actorUserId, actor.organizationId])
    if (!admin.rowCount) fail('assignment_admin_required')
    // Deterministic lock order also serializes replay checks for simultaneous approvals.
    await client.query('SELECT id FROM cases WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [actor.organizationId, approvedPlan.entries.map(row => row.caseId)])
    const replay = await client.query(`SELECT details FROM audit_events WHERE organization_id=$1
      AND action='v1.assignments.remediated' AND details->>'planDigest'=$2 LIMIT 1`, [actor.organizationId, approvedHash])
    if (replay.rowCount) {
      await client.query('COMMIT')
      return { planHash: approvedHash, updatedCases: 0, alreadyApplied: true }
    }
    const fresh = await planV1AssignmentRemediation(client, actor.organizationId, approvedPlan.manifest)
    if (fresh.planHash !== approvedHash) fail('assignment_plan_stale')
    const audit = createAuditService()
    for (const entry of fresh.entries) {
      const updated = await client.query(`UPDATE cases SET responsible_user_id=$3,expert_user_id=$4,version=version+1,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$5 AND lifecycle_status='closed'`,
      [actor.organizationId, entry.caseId, entry.responsibleUserId, entry.expertUserId, entry.expectedVersion])
      if (updated.rowCount !== 1) fail('assignment_case_changed')
      await audit.record(client, { ...actor, action: 'v1.assignment_remediated', entityType: 'case', entityId: entry.caseId,
        details: { planDigest: approvedHash, fromVersion: entry.expectedVersion, toVersion: entry.expectedVersion + 1,
          before: { responsibleUserId: entry.beforeResponsibleUserId, expertUserId: entry.beforeExpertUserId },
          after: { responsibleUserId: entry.responsibleUserId, expertUserId: entry.expertUserId }, source: entry.source,
          reason: 'Verified historical employee identities; unknown responsible remains unassigned' } })
    }
    await audit.record(client, { ...actor, action: 'v1.assignments.remediated', entityType: 'v1_assignment_plan',
      details: { planDigest: approvedHash, updatedCases: fresh.entries.length } })
    await client.query('COMMIT')
    return { planHash: approvedHash, updatedCases: fresh.entries.length, alreadyApplied: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
