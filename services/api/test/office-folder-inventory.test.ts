import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { mkdtemp, mkdir, rename, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverPlateFolders } from '../src/cases/folder-discovery.js'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { reconcileOfficeFolderInventory } from '../src/cases/office-folder-inventory.js'
import { applyFolderRegistration, planFolderRegistration } from '../src/cases/folder-registration.js'
import type { AutomaticFolderPolicy } from '../src/cases/automatic-folder-registration.js'

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
describeDb('verified office folder inventory', () => {
  let pool: pg.Pool, policy: AutomaticFolderPolicy, sequence = 100
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = new pg.Pool({ connectionString: config.url })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const organizationId = uuidv7(), actorUserId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'office-inventory','Synthetic')", [organizationId])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,'inventory@example.test','Synthetic')", [actorUserId, organizationId])
    for (const role of ['admin','case_manager','expert']) await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [actorUserId, role])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'office','Synthetic')", [uuidv7(), organizationId])
    policy = { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId, actorUserId, responsibleUserId: actorUserId,
      expertUserId: actorUserId, storageRootKey: 'office', baselineSourceFolderIds: [], decision: 'User-authorized physical office inventory reconciliation' }
  }, 60_000)
  afterAll(async () => { await pool?.end() })
  async function register(path: string) {
    const sourceFolderId = String(++sequence)
    const plan = await planFolderRegistration(pool, policy.organizationId, { schemaVersion: 'hasarbotu-folder-registration/1',
      storageRootKey: 'office', responsibleUserId: policy.actorUserId, expertUserId: policy.actorUserId, decision: policy.decision,
      folders: [{ sourceFolderId, relativePath: path, physicallyClosed: path.includes('/KAPALI'), caseType: null,
        evidence: { kinds: [], inventoryHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64) } }] })
    await applyFolderRegistration(pool, { organizationId: policy.organizationId, actorUserId: policy.actorUserId, requestId: 'test' }, plan, plan.planHash, async () => {})
    return { sourceFolderId, relativePath: path }
  }
  const reconcile = async (folders: { sourceFolderId: string; relativePath: string }[], verify = async () => {}) => {
    // PostgreSQL timestamps retain microseconds; JS milliseconds can predate the last fixture insert.
    const { scan } = (await pool.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') scan`)).rows[0]
    return reconcileOfficeFolderInventory(pool, policy, folders, scan, verify)
  }
  it('archives deleted, out-of-scope and unbound duplicate rows, preserves children and restores returning folders', async () => {
    const keep = await register('2026 OFİS/Ekim 2026/34ABC123')
    const missing = await register('2026 OFİS/Ekim 2026/06DEF456')
    await register('2026 UZAKTAN/35GHI789')
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage)
      VALUES($1,$2,2026,900,'2026/900','34 ABC 123','34ABC123','reporting')`, [uuidv7(), policy.organizationId])
    const registrations = (await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r ORDER BY id')).rows
    const locations = (await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l ORDER BY id')).rows
    expect(await reconcile([keep])).toMatchObject({ archived: 3, restored: 0 })
    expect((await pool.query('SELECT plate_normalized FROM cases WHERE NOT is_archived')).rows).toEqual([{ plate_normalized: '34ABC123' }])
    expect((await pool.query('SELECT to_jsonb(r) snapshot FROM case_folder_registrations r ORDER BY id')).rows).toEqual(registrations)
    expect((await pool.query('SELECT to_jsonb(l) snapshot FROM case_locations l ORDER BY id')).rows).toEqual(locations)
    expect(await reconcile([keep, missing])).toMatchObject({ archived: 0, restored: 1 })
    expect(await reconcile([keep, missing])).toMatchObject({ archived: 0, restored: 0, statusUpdated: 0 })
    const audits = await pool.query("SELECT details FROM audit_events WHERE action='case.office_inventory_reconciled'")
    expect(audits.rows.every(row => row.details.childRecordsPreserved)).toBe(true)
  })
  it('hides a manually cut pending folder moved to UZAKTAN and restores its original identity on return', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hb-office-inventory-'))
    try {
      const keep = await register('2026 OFİS/Ekim 2026/34TST501')
      const pending = await register('2026 OFİS/_EKSİK DOSYALAR/34TST502')
      for (const folder of [keep, pending]) await mkdir(join(root, folder.relativePath, 'EVRAK'), { recursive: true })
      await writeFile(join(root, pending.relativePath, 'EVRAK/retained.txt'), 'retained original bytes')
      const caseId = (await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [pending.sourceFolderId])).rows[0].case_id
      const scan = async () => (await discoverPlateFolders(root, { officeOnly: true })).map(folder => {
        const registered = [keep, pending].find(item => item.relativePath === folder.relativePath)
        if (!registered) throw new Error('unexpected fixture folder')
        return registered
      })
      await reconcile(await scan())
      const remote = '2026 UZAKTAN/_EKSİK DOSYALAR/34TST502'
      await mkdir(join(root, '2026 UZAKTAN/_EKSİK DOSYALAR'), { recursive: true })
      await rename(join(root, pending.relativePath), join(root, remote))
      expect((await scan()).map(item => item.sourceFolderId)).not.toContain(pending.sourceFolderId)
      expect(await reconcile(await scan())).toMatchObject({ archived: 1 })
      expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0]).toEqual({ is_archived: true })
      expect(await readFile(join(root, remote, 'EVRAK/retained.txt'), 'utf8')).toBe('retained original bytes')
      await rename(join(root, remote), join(root, pending.relativePath))
      expect(await reconcile(await scan())).toMatchObject({ restored: 1 })
      expect((await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [pending.sourceFolderId])).rows[0].case_id).toBe(caseId)
      expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0]).toEqual({ is_archived: false })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('synchronizes physically closed placement and restores the previous open stage without fabricating closure dates', async () => {
    const folder = await register('2027 OFİS/Ocak 2027/KAPALI DOSYALAR/72JKL123')
    const id = (await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [folder.sourceFolderId])).rows[0].case_id
    await pool.query("UPDATE cases SET lifecycle_status='open',workflow_stage='reporting' WHERE id=$1", [id])
    expect(await reconcile([folder])).toMatchObject({ statusUpdated: 1 })
    expect((await pool.query('SELECT lifecycle_status,workflow_stage,closed_at FROM cases WHERE id=$1', [id])).rows[0])
      .toEqual({ lifecycle_status: 'closed', workflow_stage: 'closed', closed_at: null })
    const open = { ...folder, relativePath: '2027 OFİS/Ocak 2027/72JKL123' }
    await pool.query('UPDATE case_locations SET relative_path=$1 WHERE case_id=$2', [open.relativePath, id])
    expect(await reconcile([open])).toMatchObject({ statusUpdated: 1 })
    expect((await pool.query('SELECT lifecycle_status,workflow_stage FROM cases WHERE id=$1', [id])).rows[0])
      .toEqual({ lifecycle_status: 'open', workflow_stage: 'under_repair' })
  })
  it('refuses incomplete, changed or unauthorized inventories without writing', async () => {
    const folder = await register('2026 OFİS/Ekim 2026/16MNO123')
    const before = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows
    await expect(reconcile([])).rejects.toThrow('office_inventory_incomplete')
    await expect(reconcile([{ ...folder, relativePath: '2026 UZAKTAN/16MNO123' }])).rejects.toThrow('office_inventory_invalid')
    await expect(reconcile([folder], async () => { throw new Error('source_changed') })).rejects.toThrow('source_changed')
    await expect(reconcileOfficeFolderInventory(pool, { ...policy, actorUserId: uuidv7() }, [folder], new Date().toISOString(), async () => {})).rejects.toThrow('folder_admin_required')
    expect((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows).toEqual(before)
  })
  it('preserves a manual archive and distinguishes a replacement folder from the registered source identity', async () => {
    const manual = await register('2026 OFİS/Ekim 2026/41PRS123')
    const replaced = await register('2026 OFİS/Ekim 2026/35TUV123')
    const id = (await pool.query('SELECT case_id FROM case_folder_registrations WHERE source_folder_id=$1', [manual.sourceFolderId])).rows[0].case_id
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [id])
    await reconcile([manual, { ...replaced, sourceFolderId: '999999' }])
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [id])).rows[0].is_archived).toBe(true)
    expect((await pool.query('SELECT c.is_archived FROM cases c JOIN case_folder_registrations r ON r.case_id=c.id WHERE r.source_folder_id=$1', [replaced.sourceFolderId])).rows[0].is_archived).toBe(true)
  })
  it('defers a case while its workspace is being provisioned, then reconciles it after cancellation', async () => {
    const keep = await register('2026 OFİS/Ekim 2026/27YZA123'), id = uuidv7(), operation = uuidv7()
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage)
      VALUES($1,$2,2026,901,'2026/901','34 BCD 123','34BCD123','reporting')`, [id, policy.organizationId])
    await pool.query(`INSERT INTO case_workspace_provisionings(id,organization_id,case_id,storage_root_key,relative_path,status,created_by_user_id,request_id)
      VALUES($1,$2,$3,'office','2026 OFİS/Ekim 2026/34BCD123','planned',$4,'inventory-test')`, [operation, policy.organizationId, id, policy.actorUserId])
    expect(await reconcile([keep])).toMatchObject({ inventoryDeferred: 1 })
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [id])).rows[0].is_archived).toBe(false)
    await pool.query("UPDATE case_workspace_provisionings SET status='cancelled' WHERE id=$1", [operation])
    expect(await reconcile([keep])).toMatchObject({ inventoryDeferred: 0, archived: 1 })
  })
  it('preserves cases created at or after the scan boundary while reconciling older cases', async () => {
    const keep = await register('2026 OFİS/Ekim 2026/42VWX123')
    const scan = '2026-10-17T12:00:00.123456Z'
    const ids = [uuidv7(), uuidv7(), uuidv7()]
    for (const [index, offset] of [-1, 0, 1].entries()) await pool.query(`
      INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage,created_at)
      VALUES($1,$2,2026,$3,$4,'34 XYZ 123','34XYZ123','reporting',$5::timestamptz+$6*interval '1 microsecond')`,
    [ids[index], policy.organizationId, 910 + index, `2026/${910 + index}`, scan, offset])
    await reconcileOfficeFolderInventory(pool, policy, [keep], scan, async () => {})
    const rows = (await pool.query('SELECT id,is_archived FROM cases WHERE id=ANY($1::uuid[])', [ids])).rows
    expect(ids.map(id => rows.find(row => row.id === id)?.is_archived)).toEqual([true, false, false])
  })
})
