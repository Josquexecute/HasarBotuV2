import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { applyResponsibilityMaintenance, planResponsibilityMaintenance, type ResponsibilityMaintenanceManifest } from '../src/cases/responsibility-maintenance.js'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip
describeDb('explicit current responsibility maintenance', () => {
  let pool: pg.Pool
  let org: string
  let admin: string
  let manager: string
  let expert: string
  let sequence = 0
  const password = 'synthetic-responsibility-test-25'
  const actor = () => ({ organizationId: org, actorUserId: admin, requestId: 'responsibility-regression' })
  const snapshot = async (id: string) => (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=$1', [id])).rows[0].snapshot
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7(); admin = uuidv7(); manager = uuidv7(); expert = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'responsibility-test','Synthetic')", [org])
    for (const [id, role] of [[admin, 'admin'], [manager, 'case_manager'], [expert, 'expert']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, `${id}@example.test`, role, await hashPassword(password)])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    }
  }, 60_000)
  afterAll(async () => { if (pool) await closeDatabasePool(pool) })
  async function fixture(closed = false) {
    const caseId = uuidv7()
    sequence++
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,
      lifecycle_status,workflow_stage,closed_at,closed_by_user_id,expert_user_id)
      VALUES($1,$2,2026,$3,$4,'traffic','34 AAA 123','34AAA123',$5,$6,$7,$8,$9)`,
    [caseId, org, sequence, `2026/${sequence}`, closed ? 'closed' : 'open', closed ? 'closed' : 'new_notification', closed ? '2026-09-01T10:00:00Z' : null, closed ? admin : null, expert])
    const manifest: ResponsibilityMaintenanceManifest = { schemaVersion: 'hasarbotu-responsibility-maintenance/1.0.0', responsibleUserId: manager,
      decision: 'Explicit user decision for current unassigned files', cases: [{ caseId, expectedVersion: 1 }] }
    return { caseId, manifest }
  }
  it('assigns open and closed cases while preserving every other business field and audits replay once', async () => {
    const open = await fixture(), closed = await fixture(true)
    const before = [await snapshot(open.caseId), await snapshot(closed.caseId)]
    const plan = await planResponsibilityMaintenance(pool, org, { ...open.manifest, cases: [...open.manifest.cases, ...closed.manifest.cases] })
    expect([await snapshot(open.caseId), await snapshot(closed.caseId)]).toEqual(before)
    expect(await applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).toMatchObject({ updatedCases: 2, alreadyApplied: false })
    const omit = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['responsible_user_id', 'version', 'updated_at'].includes(key)))
    for (const [index, id] of [open.caseId, closed.caseId].entries()) {
      const after = await snapshot(id)
      expect(omit(after)).toEqual(omit(before[index]))
      expect(after).toMatchObject({ responsible_user_id: manager, version: 2, expert_user_id: expert })
    }
    expect(await applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).toMatchObject({ updatedCases: 0, alreadyApplied: true })
    const audit = (await pool.query("SELECT details FROM audit_events WHERE action='case.responsibility_maintained' AND resource_id=ANY($1::text[])", [[open.caseId, closed.caseId]])).rows
    expect(audit).toHaveLength(2)
    expect(audit[0].details).toMatchObject({ assignmentKind: 'current_owner_decision', beforeResponsibleUserId: null, responsibleUserId: manager })
  })
  it('requires an active same-tenant manager and rejects duplicate, archived and foreign cases', async () => {
    const f = await fixture()
    for (const responsibleUserId of [expert, uuidv7()]) await expect(planResponsibilityMaintenance(pool, org, { ...f.manifest, responsibleUserId })).rejects.toThrow('responsibility_active_same_tenant_manager_required')
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [manager])
    try { await expect(planResponsibilityMaintenance(pool, org, f.manifest)).rejects.toThrow('responsibility_active_same_tenant_manager_required') }
    finally { await pool.query("UPDATE users SET status='active' WHERE id=$1", [manager]) }
    await expect(planResponsibilityMaintenance(pool, org, { ...f.manifest, cases: [...f.manifest.cases, ...f.manifest.cases] })).rejects.toThrow('responsibility_duplicate_case')
    await expect(planResponsibilityMaintenance(pool, org, { ...f.manifest, cases: [{ caseId: uuidv7(), expectedVersion: 1 }] })).rejects.toThrow('responsibility_case_not_found')
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [f.caseId])
    await expect(planResponsibilityMaintenance(pool, org, f.manifest)).rejects.toThrow('responsibility_case_not_found')
  })
  it('rejects non-admin and foreign-tenant actors without mutation', async () => {
    const f = await fixture(), plan = await planResponsibilityMaintenance(pool, org, f.manifest)
    await expect(applyResponsibilityMaintenance(pool, { ...actor(), actorUserId: manager }, plan, plan.planHash)).rejects.toThrow('responsibility_admin_required')
    await expect(applyResponsibilityMaintenance(pool, { ...actor(), organizationId: uuidv7() }, plan, plan.planHash)).rejects.toThrow('responsibility_actor_tenant_mismatch')
    expect((await snapshot(f.caseId)).version).toBe(1)
  })
  it('rejects changed approved payloads and wrong hashes', async () => {
    const f = await fixture(), plan = await planResponsibilityMaintenance(pool, org, f.manifest)
    await expect(applyResponsibilityMaintenance(pool, actor(), plan, '0'.repeat(64))).rejects.toThrow('responsibility_plan_approval_mismatch')
    plan.manifest.responsibleUserId = expert
    await expect(applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).rejects.toThrow('responsibility_plan_approval_mismatch')
  })
  it('rejects concurrent ownership and version changes before any batch update', async () => {
    const first = await fixture(), second = await fixture(true)
    const plan = await planResponsibilityMaintenance(pool, org, { ...first.manifest, cases: [...first.manifest.cases, ...second.manifest.cases] })
    await pool.query('UPDATE cases SET responsible_user_id=$2,version=version+1 WHERE id=$1', [second.caseId, admin])
    await expect(applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).rejects.toThrow('responsibility_case_changed')
    expect((await snapshot(first.caseId)).version).toBe(1)
    expect((await snapshot(second.caseId)).responsible_user_id).toBe(admin)
  })
  it('revalidates manager roles and lifecycle state after approval', async () => {
    const f = await fixture(), plan = await planResponsibilityMaintenance(pool, org, f.manifest)
    await pool.query("DELETE FROM user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM roles WHERE code='case_manager')", [manager])
    try { await expect(applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).rejects.toThrow('responsibility_active_same_tenant_manager_required') }
    finally { await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='case_manager'", [manager]) }
    await pool.query("UPDATE cases SET lifecycle_status='closed',workflow_stage='closed',closed_at=now(),closed_by_user_id=$2 WHERE id=$1", [f.caseId, admin])
    await expect(applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).rejects.toThrow('responsibility_plan_stale')
    expect((await snapshot(f.caseId)).responsible_user_id).toBeNull()
  })
  it('serializes duplicate approvals without duplicate updates or audit', async () => {
    const f = await fixture(), plan = await planResponsibilityMaintenance(pool, org, f.manifest)
    const results = await Promise.all([applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash), applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)])
    expect(results.map(result => result.updatedCases).sort()).toEqual([0, 1])
    expect((await snapshot(f.caseId)).version).toBe(2)
  })
  it('rolls back the entire batch if audit fails after an update', async () => {
    const first = await fixture(), second = await fixture(true)
    const plan = await planResponsibilityMaintenance(pool, org, { ...first.manifest, cases: [...first.manifest.cases, ...second.manifest.cases] })
    await pool.query(`CREATE FUNCTION test_responsibility_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='case.responsibility_maintained' AND NEW.resource_id='${plan.entries[1]!.caseId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_responsibility_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_responsibility_audit_failure()')
    try { await expect(applyResponsibilityMaintenance(pool, actor(), plan, plan.planHash)).rejects.toThrow('synthetic audit failure') }
    finally {
      await pool.query('DROP TRIGGER test_responsibility_audit_failure ON audit_events')
      await pool.query('DROP FUNCTION test_responsibility_audit_failure()')
    }
    expect((await snapshot(first.caseId)).version).toBe(1)
    expect((await snapshot(second.caseId)).version).toBe(1)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='case.responsibility_maintained' AND resource_id=ANY($1::text[])", [[first.caseId, second.caseId]])).rowCount).toBe(0)
  })
  it('keeps ordinary closed-case HTTP edits locked', async () => {
    const f = await fixture(true)
    const app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${admin}@example.test`, password } })
      expect(login.statusCode).toBe(200)
      const response = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${f.caseId}`, headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! }, payload: { expectedVersion: 1, responsibleUserId: manager } })
      expect(response.statusCode).toBe(409)
      expect((await snapshot(f.caseId)).version).toBe(1)
    } finally { await app.close() }
  })
})
