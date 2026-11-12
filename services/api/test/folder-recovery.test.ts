import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createAuditService } from '../src/audit/service.js'
import { applyFolderRegistration, planFolderRegistration } from '../src/cases/folder-registration.js'
import { applySourceFolderRelocation, planSourceFolderRelocation, readWorkspaceFolderIdentity, type SourceFolderRelocation } from '../src/cases/source-folder-relocation.js'
import { completeFolderChecks } from '../src/cases/folder-recovery-store.js'
import { reconcileOfficeFolderInventory } from '../src/cases/office-folder-inventory.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('workspace recovery and operator checks (real PostgreSQL)', () => {
  let pool: pg.Pool, app: FastifyInstance, org: string, admin: string, adminCookie: string, readerCookie: string, foreignCookie: string
  let sequence = 100
  const actor = () => ({ organizationId: org, actorUserId: admin, requestId: 'workspace-recovery-test' })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'recovery','Synthetic')", [org])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'office','Synthetic')", [uuidv7(), org])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    await app.ready()
    const password = 'isolated-recovery-password'
    const passwordHash = await hashPassword(password)
    async function user(organizationId: string, role: string) {
      const id = uuidv7(), email = id + '@example.test'
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, organizationId, email, role, passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
      expect(response.statusCode).toBe(200)
      return { id, cookie: String(response.headers['set-cookie']).split(';')[0]! }
    }
    const owner = await user(org, 'admin'); admin = owner.id; adminCookie = owner.cookie
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code IN ('expert','case_manager')", [admin])
    readerCookie = (await user(org, 'read_only')).cookie
    const other = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'foreign-recovery','Synthetic')", [other])
    foreignCookie = (await user(other, 'admin')).cookie
  }, 60_000)
  afterAll(async () => { await app?.close(); await pool?.end() })

  async function fixture() {
    const plate = `34WKS${++sequence}`, path = '2026 OFİS/_EKSİK DOSYALAR/' + plate
    const registration = await planFolderRegistration(pool, org, { schemaVersion: 'hasarbotu-folder-registration/1', storageRootKey: 'office',
      responsibleUserId: admin, expertUserId: admin, decision: 'Synthetic workspace ownership', folders: [{ sourceFolderId: String(sequence),
        relativePath: path, physicallyClosed: false, caseType: 'casco', evidence: { inventoryHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), kinds: ['k_ruhsat'] } }] })
    const caseId = (await applyFolderRegistration(pool, actor(), registration, registration.planHash, async () => {})).caseIds[0]!
    const workspaceId = uuidv7(), fileId = uuidv7()
    await pool.query(`INSERT INTO case_workspace_provisionings(id,organization_id,case_id,storage_root_key,relative_path,status,created_by_user_id,request_id)
      VALUES($1,$2,$3,'office',$4,'ready',$5,'synthetic')`, [workspaceId, org, caseId, path, admin])
    await pool.query(`INSERT INTO tracked_files(id,organization_id,case_id,storage_root_key,relative_path,current_hash,revision)
      VALUES($1,$2,$3,'office',$4,$5,1)`, [fileId, org, caseId, path + '/notice.pdf', 'a'.repeat(64)])
    await pool.query(`INSERT INTO document_observations(id,file_id,revision,content_hash,byte_size,file_name)
      VALUES($1,$2,1,$3,10,'notice.pdf')`, [uuidv7(), fileId, 'a'.repeat(64)])
    const location = (await pool.query('SELECT * FROM case_locations WHERE case_id=$1', [caseId])).rows[0]
    const identity = await readWorkspaceFolderIdentity(pool, org, caseId, 'office', path)
    const input: SourceFolderRelocation = { storageRootKey: 'office', decision: 'Verify UUID and every recorded file; no plate guessing', bindings: [{
      caseId, sourceFolderId: String(sequence + 10_000), relativePath: '2026 OFİS/Kasım 2026/' + plate, expectedCaseVersion: 1,
      expectedLifecycleStatus: 'open', physicallyClosed: false,
      previousLocation: { id: location.id, storageRootKey: 'office', relativePath: path, version: 1 },
      identity: { kind: 'workspace', workspaceId, previousSourceFolderId: String(sequence), manifestHash: identity.manifestHash },
    }] }
    return { input, caseId, fileId, plate }
  }

  it('recovers a recreated UUID-marked folder with one recorded document and follows a second move without rewriting history', async () => {
    const { input, caseId, fileId } = await fixture(), binding = input.bindings[0]!
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [caseId])
    await createAuditService().record(pool, { ...actor(), action: 'case.office_inventory_reconciled', entityType: 'case', entityId: caseId, details: { managedArchive: true } })
    const before = (await pool.query('SELECT to_jsonb(f) row FROM tracked_files f WHERE id=$1', [fileId])).rows
    const plan = await planSourceFolderRelocation(pool, org, input), verify = vi.fn(async () => {})
    expect(await applySourceFolderRelocation(pool, actor(), plan, plan.planHash, verify)).toMatchObject({ relocated: 1 })
    expect(verify).toHaveBeenCalledTimes(2)
    expect((await pool.query('SELECT source_folder_id FROM case_folder_registrations WHERE case_id=$1', [caseId])).rows[0].source_folder_id).toBe(binding.sourceFolderId)
    const identity = await readWorkspaceFolderIdentity(pool, org, caseId, 'office', binding.relativePath)
    expect(identity.files).toEqual([{ relativePath: 'notice.pdf', sha256: 'a'.repeat(64) }])
    const second: SourceFolderRelocation = structuredClone(input)
    second.bindings[0]!.previousLocation = { ...binding.previousLocation, relativePath: binding.relativePath, version: 2 }
    second.bindings[0]!.relativePath = binding.relativePath.replace('Kasım', 'Aralık')
    second.bindings[0]!.sourceFolderId = String(Number(binding.sourceFolderId) + 1000)
    second.bindings[0]!.identity = { ...binding.identity as Extract<typeof binding.identity, { kind: 'workspace' }>, previousSourceFolderId: binding.sourceFolderId, manifestHash: identity.manifestHash }
    const secondPlan = await planSourceFolderRelocation(pool, org, second)
    await applySourceFolderRelocation(pool, actor(), secondPlan, secondPlan.planHash, async () => {})
    expect((await pool.query('SELECT to_jsonb(f) row FROM tracked_files f WHERE id=$1', [fileId])).rows).toEqual(before)
  })

  it.each(['wrong_workspace', 'changed_hash', 'manual_archive', 'active_operation', 'missing_observation'] as const)('rejects unproven workspace recovery: %s', async reason => {
    const { input, caseId, fileId } = await fixture(), binding = input.bindings[0]!
    if (reason === 'wrong_workspace' && binding.identity.kind === 'workspace') binding.identity.workspaceId = uuidv7()
    if (reason === 'changed_hash') await pool.query('UPDATE tracked_files SET current_hash=$1 WHERE id=$2', ['c'.repeat(64), fileId])
    if (reason === 'manual_archive') await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [caseId])
    if (reason === 'missing_observation') await pool.query('DELETE FROM document_observations WHERE file_id=$1', [fileId])
    if (reason === 'active_operation') await pool.query(`INSERT INTO field_photo_uploads(id,organization_id,case_id,uploaded_by_user_id,client_key,kind,original_file_name,byte_size,content_hash,storage_root_key,relative_path,location_version)
      VALUES($1,$2,$3,$4,$5,'damage','damage.jpg',10,$6,'office',$7,1)`, [uuidv7(), org, caseId, admin, uuidv7(), 'd'.repeat(64), binding.previousLocation.relativePath])
    await expect(planSourceFolderRelocation(pool, org, input)).rejects.toThrow()
    expect((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [caseId])).rows[0].relative_path).toBe(binding.previousLocation.relativePath)
  })

  it('rolls back if the physical identity changes during the transaction', async () => {
    const { input, caseId } = await fixture(), plan = await planSourceFolderRelocation(pool, org, input)
    let calls = 0
    await expect(applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => { if (++calls === 2) throw new Error('source_changed') })).rejects.toThrow('source_changed')
    expect((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [caseId])).rows[0].relative_path).toBe(input.bindings[0]!.previousLocation.relativePath)
  })

  it('exposes archived records only to the correct administrator and waits for a genuinely later scan', async () => {
    const { caseId, plate } = await fixture()
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [caseId])
    const url = '/api/v1/administration/folder-recovery?search=' + plate
    expect((await app.inject({ url })).statusCode).toBe(401)
    expect((await app.inject({ url, headers: { cookie: readerCookie } })).statusCode).toBe(403)
    expect((await app.inject({ url, headers: { cookie: foreignCookie } })).json().items).toEqual([])
    expect((await app.inject({ url, headers: { cookie: adminCookie } })).json().items[0]).toMatchObject({ caseId, status: 'manually_archived' })
    const request = () => app.inject({ method: 'POST', url: '/api/v1/administration/folder-recovery/check', headers: { cookie: adminCookie }, payload: {} })
    const requested = await request(); expect(requested.statusCode).toBe(202)
    expect((await request()).json().id).toBe(requested.json().id)
    await completeFolderChecks(pool, actor(), '2000-01-01T00:00:00.000Z', { repaired: 0, remaining: 1 })
    expect((await app.inject({ url, headers: { cookie: adminCookie } })).json().latestCheck.completedAt).toBeNull()
    await completeFolderChecks(pool, actor(), new Date().toISOString(), { repaired: 0, remaining: 1 })
    expect((await app.inject({ url, headers: { cookie: adminCookie } })).json().latestCheck).toMatchObject({ id: requested.json().id, repaired: 0, remaining: 1, completedAt: expect.any(String) })
    expect((await app.inject({ method: 'POST', url: '/api/v1/administration/folder-recovery/check', headers: { cookie: adminCookie }, payload: { relativePath: 'arbitrary' } })).statusCode).toBe(400)
  })

  const decision = (caseId: string, payload: Record<string, unknown>, cookie = adminCookie) => app.inject({ method: 'POST',
    url: `/api/v1/administration/folder-management/${caseId}/decision`, headers: { cookie }, payload })
  const management = (plate: string, includeRemoved = false, cookie = adminCookie) => app.inject({
    url: '/api/v1/administration/folder-management?' + new URLSearchParams({ search: plate, includeRemoved: String(includeRemoved) }), headers: { cookie } })
  const removal = (expectedVersion = 1) => ({ action: 'remove', expectedVersion, expectedLocationVersion: 1, reason: 'duplicate', explanation: 'Synthetic duplicate without an actual office folder' })
  async function inventoryFor(caseId: string) {
    const folder = (await pool.query('SELECT source_folder_id AS "sourceFolderId",source_relative_path AS "relativePath" FROM case_folder_registrations WHERE case_id=$1', [caseId])).rows[0]
    const scan = (await pool.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') scan`)).rows[0].scan
    return reconcileOfficeFolderInventory(pool, { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId: org, storageRootKey: 'office', actorUserId: admin,
      responsibleUserId: admin, expertUserId: admin, decision: 'Synthetic verified inventory', baselineSourceFolderIds: [] }, [folder], scan, async () => {})
  }
  it('removes exactly one same-plate record from normal views, retains evidence and prevents scan resurrection until explicit recovery', async () => {
    const target = await fixture(), neighbor = await fixture()
    await pool.query('UPDATE cases SET plate=$1,plate_normalized=$1 WHERE id=$2', [target.plate, neighbor.caseId])
    const before = (await pool.query('SELECT to_jsonb(f) row FROM tracked_files f WHERE case_id=$1', [target.caseId])).rows
    // A prior automatic archive must not override the newer operator decision.
    await createAuditService().record(pool, { ...actor(), action: 'case.office_inventory_reconciled', entityType: 'case', entityId: target.caseId, details: { managedArchive: true } })
    expect((await management(target.plate)).json().items).toHaveLength(2)
    expect((await decision(target.caseId, removal())).statusCode).toBe(204)
    expect((await management(target.plate)).json().items.map((r: { caseId: string }) => r.caseId)).toEqual([neighbor.caseId])
    expect((await management(target.plate, true)).json().items.find((r: { caseId: string }) => r.caseId === target.caseId)).toMatchObject({ archived: true, disposition: 'removed', version: 2 })
    expect((await app.inject({ url: '/api/v1/cases/' + target.caseId, headers: { cookie: adminCookie } })).statusCode).toBe(404)
    await inventoryFor(target.caseId)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [target.caseId])).rows[0].is_archived).toBe(true)
    await expect(planSourceFolderRelocation(pool, org, { ...target.input, bindings: [{ ...target.input.bindings[0]!, expectedCaseVersion: 2 }] })).rejects.toThrow('folder_relocation_case_not_found')
    expect((await decision(target.caseId, { ...removal(2), action: 'recover' })).statusCode).toBe(204)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [target.caseId])).rows[0].is_archived).toBe(true)
    await inventoryFor(target.caseId)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [target.caseId])).rows[0].is_archived).toBe(false)
    expect((await pool.query('SELECT to_jsonb(f) row FROM tracked_files f WHERE case_id=$1', [target.caseId])).rows).toEqual(before)
    const history = (await pool.query("SELECT details FROM audit_events WHERE resource_id=$1 AND action='case.folder_management_changed' ORDER BY occurred_at,id", [target.caseId])).rows
    expect(history.map(r => r.details.disposition)).toEqual(['removed', 'recovery_requested'])
    expect(history.every(r => r.details.physicalFilesUnchanged && r.details.childRecordsPreserved)).toBe(true)
  })
  it('validates tenant, role, input and stale versions without altering the record', async () => {
    const { caseId, plate } = await fixture()
    expect((await decision(caseId, removal(), '')).statusCode).toBe(401)
    expect((await decision(caseId, removal(), readerCookie)).statusCode).toBe(403)
    expect((await decision(caseId, removal(), foreignCookie)).statusCode).toBe(404)
    expect((await management(plate, true, foreignCookie)).json().items).toEqual([])
    expect((await decision(caseId, { ...removal(), relativePath: 'arbitrary' })).statusCode).toBe(400)
    expect((await decision(caseId, { ...removal(), explanation: ' ' })).statusCode).toBe(400)
    expect((await decision(caseId, removal(99))).statusCode).toBe(409)
    expect((await decision(caseId, { ...removal(), action: 'recover' })).statusCode).toBe(409)
    expect((await pool.query('SELECT version,is_archived FROM cases WHERE id=$1', [caseId])).rows[0]).toEqual({ version: 1, is_archived: false })
    // Relocations update the location version without changing the business case version.
    await pool.query('UPDATE case_locations SET version=version+1 WHERE case_id=$1', [caseId])
    expect((await decision(caseId, removal())).statusCode).toBe(409)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0].is_archived).toBe(false)
  })
  it('serializes simultaneous decisions and refuses to remove while photos are pending', async () => {
    const { caseId } = await fixture()
    const upload = uuidv7()
    await pool.query(`INSERT INTO field_photo_uploads(id,organization_id,case_id,uploaded_by_user_id,client_key,kind,original_file_name,byte_size,content_hash,storage_root_key,relative_path,location_version)
      VALUES($1,$2,$3,$4,$5,'damage','damage.jpg',10,$6,'office','synthetic',1)`, [upload, org, caseId, admin, uuidv7(), 'e'.repeat(64)])
    expect((await decision(caseId, removal())).statusCode).toBe(409)
    expect((await management((await pool.query('SELECT plate FROM cases WHERE id=$1', [caseId])).rows[0].plate)).json().items[0].hasActiveOperations).toBe(true)
    await pool.query("UPDATE field_photo_uploads SET status='failed',last_error_code='synthetic_terminal_upload' WHERE id=$1", [upload])
    const pendingJob = uuidv7(), workspace = (await pool.query('SELECT id FROM case_workspace_provisionings WHERE case_id=$1', [caseId])).rows[0].id
    await pool.query(`INSERT INTO jobs(id,organization_id,type,target_type,target_id,target_version,payload)
      VALUES($1,$2,'provision_case_workspace','workspace_provisioning',$3,0,'{}')`, [pendingJob, org, workspace])
    expect((await decision(caseId, removal())).statusCode).toBe(409)
    await pool.query("UPDATE jobs SET status='dead_letter' WHERE id=$1", [pendingJob])
    const results = await Promise.all([decision(caseId, removal()), decision(caseId, removal())])
    expect(results.map(r => r.statusCode).sort()).toEqual([204, 409])
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE resource_id=$1 AND action='case.folder_management_changed'", [caseId])).rows[0].n).toBe(1)
  })
  it('rechecks the exact saved location through a versioned worker job and preserves its path', async () => {
    const { caseId } = await fixture()
    const location = (await pool.query('SELECT * FROM case_locations WHERE case_id=$1', [caseId])).rows[0]
    expect((await decision(caseId, { ...removal(), action: 'dispute', reason: 'wrong_link' })).statusCode).toBe(204)
    expect((await pool.query('SELECT relative_path,verification_status,version FROM case_locations WHERE case_id=$1', [caseId])).rows[0])
      .toEqual({ relative_path: location.relative_path, verification_status: 'pending', version: 2 })
    expect((await pool.query("SELECT target_id,target_version,payload FROM jobs WHERE target_type='case_location' AND target_id=$1 ORDER BY created_at DESC LIMIT 1", [location.id])).rows[0])
      .toMatchObject({ target_id: location.id, target_version: 2, payload: { storageRootKey: 'office', relativePath: location.relative_path, kind: 'directory' } })
  })
  it('requires explicit permission before recovering a manually archived folder at a new path', async () => {
    const { caseId, input } = await fixture()
    await pool.query('UPDATE cases SET is_archived=true WHERE id=$1', [caseId])
    await expect(planSourceFolderRelocation(pool, org, input)).rejects.toThrow('folder_relocation_case_not_found')
    expect((await decision(caseId, { ...removal(), action: 'recover', reason: 'other' })).statusCode).toBe(204)
    const resumed = structuredClone(input)
    resumed.bindings[0]!.expectedCaseVersion = 2
    const plan = await planSourceFolderRelocation(pool, org, resumed)
    expect((await applySourceFolderRelocation(pool, actor(), plan, plan.planHash, async () => {})).relocated).toBe(1)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0].is_archived).toBe(true)
    await inventoryFor(caseId)
    expect((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [caseId])).rows[0].is_archived).toBe(false)
  })
})
