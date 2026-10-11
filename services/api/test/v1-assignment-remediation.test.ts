import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { applyV1AssignmentRemediation, planV1AssignmentRemediation, type V1AssignmentManifest } from '../src/v1-import/assignment-remediation.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip
describeDb('approved historical assignment correction', () => {
  let pool: pg.Pool
  let root: string
  let org: string
  let admin: string
  let expert: string
  let responsible: string
  let sequence = 0
  const password = 'synthetic-assignment-test-25'
  const actor = () => ({ organizationId: org, actorUserId: admin, requestId: 'assignment-regression' })
  const snapshot = async (id: string) => (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=$1', [id])).rows[0].snapshot
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    root = await mkdtemp(join(tmpdir(), 'hb-assignments-'))
    org = uuidv7(); admin = uuidv7(); expert = uuidv7(); responsible = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'assignment-test','Synthetic')", [org])
    for (const [id, name, role] of [[admin, 'Synthetic Admin', 'admin'], [expert, 'Synthetic Expert', 'expert'], [responsible, 'Synthetic Responsible', 'case_manager']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, `${id}@example.test`, name, await hashPassword(password)])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    }
  }, 60_000)
  afterAll(async () => {
    if (pool) await closeDatabasePool(pool)
    if (root) await rm(root, { recursive: true, force: true })
  })
  async function fixture(unassigned = false) {
    const caseId = uuidv7()
    sequence++
    const relativePath = `2026/July/case-${sequence}`
    const filename = join(root, relativePath, '_HASARBOTU', 'takip.json')
    await mkdir(join(root, relativePath, '_HASARBOTU'), { recursive: true })
    const content = JSON.stringify({ schemaVersion: 1, assignment: { sorumlu: unassigned ? 'Atanmadı' : 'Synthetic Responsible', eksper: 'Source Expert Alias' } })
    await writeFile(filename, content)
    const sha256 = createHash('sha256').update(content).digest('hex')
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,
      lifecycle_status,workflow_stage,closed_at,closed_by_user_id,responsible_user_id)
      VALUES($1,$2,2026,$3,$4,'traffic','34 AAA 123','34AAA123','closed','closed','2026-09-01T10:00:00Z',$5,$5)`, [caseId, org, sequence, `2026/${sequence}`, admin])
    await pool.query(`INSERT INTO v1_import_records(id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,
      item_type,source_item_id,target_type,target_id,status,imported_by_user_id)
      VALUES($1,$2,$3,$4,'takip_json',$5,'case','case','case',$3,'created',$6)`, [uuidv7(), org, caseId, relativePath, sha256, admin])
    const manifest: V1AssignmentManifest = { schemaVersion: 'hasarbotu-v1-assignments/1.0.0', rootPath: root, expertUserId: expert,
      expertSourceNames: ['Source Expert Alias'], responsibleMappings: [{ sourceName: 'Synthetic Responsible', userId: responsible }],
      cases: [{ caseId, expectedVersion: 1, expectedResponsibleUserId: admin, expectedExpertUserId: null, source: { relativePath, sha256 } }] }
    return { caseId, filename, manifest }
  }
  it('updates verified assignments, preserves all closure fields and audits once on replay', async () => {
    const f = await fixture()
    const before = await snapshot(f.caseId)
    const sourceBefore = await readFile(f.filename, 'utf8')
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    expect(await snapshot(f.caseId)).toEqual(before)
    expect(await applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).toMatchObject({ updatedCases: 1, alreadyApplied: false })
    const after = await snapshot(f.caseId)
    const omit = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['responsible_user_id','expert_user_id','version','updated_at'].includes(key)))
    expect(omit(after)).toEqual(omit(before))
    expect(after).toMatchObject({ responsible_user_id: responsible, expert_user_id: expert, version: 2, lifecycle_status: 'closed' })
    expect(await readFile(f.filename, 'utf8')).toBe(sourceBefore)
    expect(await applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).toMatchObject({ updatedCases: 0, alreadyApplied: true })
    const audit = (await pool.query("SELECT details FROM audit_events WHERE action='v1.assignment_remediated' AND resource_id=$1", [f.caseId])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].details).toMatchObject({ planDigest: plan.planHash, fromVersion: 1, toVersion: 2 })
  })
  it('keeps an unassigned source responsible null while assigning the common expert', async () => {
    const f = await fixture(true)
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    await applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)
    expect(await snapshot(f.caseId)).toMatchObject({ responsible_user_id: null, expert_user_id: expert })
  })
  it('rejects non-admin actors and foreign organization approval', async () => {
    const f = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    await expect(applyV1AssignmentRemediation(pool, { ...actor(), actorUserId: expert }, plan, plan.planHash)).rejects.toThrow('assignment_admin_required')
    await expect(applyV1AssignmentRemediation(pool, { ...actor(), organizationId: uuidv7() }, plan, plan.planHash)).rejects.toThrow('assignment_actor_tenant_mismatch')
    expect((await snapshot(f.caseId)).version).toBe(1)
  })
  it('rejects wrong approval hashes and edited plan payloads', async () => {
    const f = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    await expect(applyV1AssignmentRemediation(pool, actor(), plan, '0'.repeat(64))).rejects.toThrow('assignment_plan_approval_mismatch')
    plan.entries[0]!.responsibleUserId = expert
    await expect(applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).rejects.toThrow('assignment_plan_approval_mismatch')
  })
  it('fails the entire batch before mutation when one source changed', async () => {
    const first = await fixture()
    const second = await fixture()
    const manifest = { ...first.manifest, cases: [...first.manifest.cases, ...second.manifest.cases] }
    const plan = await planV1AssignmentRemediation(pool, org, manifest)
    await writeFile(second.filename, '{}')
    await expect(applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).rejects.toThrow('assignment_source_hash_changed')
    expect((await snapshot(first.caseId)).version).toBe(1)
    expect((await snapshot(second.caseId)).version).toBe(1)
  })
  it('rejects database version and assignment drift', async () => {
    const f = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    await pool.query('UPDATE cases SET version=version+1,responsible_user_id=$2 WHERE id=$1', [f.caseId, responsible])
    await expect(applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).rejects.toThrow('assignment_case_changed')
    expect((await snapshot(f.caseId)).expert_user_id).toBeNull()
  })
  it('revalidates account roles after approval', async () => {
    const f = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    await pool.query('UPDATE users SET status=\'disabled\' WHERE id=$1', [expert])
    try { await expect(applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).rejects.toThrow('assignment_account_inactive_or_cross_tenant') }
    finally { await pool.query('UPDATE users SET status=\'active\' WHERE id=$1', [expert]) }
    expect((await snapshot(f.caseId)).version).toBe(1)
  })
  it('requires same-tenant expert role and source name mappings', async () => {
    const f = await fixture()
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, expertUserId: admin })).rejects.toThrow('assignment_expert_role_required')
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, expertUserId: uuidv7() })).rejects.toThrow('assignment_account_inactive_or_cross_tenant')
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, responsibleMappings: [] })).rejects.toThrow('assignment_source_responsible_unmapped')
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, expertSourceNames: ['Other Expert'] })).rejects.toThrow('assignment_source_expert_unmapped')
  })
  it('rejects absent provenance, duplicate cases and escaping paths', async () => {
    const f = await fixture()
    const source = f.manifest.cases[0]!
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, cases: [source, source] })).rejects.toThrow('assignment_duplicate_case')
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, cases: [{ ...source, source: { ...source.source, relativePath: '../outside' } }] })).rejects.toThrow('assignment_import_provenance_required')
    await expect(planV1AssignmentRemediation(pool, org, { ...f.manifest, cases: [{ ...source, source: { ...source.source, sha256: '0'.repeat(64) } }] })).rejects.toThrow('assignment_import_provenance_required')
  })
  it('serializes concurrent approvals without duplicate updates or audit', async () => {
    const f = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, f.manifest)
    const results = await Promise.all([applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash), applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)])
    expect(results.map(row => row.updatedCases).sort()).toEqual([0, 1])
    expect((await snapshot(f.caseId)).version).toBe(2)
  })
  it('rolls back all updates when audit fails after the first case was written', async () => {
    const first = await fixture()
    const second = await fixture()
    const plan = await planV1AssignmentRemediation(pool, org, { ...first.manifest, cases: [...first.manifest.cases, ...second.manifest.cases] })
    const secondId = plan.entries[1]!.caseId
    await pool.query(`CREATE FUNCTION test_assignment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='v1.assignment_remediated' AND NEW.resource_id='${secondId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_assignment_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_assignment_audit_failure()')
    try { await expect(applyV1AssignmentRemediation(pool, actor(), plan, plan.planHash)).rejects.toThrow('synthetic audit failure') }
    finally {
      await pool.query('DROP TRIGGER test_assignment_audit_failure ON audit_events')
      await pool.query('DROP FUNCTION test_assignment_audit_failure()')
    }
    expect((await snapshot(first.caseId)).version).toBe(1)
    expect((await snapshot(second.caseId)).version).toBe(1)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='v1.assignment_remediated' AND resource_id=ANY($1::text[])", [[first.caseId, second.caseId]])).rowCount).toBe(0)
  })
  it('leaves the ordinary HTTP closed-case PATCH locked', async () => {
    const f = await fixture()
    const app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${admin}@example.test`, password } })
      expect(login.statusCode).toBe(200)
      const response = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${f.caseId}`, headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! }, payload: { expectedVersion: 1, expertUserId: expert } })
      expect(response.statusCode).toBe(409)
      expect((await snapshot(f.caseId)).version).toBe(1)
    } finally { await app.close() }
  })
})
