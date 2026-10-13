import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { idSchema } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'

export const responsibilityMaintenanceManifestSchema = z.strictObject({
  schemaVersion: z.literal('hasarbotu-responsibility-maintenance/1.0.0'),
  responsibleUserId: idSchema,
  decision: z.string().trim().min(1).max(1000),
  cases: z.array(z.strictObject({ caseId: idSchema, expectedVersion: z.number().int().positive() })).min(1).max(10_000),
})
export type ResponsibilityMaintenanceManifest = z.infer<typeof responsibilityMaintenanceManifestSchema>
interface Queryable { query: pg.Pool['query'] }
interface Actor { organizationId: string; actorUserId: string; requestId: string }
export interface ResponsibilityMaintenancePlan {
  schemaVersion: 'hasarbotu-responsibility-maintenance-plan/1.0.0'
  organizationId: string
  manifest: ResponsibilityMaintenanceManifest
  entries: { caseId: string; expectedVersion: number; lifecycleStatus: 'open' | 'closed' }[]
  planHash: string
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code: string): never => { throw new Error(code) }

/** Current owner decision only. No historical source assignment or closure is rewritten. */
export async function planResponsibilityMaintenance(db: Queryable, organizationId: string, input: ResponsibilityMaintenanceManifest): Promise<ResponsibilityMaintenancePlan> {
  idSchema.parse(organizationId)
  const parsed = responsibilityMaintenanceManifestSchema.parse(input)
  if (new Set(parsed.cases.map(row => row.caseId)).size !== parsed.cases.length) fail('responsibility_duplicate_case')
  const manifest = { ...parsed, cases: [...parsed.cases].sort((a, b) => a.caseId.localeCompare(b.caseId)) }
  const account = await db.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.organization_id=$2 AND u.status='active'
    AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='case_manager') FOR SHARE OF u`, [manifest.responsibleUserId, organizationId])
  if (!account.rowCount) fail('responsibility_active_same_tenant_manager_required')
  const entries: ResponsibilityMaintenancePlan['entries'] = []
  for (const item of manifest.cases) {
    const result = await db.query(`SELECT version,lifecycle_status,responsible_user_id FROM cases
      WHERE organization_id=$1 AND id=$2 AND NOT is_archived`, [organizationId, item.caseId])
    const row = result.rows[0]
    if (!row) fail('responsibility_case_not_found')
    if (row.responsible_user_id !== null || row.version !== item.expectedVersion) fail('responsibility_case_changed')
    if (row.lifecycle_status !== 'open' && row.lifecycle_status !== 'closed') fail('responsibility_case_state_invalid')
    entries.push({ caseId: item.caseId, expectedVersion: item.expectedVersion, lifecycleStatus: row.lifecycle_status })
  }
  const payload = { schemaVersion: 'hasarbotu-responsibility-maintenance-plan/1.0.0' as const, organizationId, manifest, entries }
  return { ...payload, planHash: digest(payload) }
}

/** Explicitly approved unassigned cases, active admin, version fences and atomic audit. */
export async function applyResponsibilityMaintenance(pool: pg.Pool, actor: Actor, plan: ResponsibilityMaintenancePlan, approvedHash: string) {
  const { planHash, ...payload } = plan
  if (planHash !== approvedHash || digest(payload) !== approvedHash) fail('responsibility_plan_approval_mismatch')
  if (actor.organizationId !== plan.organizationId) fail('responsibility_actor_tenant_mismatch')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const admin = await client.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.organization_id=$2 AND u.status='active'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='admin') FOR SHARE OF u`, [actor.actorUserId, actor.organizationId])
    if (!admin.rowCount) fail('responsibility_admin_required')
    await client.query('SELECT id FROM cases WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [actor.organizationId, plan.entries.map(row => row.caseId)])
    const replay = await client.query(`SELECT 1 FROM audit_events WHERE organization_id=$1
      AND action='cases.responsibility_maintained' AND details->>'planDigest'=$2 LIMIT 1`, [actor.organizationId, approvedHash])
    if (replay.rowCount) {
      await client.query('COMMIT')
      return { planHash: approvedHash, updatedCases: 0, alreadyApplied: true }
    }
    const fresh = await planResponsibilityMaintenance(client, actor.organizationId, plan.manifest)
    if (fresh.planHash !== approvedHash) fail('responsibility_plan_stale')
    const audit = createAuditService()
    for (const entry of fresh.entries) {
      const updated = await client.query(`UPDATE cases SET responsible_user_id=$3,version=version+1,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$4 AND responsible_user_id IS NULL AND NOT is_archived`,
      [actor.organizationId, entry.caseId, fresh.manifest.responsibleUserId, entry.expectedVersion])
      if (updated.rowCount !== 1) fail('responsibility_case_changed')
      await audit.record(client, { ...actor, action: 'case.responsibility_maintained', entityType: 'case', entityId: entry.caseId,
        details: { planDigest: approvedHash, changedFields: ['responsibleUserId'], fromVersion: entry.expectedVersion,
          toVersion: entry.expectedVersion + 1, beforeResponsibleUserId: null, responsibleUserId: fresh.manifest.responsibleUserId,
          decision: fresh.manifest.decision, assignmentKind: 'current_owner_decision' } })
    }
    await audit.record(client, { ...actor, action: 'cases.responsibility_maintained', entityType: 'responsibility_plan',
      details: { planDigest: approvedHash, updatedCases: fresh.entries.length, decision: fresh.manifest.decision } })
    await client.query('COMMIT')
    return { planHash: approvedHash, updatedCases: fresh.entries.length, alreadyApplied: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
