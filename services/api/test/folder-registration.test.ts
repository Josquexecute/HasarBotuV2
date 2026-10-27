import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { applyFolderRegistration, planFolderRegistration, type FolderRegistrationManifest } from '../src/cases/folder-registration.js'
import { createCasesStore } from '../src/cases/store.js'
import { createCasesWriteStore } from '../src/cases/write-store.js'
import { casesQuerySchema } from '@hasarbotu/contracts'
import { evaluateCaseDocumentRequirements } from '../src/document-requirements/evaluation.js'
import { planFolderLocationReconciliation, applyFolderLocationReconciliation, type FolderLocationReconciliation } from '../src/cases/folder-location-reconciliation.js'
import { planSourceFolderRelocation, applySourceFolderRelocation, type SourceFolderRelocation } from '../src/cases/source-folder-relocation.js'
import { registerAutomaticFolders, type AutomaticFolderPolicy, type ObservedPlateFolder } from '../src/cases/automatic-folder-registration.js'
import { resolveFileLocations } from '../src/storage/file-location.js'
import { createAuditService } from '../src/audit/service.js'

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
  function automaticPolicy(): AutomaticFolderPolicy {
    return { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId: org, storageRootKey: 'test-root',
      actorUserId: admin, responsibleUserId: owner, expertUserId: expert,
      decision: 'Automatically register new distinct pCloud IDs; leave types pending and preserve old cases.', baselineSourceFolderIds: [] }
  }
  function observation(): ObservedPlateFolder {
    const folder = manifest().folders[0]!
    return { sourceFolderId: folder.sourceFolderId, relativePath: folder.relativePath, observationHash: 'd'.repeat(64), historicalPayloadAvailable: false }
  }
  it('automatically registers new sources as Seçiniz with assignments and real verification jobs', async () => {
    const folder = { ...observation(), stableV1Identity: 'f'.repeat(64) }, verify = vi.fn(async () => {})
    expect(await registerAutomaticFolders(pool, automaticPolicy(), [folder], verify)).toMatchObject({ created: 1, deferred: 0 })
    const row = (await pool.query('SELECT c.* FROM cases c JOIN case_folder_registrations r ON r.case_id=c.id WHERE r.source_folder_id=$1', [folder.sourceFolderId])).rows[0]
    expect(row).toMatchObject({ case_type: null, responsible_user_id: owner, expert_user_id: expert, lifecycle_status: 'open' })
    expect(verify).toHaveBeenCalledTimes(1)
    const before = await counts()
    expect(await registerAutomaticFolders(pool, automaticPolicy(), [{ ...folder, relativePath: folder.relativePath.replace('EKİM', 'KAPALI EKİM') }], verify)).toMatchObject({ created: 0, existing: 1 })
    expect(await counts()).toEqual(before)
    expect((await pool.query('SELECT lifecycle_status FROM cases WHERE id=$1', [row.id])).rows[0].lifecycle_status).toBe('open')
  })
  it('registers the same plate for different insurers as separate source identities', async () => {
    const axa = uuidv7(), allianz = uuidv7()
    await pool.query("INSERT INTO insurers(id,organization_id,name) VALUES($1,$3,'AXA Sigorta'),($2,$3,'Allianz Sigorta')", [axa,allianz,org])
    const folders = ['AXA SİGORTA', 'ALLIANZ'].map(name => ({ ...observation(), relativePath: `2026/EKİM 2026/34TST999-${name}` }))
    expect(await registerAutomaticFolders(pool, automaticPolicy(), folders, async () => {})).toMatchObject({ created: 2, deferred: 0 })
    const rows = (await pool.query("SELECT id::text,insurer_id::text FROM cases WHERE organization_id=$1 AND plate_normalized='34TST999' ORDER BY insurer_id", [org])).rows
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.id)).size).toBe(2)
    expect(new Set(rows.map(row => row.insurer_id))).toEqual(new Set([axa,allianz]))
  })
  it('preserves baseline exceptions and existing paths without changing assignments or types', async () => {
    const folder = observation(), policy = automaticPolicy(), before = await counts(), verify = vi.fn(async () => {})
    policy.baselineSourceFolderIds.push(folder.sourceFolderId)
    expect(await registerAutomaticFolders(pool, policy, [folder], verify)).toMatchObject({ created: 0, baseline: 1 })
    expect(await counts()).toEqual(before)
    expect(verify).not.toHaveBeenCalled()
    policy.baselineSourceFolderIds = []
    await registerAutomaticFolders(pool, policy, [folder], verify)
    const registered = await counts()
    expect(await registerAutomaticFolders(pool, policy, [{ ...folder, sourceFolderId: '90000' }], verify)).toMatchObject({ created: 0, existing: 1 })
    expect(await counts()).toEqual(registered)
  })
  it('uses source identity rather than plate and serializes concurrent automatic retries', async () => {
    const first = observation(), policy = automaticPolicy()
    await registerAutomaticFolders(pool, policy, [first], async () => {})
    const second = { ...first, sourceFolderId: '90001', relativePath: first.relativePath.replace('2026/', '2026 UZAKTAN/') }
    expect(await registerAutomaticFolders(pool, policy, [second], async () => {})).toMatchObject({ created: 1 })
    const third = observation(), before = await counts()
    const results = await Promise.all([1, 2].map(() => registerAutomaticFolders(pool, policy, [third], async () => {})))
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(1)
    expect((await counts()).cases).toBe(before.cases + 1)
  })
  it('defers changed sources and revoked assignments without partial writes', async () => {
    const folder = observation(), policy = automaticPolicy(), before = await counts()
    expect(await registerAutomaticFolders(pool, policy, [folder], async () => { throw new Error('source_changed') })).toMatchObject({ created: 0, deferred: 1, issues: [{ code: 'source_changed' }] })
    expect(await counts()).toEqual(before)
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [owner])
    try { expect(await registerAutomaticFolders(pool, policy, [folder], async () => {})).toMatchObject({ created: 0, deferred: 1 }) }
    finally { await pool.query("UPDATE users SET status='active' WHERE id=$1", [owner]) }
    expect(await counts()).toEqual(before)
  })
  it('validates the whole inventory before writes and honors cancellation', async () => {
    const folder = observation(), before = await counts()
    await expect(registerAutomaticFolders(pool, automaticPolicy(), [folder, folder], async () => {})).rejects.toThrow('automatic_folder_duplicate_inventory')
    await expect(registerAutomaticFolders(pool, automaticPolicy(), [folder, { ...observation(), relativePath: '../escape' }], async () => {})).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    expect(await registerAutomaticFolders(pool, automaticPolicy(), [folder], async () => {}, controller.signal)).toMatchObject({ created: 0 })
    expect(await counts()).toEqual(before)
  })
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
    other.folders[0]!.existingPlateCaseIds = result.caseIds
    other.folders[0]!.evidence.userIdentityDecision = 'Separately identified physical source folder; user requested every folder as a separate record'
    const reconciled = await planFolderRegistration(pool, org, other)
    other.folders[0]!.existingPlateCaseIds = [result.caseIds[0]!]
    await expect(planFolderRegistration(pool, org, other)).rejects.toThrow('folder_existing_plate_requires_reconciliation')
    expect((await applyFolderRegistration(pool, actor(), reconciled, reconciled.planHash, async () => {})).created).toBe(1)
  })
  it('keeps unclassified folders searchable and permits initial classification without reopening a historical folder', async () => {
    const input = manifest(true)
    input.folders[0]!.caseType = null
    input.folders[0]!.evidence.kinds = []
    const plan = await planFolderRegistration(pool, org, input)
    const result = await applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})
    const id = result.caseIds[0]!
    const store = createCasesStore(pool)
    const list = await store.list(org, casesQuerySchema.parse({ caseType: 'unclassified' }))
    expect(list.items.find(row => row.id === id)).toMatchObject({ caseType: null, status: 'closed' })
    await expect(evaluateCaseDocumentRequirements(pool, org, id, new Date().toISOString())).rejects.toThrow('case_type_required')
    const writes = createCasesWriteStore(pool)
    expect(await writes.updateCase(actor(), id, { expectedVersion: 2, caseType: 'traffic' })).toEqual({ kind: 'version_conflict' })
    expect(await writes.updateCase(actor(), id, { expectedVersion: 1, caseType: 'traffic', workflowStage: 'new_notification' })).toEqual({ kind: 'case_closed' })
    expect(await writes.updateCase({ ...actor(), organizationId: uuidv7() }, id, { expectedVersion: 1, caseType: 'traffic' })).toEqual({ kind: 'not_found' })
    const updated = await writes.updateCase(actor(), id, { expectedVersion: 1, caseType: 'traffic' })
    expect(updated).toMatchObject({ kind: 'ok', item: { caseType: 'traffic', status: 'closed', stage: 'closed', version: 2 } })
    expect(await writes.updateCase(actor(), id, { expectedVersion: 2, caseType: 'casco' })).toMatchObject({ kind: 'ok',item: { caseType: 'casco',status: 'closed',version: 3 } })
    expect((await pool.query('SELECT closed_at,follow_up_date FROM cases WHERE id=$1', [id])).rows[0]).toEqual({ closed_at: null, follow_up_date: null })
    const audit = (await pool.query("SELECT details FROM audit_events WHERE resource_id=$1 AND action='case.updated'", [id])).rows[0].details
    expect(audit).toMatchObject({ previousCaseType: null, caseType: 'traffic', assignmentKind: 'user_classification' })
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

  async function legacyBinding(closed = false, withLocation = false): Promise<FolderLocationReconciliation> {
    next++
    const id = uuidv7(), recordId = uuidv7(), sourceId = uuidv7(), identity = id.replaceAll('-', '').padEnd(64, 'a')
    const relativePath = `2026/EKİM 2026/${closed ? 'KAPALI EKİM/' : ''}34BBB${next}`
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,lifecycle_status,workflow_stage)
      VALUES($1,$2,2026,$3,$4,'traffic',$5,$6,$7,$8)`, [id, org, 1000 + next, `2026/${1000 + next}`, `34 BBB ${next}`, `34BBB${next}`, closed ? 'closed' : 'open', closed ? 'closed' : 'new_notification'])
    await pool.query("INSERT INTO v1_import_sources(id,organization_id,stable_source_identity,identity_kind,identity_version) VALUES($1,$2,$3,'case_key_created_at','v1-source-identity/1.0.0')", [sourceId, org, identity])
    await pool.query(`INSERT INTO v1_import_records(id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,item_type,source_item_id,target_type,target_id,status)
      VALUES($1,$2,$3,$4,'takip_json',$5,'case','case','case',$3,'created')`, [recordId, org, id, relativePath, 'c'.repeat(64)])
    await pool.query(`INSERT INTO v1_import_record_reconciliations(id,organization_id,legacy_import_record_id,stable_source_identity,stable_item_identity,evidence,mapping_version,reconciled_by_user_id)
      VALUES($1,$2,$3,$4,$5,'{}','v1-remediation/2.3.0',$6)`, [uuidv7(), org, recordId, identity, 'd'.repeat(64), admin])
    let previousLocation = null
    if (withLocation) {
      previousLocation = { id: uuidv7(), storageRootKey: 'test-root', relativePath: `2026/EKİM 2026/34BBB${next}`, version: 1 }
      await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source) VALUES($1,$2,$3,'test-root',$4,'verified','imported')", [previousLocation.id, org, id, previousLocation.relativePath])
    }
    return { storageRootKey: 'test-root', decision: 'Reconcile an existing imported source using immutable V1 identity', bindings: [{ caseId: id, sourceFolderId: String(next), relativePath,
      expectedCaseVersion: 1, physicallyClosed: closed, stableSourceIdentity: identity, sourceFileHash: 'c'.repeat(64), previousLocation }] }
  }
  it('defers a moved historical identity instead of creating a duplicate automatic case', async () => {
    const binding = (await legacyBinding()).bindings[0]!, before = await counts()
    const folder = { ...observation(), relativePath: binding.relativePath.replace('2026/', '2026 UZAKTAN/'),
      historicalPayloadAvailable: true, stableV1Identity: binding.stableSourceIdentity }
    expect(await registerAutomaticFolders(pool, automaticPolicy(), [folder], async () => {})).toMatchObject({ created: 0, deferred: 1,
      issues: [{ code: 'historical_case_reconciliation_required' }] })
    expect(await counts()).toEqual(before)
  })
  it('binds an imported case and repairs an externally moved closed folder without changing cases or history', async () => {
    const input = await legacyBinding(), closed = await legacyBinding(true, true)
    input.bindings.push(...closed.bindings)
    const ids = input.bindings.map(b => b.caseId)
    const before = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows
    const plan = await planFolderLocationReconciliation(pool, org, input)
    const verify = vi.fn(async () => {})
    expect(await applyFolderLocationReconciliation(pool, actor(), plan, plan.planHash, verify)).toEqual({ reconciled: 2, alreadyApplied: false })
    expect(verify).toHaveBeenCalledTimes(2)
    expect((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows).toEqual(before)
    const locations = (await pool.query('SELECT case_id,relative_path,verification_status,version FROM case_locations WHERE case_id=ANY($1::uuid[])', [ids])).rows
    expect(locations.find(l => l.case_id === closed.bindings[0]!.caseId)).toMatchObject({ relative_path: closed.bindings[0]!.relativePath, verification_status: 'pending', version: 2 })
    expect(await applyFolderLocationReconciliation(pool, actor(), plan, plan.planHash, verify)).toEqual({ reconciled: 0, alreadyApplied: true })
    expect((await pool.query('SELECT 1 FROM case_notes WHERE case_id=ANY($1::uuid[])', [ids])).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM jobs WHERE target_id IN (SELECT id FROM case_locations WHERE case_id=ANY($1::uuid[])) AND type='verify_case_location'", [ids])).rowCount).toBe(2)
  })
  it('rejects wrong identity, tenant, plate, lifecycle, location version and changed source before writing', async () => {
    const input = await legacyBinding()
    for (const patch of [{ stableSourceIdentity: 'f'.repeat(64) }, { relativePath: '2026/EKİM 2026/34ZZZ999' }, { expectedCaseVersion: 2 }, { physicallyClosed: true }, { previousLocation: { id: uuidv7(), storageRootKey: 'test-root', relativePath: input.bindings[0]!.relativePath, version: 1 } }]) {
      await expect(planFolderLocationReconciliation(pool, org, { ...input, bindings: [{ ...input.bindings[0]!, ...patch }] })).rejects.toThrow()
    }
    await expect(planFolderLocationReconciliation(pool, uuidv7(), input)).rejects.toThrow()
    const plan = await planFolderLocationReconciliation(pool, org, input), before = await counts()
    await expect(applyFolderLocationReconciliation(pool, actor(), plan, '0'.repeat(64), async () => {})).rejects.toThrow('folder_binding_approval_mismatch')
    await expect(applyFolderLocationReconciliation(pool, actor(), plan, plan.planHash, async () => { throw new Error('source_changed') })).rejects.toThrow('source_changed')
    await expect(applyFolderLocationReconciliation(pool, { ...actor(), actorUserId: owner }, plan, plan.planHash, async () => {})).rejects.toThrow('folder_admin_required')
    expect(await counts()).toEqual(before)
  })
  it('rolls back source bindings, jobs and locations if the final audit fails', async () => {
    const input = await legacyBinding(), plan = await planFolderLocationReconciliation(pool, org, input), before = await counts()
    await pool.query("CREATE FUNCTION reject_binding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='cases.folder_locations_reconciled' THEN RAISE EXCEPTION 'synthetic_binding_audit_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_binding_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_binding_audit()")
    try { await expect(applyFolderLocationReconciliation(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('synthetic_binding_audit_failure') }
    finally { await pool.query('DROP TRIGGER reject_binding_audit ON audit_events; DROP FUNCTION reject_binding_audit()') }
    expect(await counts()).toEqual(before)
  })

  async function relocation(registered = true): Promise<SourceFolderRelocation> {
    if (!registered) {
      const legacy = await legacyBinding(false, true), b = legacy.bindings[0]!
      return { storageRootKey: legacy.storageRootKey, decision: 'Rebind moved V1 source; preserve open lifecycle', bindings: [{
        caseId: b.caseId, sourceFolderId: b.sourceFolderId, expectedCaseVersion: b.expectedCaseVersion,
        relativePath: b.relativePath.replace('/34BBB', '/KAPALI/34BBB'), physicallyClosed: true, expectedLifecycleStatus: 'open', previousLocation: b.previousLocation!,
        identity: { kind: 'v1', stableSourceIdentity: b.stableSourceIdentity, sourceFileHash: b.sourceFileHash },
      }] }
    }
    const input = manifest(), plan = await planFolderRegistration(pool, org, input)
    const result = await applyFolderRegistration(pool, actor(), plan, plan.planHash, async () => {})
    const location = (await pool.query('SELECT id,relative_path,version FROM case_locations WHERE case_id=$1', [result.caseIds[0]])).rows[0]
    return { storageRootKey: 'test-root', decision: 'Rebind externally moved registered source; preserve open lifecycle', bindings: [{
      caseId: result.caseIds[0]!, sourceFolderId: input.folders[0]!.sourceFolderId, relativePath: input.folders[0]!.relativePath.replace('/34AAA', '/KAPALI/34AAA'),
      expectedCaseVersion: 1, expectedLifecycleStatus: 'open', physicallyClosed: true, identity: { kind: 'registered' },
      previousLocation: { id: location.id, storageRootKey: 'test-root', relativePath: location.relative_path, version: location.version },
    }] }
  }
  it('relocates only inventory-managed archives while preserving explicit archive decisions', async () => {
    const input = await relocation(), caseId = input.bindings[0]!.caseId
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [caseId])
    await expect(planSourceFolderRelocation(pool, org, input)).rejects.toThrow('folder_relocation_case_not_found')
    const audit = createAuditService()
    const record = (managedArchive: boolean) => audit.record(pool, { organizationId: org, actorUserId: admin,
      action: 'case.office_inventory_reconciled', entityType: 'case', entityId: caseId, requestId: 'archive-relocation-test', details: { managedArchive } })
    await record(true)
    await expect(planSourceFolderRelocation(pool, org, input)).resolves.toHaveProperty('planHash')
    await record(false)
    await expect(planSourceFolderRelocation(pool, org, input)).rejects.toThrow('folder_relocation_case_not_found')
    await record(true)
    const plan = await planSourceFolderRelocation(pool, org, input)
    expect(await applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})).toMatchObject({ relocated: 1 })
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0].is_archived).toBe(true)
  })
  it('rebinds registered and immutable V1 sources atomically without closing open cases or inventing history', async () => {
    const input = await relocation(), legacy = await relocation(false)
    input.bindings.push(...legacy.bindings)
    const before = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows
    const plan = await planSourceFolderRelocation(pool, org, input), verify = vi.fn(async () => {})
    expect(await applySourceFolderRelocation(pool, actor(), plan, plan.planHash, verify)).toEqual({ relocated: 2, alreadyApplied: false })
    expect(verify).toHaveBeenCalledTimes(2)
    expect((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows).toEqual(before)
    for (const b of input.bindings) {
      expect((await pool.query('SELECT relative_path,version,verification_status FROM case_locations WHERE case_id=$1', [b.caseId])).rows[0]).toEqual({ relative_path: b.relativePath, version: 2, verification_status: 'pending' })
      expect((await pool.query('SELECT source_folder_id,source_relative_path FROM case_folder_registrations WHERE case_id=$1', [b.caseId])).rows[0]).toEqual({ source_folder_id: b.sourceFolderId, source_relative_path: b.relativePath })
      expect((await pool.query('SELECT 1 FROM case_notes WHERE case_id=$1', [b.caseId])).rowCount).toBe(0)
      const files = await resolveFileLocations(pool, org, [{ case_id: b.caseId, storage_root_key: b.previousLocation.storageRootKey,
        relative_path: `${b.previousLocation.relativePath}/evidence.pdf`, created_at: new Date('2026-01-01T00:00:00Z') }])
      expect(files[0]!.relative_path).toBe(`${b.relativePath}/evidence.pdf`)
    }
    const countsBeforeReplay = await counts()
    expect(await applySourceFolderRelocation(pool, actor(), plan, plan.planHash, verify)).toEqual({ relocated: 0, alreadyApplied: true })
    expect(await counts()).toEqual(countsBeforeReplay)
  })
  it('rejects changed registered identity, stale location/case, incorrect plate/placement and cross-tenant input', async () => {
    const input = await relocation(), b = input.bindings[0]!
    for (const patch of [{ sourceFolderId: '9999999' }, { expectedCaseVersion: 2 }, { expectedLifecycleStatus: 'closed' as const },
      { previousLocation: { ...b.previousLocation, version: 2 } }, { relativePath: '2026/KAPALI/34ZZZ999' }, { physicallyClosed: false }]) {
      await expect(planSourceFolderRelocation(pool, org, { ...input, bindings: [{ ...b, ...patch }] })).rejects.toThrow()
    }
    await expect(planSourceFolderRelocation(pool, uuidv7(), input)).rejects.toThrow('folder_active_root_required')
    const legacy = await relocation(false)
    legacy.bindings[0]!.identity = { kind: 'v1', stableSourceIdentity: 'f'.repeat(64), sourceFileHash: 'c'.repeat(64) }
    await expect(planSourceFolderRelocation(pool, org, legacy)).rejects.toThrow('folder_relocation_v1_identity_required')
  })
  it.each([true, false])('rejects a plate change after relocation approval without rebinding or publishing jobs (registered=%s)', async registered => {
    const input = await relocation(registered), binding = input.bindings[0]!
    const plan = await planSourceFolderRelocation(pool, org, input)
    await pool.query("UPDATE cases SET plate='34 ZZZ 999',plate_normalized='34ZZZ999',version=version+1 WHERE id=$1", [binding.caseId])
    const snapshot = async () => ({
      counts: await counts(),
      cases: (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=$1', [binding.caseId])).rows,
      locations: (await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l WHERE case_id=$1', [binding.caseId])).rows,
      registrations: (await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r WHERE case_id=$1', [binding.caseId])).rows,
    })
    const before = await snapshot(), verify = vi.fn(async () => {})
    await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, verify)).rejects.toThrow('folder_relocation_plate_mismatch')
    expect(verify).toHaveBeenCalledTimes(1)
    expect(await snapshot()).toEqual(before)
  })
  it('rejects tampering, non-admin and changed live source without writes', async () => {
    const input = await relocation(), plan = await planSourceFolderRelocation(pool, org, input), before = await counts()
    await expect(applySourceFolderRelocation(pool, actor(), plan, '0'.repeat(64), async () => {})).rejects.toThrow('folder_relocation_approval_mismatch')
    await expect(applySourceFolderRelocation(pool, { ...actor(), actorUserId: owner }, plan, plan.planHash, async () => {})).rejects.toThrow('folder_admin_required')
    await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => { throw new Error('source_changed') })).rejects.toThrow('source_changed')
    await pool.query('UPDATE case_locations SET version=version+1 WHERE id=$1', [input.bindings[0]!.previousLocation.id])
    await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('folder_relocation_location_changed')
    expect(await counts()).toEqual(before)
  })
  it('rolls back every relocation, registration and verification job if final audit fails', async () => {
    const input = await relocation(), legacy = await relocation(false); input.bindings.push(...legacy.bindings)
    const plan = await planSourceFolderRelocation(pool, org, input), before = await counts()
    const locations = (await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l ORDER BY id')).rows
    const registrations = (await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r ORDER BY id')).rows
    await pool.query("CREATE FUNCTION reject_relocation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='cases.source_folders_relocated' THEN RAISE EXCEPTION 'synthetic_relocation_audit_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_relocation_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_relocation_audit()")
    try { await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('synthetic_relocation_audit_failure') }
    finally { await pool.query('DROP TRIGGER reject_relocation_audit ON audit_events; DROP FUNCTION reject_relocation_audit()') }
    expect(await counts()).toEqual(before)
    expect((await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l ORDER BY id')).rows).toEqual(locations)
    expect((await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r ORDER BY id')).rows).toEqual(registrations)
  })
  it('serializes concurrent source relocations and makes replay a no-op', async () => {
    const input = await relocation(), plan = await planSourceFolderRelocation(pool, org, input)
    const results = await Promise.all([1, 2].map(() => applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})))
    expect(results.map(r => r.relocated).sort()).toEqual([0, 1])
  })
  it.each(['before_plan', 'after_approval'] as const)('preserves competing folder identities when a managed archive destination is occupied (%s)', async stage => {
    const input = await relocation(), binding = input.bindings[0]!, peer = await relocation()
    const peerId = peer.bindings[0]!.caseId
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [binding.caseId])
    await createAuditService().record(pool, { ...actor(), action: 'case.office_inventory_reconciled', entityType: 'case',
      entityId: binding.caseId, details: { managedArchive: true } })
    const plan = stage === 'after_approval' ? await planSourceFolderRelocation(pool, org, input) : undefined
    // A distinct live record owns the same-plate destination; plate equality cannot authorize a merge.
    const plate = (await pool.query('SELECT plate,plate_normalized FROM cases WHERE id=$1', [binding.caseId])).rows[0]
    await pool.query('UPDATE cases SET plate=$1,plate_normalized=$2 WHERE id=$3', [plate.plate, plate.plate_normalized, peerId])
    await pool.query('UPDATE case_locations SET relative_path=$1 WHERE case_id=$2', [binding.relativePath, peerId])
    const snapshot = async () => ({
      counts: await counts(),
      cases: (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c WHERE id=ANY($1::uuid[]) ORDER BY id', [[binding.caseId, peerId]])).rows,
      locations: (await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l WHERE case_id=ANY($1::uuid[]) ORDER BY id', [[binding.caseId, peerId]])).rows,
      registrations: (await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r WHERE case_id=ANY($1::uuid[]) ORDER BY id', [[binding.caseId, peerId]])).rows,
    })
    const before = await snapshot()
    if (plan) await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})).rejects.toThrow('folder_relocation_location_in_use')
    else await expect(planSourceFolderRelocation(pool, org, input)).rejects.toThrow('folder_relocation_location_in_use')
    expect(await snapshot()).toEqual(before)
  })
})
