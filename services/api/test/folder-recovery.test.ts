import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createAuditService } from '../src/audit/service.js'
import { applyFolderRegistration, planFolderRegistration } from '../src/cases/folder-registration.js'
import { applySourceFolderRelocation, planSourceFolderRelocation, readWorkspaceFolderIdentity, type SourceFolderRelocation } from '../src/cases/source-folder-relocation.js'
import { completeFolderChecks } from '../src/cases/folder-recovery-store.js'

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
})
