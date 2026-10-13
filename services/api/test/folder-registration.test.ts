import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { applyFolderRegistration, planFolderRegistration, type FolderRegistrationManifest } from '../src/cases/folder-registration.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip
describeDb('sidecarless physical folder registration', () => {
  let pool: pg.Pool
  let org: string, admin: string, owner: string, expert: string
  let next = 100
  const actor = () => ({ organizationId: org, actorUserId: admin, requestId: 'folder-registration-test' })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7(); admin = uuidv7(); owner = uuidv7(); expert = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'folder-test','Synthetic')", [org])
    for (const [id, role] of [[admin, 'admin'], [owner, 'case_manager'], [expert, 'expert']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, `${id}@example.test`, role, 'synthetic-not-a-login'])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    }
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'test-root','Synthetic')", [uuidv7(), org])
  }, 60_000)
  afterAll(async () => { if (pool) await closeDatabasePool(pool) })
  function manifest(closed = false): FolderRegistrationManifest {
    next++
    return { schemaVersion: 'hasarbotu-folder-registration/1', storageRootKey: 'test-root', responsibleUserId: owner, expertUserId: expert,
      decision: 'Register physical folders without historical payload', folders: [{ sourceFolderId: String(next),
        relativePath: `2026/EKİM 2026/${closed ? 'KAPALI EKİM 2026/' : ''}34AAA${next}`, physicallyClosed: closed, caseType: 'traffic',
        evidence: { inventoryHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), kinds: ['m_ruhsat'] } }] }
  }
  async function counts() {
    return (await pool.query(`SELECT (SELECT count(*)::int FROM cases) cases,(SELECT count(*)::int FROM jobs) jobs,
      (SELECT count(*)::int FROM case_folder_registrations) registrations,(SELECT count(*)::int FROM case_location_history) locations,
      (SELECT count(*)::int FROM audit_events) audits,(SELECT coalesce(sum(last_sequence),0)::int FROM office_counters) sequence`)).rows[0]
  }
  it('creates searchable open and closed cases, queues real verification and invents no historical dates or notes', async () => {
    const input = manifest(), closed = manifest(true)
    input.folders.push(...closed.folders)
    const plan = await planFolderRegistration(pool, org, input)
    const verifier = vi.fn(async () => {})
    const result = await applyFolderRegistration(pool, actor(), plan, plan.planHash, verifier)
    expect(result.created).toBe(2)
    expect(verifier).toHaveBeenCalledTimes(2)
    const rows = (await pool.query('SELECT c.*,l.verification_status FROM cases c JOIN case_locations l ON l.case_id=c.id WHERE c.id=ANY($1::uuid[]) ORDER BY c.office_sequence', [result.caseIds])).rows
    expect(rows.map(r => r.lifecycle_status)).toEqual(['open', 'closed'])
    for (const row of rows) expect(row).toMatchObject({ responsible_user_id: owner, expert_user_id: expert, closed_at: null, follow_up_date: null, loss_date: null, notification_date: null, verification_status: 'pending' })
    expect((await pool.query('SELECT 1 FROM case_notes WHERE case_id=ANY($1::uuid[])', [result.caseIds])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM v1_import_records WHERE case_id=ANY($1::uuid[])', [result.caseIds])).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM jobs WHERE target_id IN (SELECT id FROM case_locations WHERE case_id=ANY($1::uuid[])) AND type='verify_case_location'", [result.caseIds])).rowCount).toBe(2)
    const before = await counts()
    expect(await applyFolderRegistration(pool, actor(), plan, plan.planHash, verifier)).toMatchObject({ created: 0, alreadyApplied: true })
    expect(await counts()).toEqual(before)
    // Renaming a source folder retains its identity rather than creating a second case.
    input.folders[0]!.relativePath += ' - 2'
    const renamed = await planFolderRegistration(pool, org, input)
    expect(renamed.entries.every(e => e.caseId !== null)).toBe(true)
  })
  it('does not merge distinct folders just because their plates are equal', async () => {
    const input = manifest()
    input.folders.push({ ...input.folders[0]!, sourceFolderId: String(++next), relativePath: input.folders[0]!.relativePath + ' - 2' })
    const plan = await planFolderRegistration(pool, org, input)
    const result = await applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})
    expect(new Set(result.caseIds).size).toBe(2)
    const other = manifest(); other.folders[0]!.relativePath = input.folders[0]!.relativePath + ' - 3'
    await expect(planFolderRegistration(pool, org, other)).rejects.toThrow('folder_existing_plate_requires_reconciliation')
  })
  it('requires a valid plate, safe unique path, source identity, observed closure and supported type evidence', async () => {
    const input = manifest()
    for (const relativePath of ['../34AAA123', '/34AAA123', '2026/EKİM 2026/DEĞER KAYBI']) {
      const bad = structuredClone(input); bad.folders[0]!.relativePath = relativePath
      await expect(planFolderRegistration(pool, org, bad)).rejects.toThrow()
    }
    const duplicate = structuredClone(input); duplicate.folders.push({ ...duplicate.folders[0]! })
    await expect(planFolderRegistration(pool, org, duplicate)).rejects.toThrow('folder_duplicate_source')
    input.folders[0]!.physicallyClosed = true
    await expect(planFolderRegistration(pool, org, input)).rejects.toThrow('folder_lifecycle_evidence_mismatch')
    input.folders[0]!.physicallyClosed = false; input.folders[0]!.evidence.kinds = []
    await expect(planFolderRegistration(pool, org, input)).rejects.toThrow('folder_type_evidence_required')
    input.folders[0]!.evidence.userTypeDecision = 'Explicit user classification'
    expect((await planFolderRegistration(pool, org, input)).entries).toHaveLength(1)
  })
  it('rejects inactive references, non-admin and cross-tenant actors', async () => {
    const input = manifest(), plan = await planFolderRegistration(pool, org, input)
    await expect(planFolderRegistration(pool, org, { ...input, responsibleUserId: expert })).rejects.toThrow('folder_active_assignment_required')
    await expect(planFolderRegistration(pool, org, { ...input, storageRootKey: 'missing-root' })).rejects.toThrow('folder_active_root_required')
    await expect(applyFolderRegistration(pool, { ...actor(), actorUserId: owner }, plan, plan.planHash, async () => {})).rejects.toThrow('folder_admin_required')
    await expect(applyFolderRegistration(pool, { ...actor(), organizationId: uuidv7() }, plan, plan.planHash, async () => {})).rejects.toThrow('folder_actor_tenant_mismatch')
  })
  it('rejects tampered plans and source changes without partial data', async () => {
    const input = manifest(), plan = await planFolderRegistration(pool, org, input), before = await counts()
    await expect(applyFolderRegistration(pool, actor(), plan, '0'.repeat(64), async () => {})).rejects.toThrow('folder_plan_approval_mismatch')
    await expect(applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => { throw new Error('source_changed') })).rejects.toThrow('source_changed')
    plan.manifest.folders[0]!.caseType = 'casco'
    await expect(applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('folder_plan_approval_mismatch')
    expect(await counts()).toEqual(before)
  })
  it('revalidates assignment roles at apply time', async () => {
    const input = manifest(), plan = await planFolderRegistration(pool, org, input)
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [owner])
    try { await expect(applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('folder_active_assignment_required') }
    finally { await pool.query("UPDATE users SET status='active' WHERE id=$1", [owner]) }
  })
  it('serializes concurrent retries without duplicates', async () => {
    const input = manifest(), plan = await planFolderRegistration(pool, org, input)
    const results = await Promise.all([1, 2].map(() => applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})))
    expect(results.map(r => r.created).sort()).toEqual([0, 1])
  })
  it('rolls back cases, locations, jobs, counters and provenance when audit fails', async () => {
    const input = manifest(), plan = await planFolderRegistration(pool, org, input), before = await counts()
    await pool.query("CREATE FUNCTION reject_folder_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='cases.folders_registered' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_folder_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_folder_audit()")
    try { await expect(applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('synthetic_audit_failure') }
    finally { await pool.query('DROP TRIGGER reject_folder_audit ON audit_events; DROP FUNCTION reject_folder_audit()') }
    expect(await counts()).toEqual(before)
  })
})
