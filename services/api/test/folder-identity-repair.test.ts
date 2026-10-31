import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { applyIdentityRepair, planIdentityRepair, rollbackIdentityRepair, type RepairAssurance } from '../src/cases/folder-identity-repair.js'

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
describeDb('operator-approved folder identity correction (real PostgreSQL, synthetic identities)', () => {
  let pool: pg.Pool, org: string, admin: string
  let next = 0
  const actor = () => ({ organizationId: org, actorUserId: admin, requestId: 'identity-repair-test' })
  const assurance = (): RepairAssurance => ({ verifySource: vi.fn(async () => {}), backup: vi.fn(async () => ({ databaseSha256: 'a'.repeat(64), folderManifestSha256: 'b'.repeat(64), restoreProofSha256: 'c'.repeat(64) })), persistReceipt: vi.fn(async () => {}) })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = new pg.Pool({ connectionString: config.url })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7(); admin = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'identity-test','Synthetic')", [org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'operator@example.test','Synthetic operator','not-a-password')", [admin, org])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [admin])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'test-root','Synthetic')", [uuidv7(), org])
  }, 60_000)
  afterAll(async () => { await pool?.end() })
  async function fixture() {
    const retired = uuidv7(), canonical = uuidv7(), sourceFolderId = String(++next)
    for (const [id, archived] of [[retired, true], [canonical, false]] as const) {
      const sequence = ++next
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,is_archived,workflow_stage)
        VALUES($1,$2,2026,$3,$4,'34 TST 999','34TST999',$5,'new_notification')`, [id, org, sequence, `2026/${sequence}`, archived])
      await pool.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
        VALUES($1,$2,$3,'test-root',$4,'verified','imported')`, [uuidv7(), org, id, `2026 OFİS/Ekim/${id}/34TST999`])
    }
    const oldPath = `2026 OFİS/Ekim/${retired}/34TST999`, currentPath = `2026 OFİS/Ekim/${canonical}/34TST999`
    await pool.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
      VALUES($1,$2,$3,'test-root',$4,$5,'{"originalEvidence":"preserved"}',$6,$7)`, [uuidv7(), org, retired, sourceFolderId, oldPath, 'd'.repeat(64), admin])
    const decision = { storageRootKey: 'test-root', relationship: 'duplicate_claim' as const, evidenceSha256: 'e'.repeat(64), cases: [
      { caseId: retired, officialEvidenceReference: 'operator-reviewed duplicate evidence', target: null },
      { caseId: canonical, officialEvidenceReference: 'operator-reviewed official claim evidence', target: { sourceFolderId, relativePath: currentPath } },
    ] }
    const plan = await planIdentityRepair(pool, org, decision)
    return { plan, decision, retired, canonical, sourceFolderId }
  }
  const approve = (plan: Awaited<ReturnType<typeof planIdentityRepair>>) => ({ operatorId: admin, approvedPlanHash: plan.planHash, approvedAt: new Date().toISOString() })
  it.each(['650–640', '725–723'])('preserves both case histories, applies once and rolls back once (%s analogue)', async () => {
    const { plan, retired, canonical, sourceFolderId } = await fixture(), checks = assurance()
    const result = await applyIdentityRepair(pool, actor(), plan, approve(plan), checks)
    expect(result.alreadyApplied).toBe(false)
    expect((await pool.query('SELECT case_id,evidence FROM case_folder_registrations WHERE source_folder_id=$1', [sourceFolderId])).rows[0]).toMatchObject({ case_id: canonical, evidence: { originalEvidence: 'preserved' } })
    expect((await pool.query('SELECT verification_status FROM case_locations WHERE case_id=$1', [retired])).rows[0].verification_status).toBe('missing')
    expect(await applyIdentityRepair(pool, actor(), plan, approve(plan), checks)).toMatchObject({ alreadyApplied: true })
    expect(checks.backup).toHaveBeenCalledTimes(1)
    const receipt = result.receipt!
    expect(await rollbackIdentityRepair(pool, actor(), receipt, digest(receipt), async () => {})).toEqual({ alreadyRolledBack: false })
    expect(await rollbackIdentityRepair(pool, actor(), receipt, digest(receipt), async () => {})).toEqual({ alreadyRolledBack: true })
    expect((await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [sourceFolderId])).rows[0].case_id).toBe(retired)
    expect((await pool.query('SELECT count(*)::int count FROM case_location_history WHERE case_id=ANY($1::uuid[])', [[retired, canonical]])).rows[0].count).toBe(4)
    expect((await pool.query('SELECT count(*)::int count FROM cases WHERE id=ANY($1::uuid[])', [[retired, canonical]])).rows[0].count).toBe(2)
  })
  it('rejects missing/mismatched approvals, forged plans and changed versions without writes', async () => {
    const { plan, retired } = await fixture()
    await expect(applyIdentityRepair(pool, actor(), plan, { ...approve(plan), operatorId: uuidv7() }, assurance())).rejects.toThrow('identity_repair_approval_required')
    const tampered = structuredClone(plan); tampered.decision.cases[0]!.officialEvidenceReference = 'tampered'
    await expect(applyIdentityRepair(pool, actor(), tampered, approve(plan), assurance())).rejects.toThrow('identity_repair_approval_required')
    await pool.query('UPDATE cases SET version=version+1 WHERE id=$1', [retired])
    await expect(applyIdentityRepair(pool, actor(), plan, approve(plan), assurance())).rejects.toThrow('identity_repair_plan_stale')
  })
  it('backs out atomically if backup verification or final physical attestation fails', async () => {
    const { plan, retired, sourceFolderId } = await fixture(), checks = assurance()
    checks.backup = async () => { throw new Error('backup_restore_failed') }
    await expect(applyIdentityRepair(pool, actor(), plan, approve(plan), checks)).rejects.toThrow('backup_restore_failed')
    const final = assurance(); let calls = 0
    final.verifySource = async () => { if (++calls === 2) throw new Error('physical_identity_changed') }
    await expect(applyIdentityRepair(pool, actor(), plan, approve(plan), final)).rejects.toThrow('physical_identity_changed')
    const diskFailure = assurance(); diskFailure.persistReceipt = async () => { throw new Error('receipt_disk_full') }
    await expect(applyIdentityRepair(pool, actor(), plan, approve(plan), diskFailure)).rejects.toThrow('receipt_disk_full')
    expect((await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [sourceFolderId])).rows[0].case_id).toBe(retired)
    expect((await pool.query('SELECT count(*)::int count FROM case_location_history WHERE case_id=$1', [retired])).rows[0].count).toBe(0)
  })
  it('keeps distinct claims and all prior source identities separately bound after explicit evidence approval', async () => {
    const { decision, retired, canonical, sourceFolderId } = await fixture()
    const path = (await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [retired])).rows[0].relative_path
    const input = { ...decision, relationship: 'distinct_claims' as const, cases: decision.cases.map(c => c.caseId === retired
      ? { ...c, target: { sourceFolderId: '987654321', relativePath: path } } : c) }
    const plan = await planIdentityRepair(pool, org, input)
    await applyIdentityRepair(pool, actor(), plan, approve(plan), assurance())
    const rows = (await pool.query('SELECT case_id,source_folder_id FROM case_folder_registrations WHERE case_id=ANY($1::uuid[])', [[retired, canonical]])).rows
    expect(rows).toEqual(expect.arrayContaining([{ case_id: retired, source_folder_id: '987654321' }, { case_id: canonical, source_folder_id: sourceFolderId }]))
  })
  it('serializes concurrent retries and rejects rollback after subsequent business edits', async () => {
    const { plan, canonical } = await fixture()
    const results = await Promise.all([1, 2].map(() => applyIdentityRepair(pool, actor(), plan, approve(plan), assurance())))
    expect(results.filter(r => !r.alreadyApplied)).toHaveLength(1)
    const receipt = results.find(r => r.receipt)!.receipt!
    await pool.query('UPDATE cases SET version=version+1 WHERE id=$1', [canonical])
    await expect(rollbackIdentityRepair(pool, actor(), receipt, digest(receipt), async () => {})).rejects.toThrow('identity_repair_rollback_drift')
  })
})
