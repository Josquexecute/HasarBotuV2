import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { planV1Remediation, applyV1Remediation } from '../src/v1-import/remediation.js'
import { applyRegisteredV1Notes, registeredNotesManifestSchema } from '../src/v1-import/registered-notes.js'
import { hashPassword } from '../src/auth/password.js'
import { buildV1SourceIdentityMaterial } from '@hasarbotu/domain'

describe.skipIf(!process.env.TEST_DATABASE_URL)('registered V1 notes independent of pending classification', () => {
  let pool: pg.Pool, root: string, org: string, actor: string
  const claims: string[] = [], bindings: Array<ReturnType<typeof registeredNotesManifestSchema.parse>['bindings'][number]> = []
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  const manifest = () => registeredNotesManifestSchema.parse({ storageRootKey: 'synthetic-root', bindings })
  const approvedHash = () => sha(JSON.stringify({ organizationId: org, manifest: manifest() }))
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = createDatabasePool({ config });root = await mkdtemp(join(tmpdir(), 'hb-registered-notes-'))
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7();actor = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'registered-notes','Synthetic')", [org])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'synthetic-root','Synthetic')", [uuidv7(), org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'registered-notes@example.test','Synthetic',$3)", [actor, org, await hashPassword('Synthetic-Notes-Only-42!')])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [actor])
    for (let index = 0; index < 2; index++) {
      const caseId = uuidv7(), relativePath = `2026/Temmuz 2026/34TST${index + 100}`
      claims.push(caseId)
      await mkdir(join(root, relativePath, '_HASARBOTU'), { recursive: true })
      await writeFile(join(root, relativePath, '_HASARBOTU/takip.json'), JSON.stringify({ schemaVersion: 1, claimType: '', caseIdentity: { caseKey: `pending-${index}` }, metadata: { createdAt: '2026-07-01T00:00:00Z' }, notes: [{ id: `note-${index}`, text: `Historical note ${index}`, createdBy: 'Historical author', createdAt: '2026-07-02T01:00:00Z' }] }))
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized) VALUES($1,$2,2026,$3,$4,NULL,'new_notification',$5,$5)`, [caseId, org, index + 1, `2026/${index + 1}`, `34TST${index + 100}`])
      await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,source,verification_status) VALUES($1,$2,$3,'synthetic-root',$4,'imported','pending')", [uuidv7(), org, caseId, relativePath])
      await pool.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id) VALUES($1,$2,$3,'synthetic-root',$4,$5,'{}',$6,$7)`, [uuidv7(), org, caseId, String(index + 100), relativePath, 'a'.repeat(64), actor])
    }
    const plan = await planV1Remediation(pool, org, root)
    expect(plan.summary.actionable.notesToCreate).toBe(0)
    await applyV1Remediation(pool, { organizationId: org, actorUserId: actor, requestId: 'archive-before-registered-notes' }, plan)
    for (const entry of plan.entries) bindings.push({ caseId: claims[entry.folder.relativePath.endsWith('100') ? 0 : 1]!, expectedCaseVersion: 1, sourceFolderId: entry.folder.relativePath.endsWith('100') ? '100' : '101', relativePath: entry.folder.relativePath, sourceIdentity: entry.sourceIdentity!, sourceFileHash: entry.sourceHash! })
  }, 60_000)
  afterAll(async () => { if (pool) await closeDatabasePool(pool);if (root) await rm(root, { recursive: true, force: true }) })
  const apply = (hash = approvedHash(), data = manifest()) => applyRegisteredV1Notes(pool, { organizationId: org, actorUserId: actor, requestId: 'registered-notes-test' }, root, data, hash, async () => {})
  it('rejects changed approval, registration, source identity and source bytes', async () => {
    await expect(apply('b'.repeat(64))).rejects.toThrow('approval_mismatch')
    const changed = manifest();changed.bindings[0]!.sourceFolderId = '999'
    await expect(apply(sha(JSON.stringify({ organizationId: org, manifest: changed })), changed)).rejects.toThrow('binding_changed')
    const file = join(root, bindings[0]!.relativePath, '_HASARBOTU/takip.json'), bytes = await readFile(file)
    await writeFile(file, Buffer.concat([bytes, Buffer.from(' ')]))
    try { await expect(apply()).rejects.toThrow('source_changed') } finally { await writeFile(file, bytes) }
    expect((await pool.query('SELECT count(*)::int n FROM case_notes')).rows[0].n).toBe(0)
  })
  it('rolls back all notes and provenance when audit fails', async () => {
    await pool.query("CREATE FUNCTION reject_registered_notes_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='v1_registered_notes.imported' THEN RAISE EXCEPTION 'synthetic';END IF;RETURN NEW;END $$;CREATE TRIGGER reject_registered_notes_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_registered_notes_audit()")
    try { await expect(apply()).rejects.toThrow();expect((await pool.query('SELECT count(*)::int n FROM case_notes')).rows[0].n).toBe(0) }
    finally { await pool.query('DROP TRIGGER reject_registered_notes_audit ON audit_events;DROP FUNCTION reject_registered_notes_audit()') }
  })
  it('imports author/date/provenance once and preserves every case field and unresolved quarantine', async () => {
    const before = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows
    expect(await apply()).toMatchObject({ notesCreated: 2, alreadyImported: 0, caseFieldsPreserved: true })
    expect(await apply()).toMatchObject({ notesCreated: 0, alreadyImported: 2 })
    expect((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows).toEqual(before)
    const metadata = (await pool.query("SELECT source_author_name,to_char(source_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') date FROM v1_import_item_metadata WHERE item_type='note'")).rows
    expect(metadata).toEqual([{ source_author_name: 'Historical author', date: '2026-07-02 01:00' }, { source_author_name: 'Historical author', date: '2026-07-02 01:00' }])
    expect((await pool.query('SELECT count(*)::int n FROM v1_import_quarantine_status WHERE NOT resolved')).rows[0].n).toBe(2)
  })
  it('restores notes for a newly registered insurer-suffixed source without requiring a previous historical import', async () => {
    const caseId = uuidv7(), relativePath = '2026/Temmuz 2026/34TST200-AXA SİGORTA'
    const data = { schemaVersion: 1, claimType: 'trafik', caseIdentity: { caseKey: '34TST200-AXA SİGORTA', plate: '34TST200-AXA SİGORTA' }, metadata: { createdAt: '2026-07-03T00:00:00Z' }, notes: [{ id: 'unarchived-note', text: 'Unarchived historical note', createdBy: 'Historical author', createdAt: '2026-07-04T09:00:00Z' }] }
    const bytes = JSON.stringify(data)
    await mkdir(join(root, relativePath, '_HASARBOTU'), { recursive: true })
    await writeFile(join(root, relativePath, '_HASARBOTU/takip.json'), bytes)
    await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized) VALUES($1,$2,2026,200,'2026/200','traffic','new_notification','34 TST 200','34TST200')", [caseId, org])
    await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,source,verification_status) VALUES($1,$2,$3,'synthetic-root',$4,'imported','pending')", [uuidv7(), org, caseId, relativePath])
    await pool.query("INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id) VALUES($1,$2,$3,'synthetic-root','200',$4,'{}',$5,$6)", [uuidv7(), org, caseId, relativePath, 'a'.repeat(64), actor])
    const identity = buildV1SourceIdentityMaterial({ caseKey: data.caseIdentity.caseKey, createdAt: data.metadata.createdAt })
    if (!identity.ok) throw new Error('invalid fixture identity')
    const sourceIdentity = sha(identity.material)
    expect((await pool.query('SELECT id FROM v1_import_source_revisions WHERE stable_source_identity=$1', [sourceIdentity])).rowCount).toBe(0)
    const input = registeredNotesManifestSchema.parse({ storageRootKey: 'synthetic-root', bindings: [{ caseId, expectedCaseVersion: 1, sourceFolderId: '200', relativePath, sourceIdentity, sourceFileHash: sha(bytes) }] })
    const approved = sha(JSON.stringify({ organizationId: org, manifest: input }))
    const run = () => applyRegisteredV1Notes(pool, { organizationId: org, actorUserId: actor, requestId: 'unarchived-source' }, root, input, approved, async () => {})
    expect(await run()).toMatchObject({ notesCreated: 1, alreadyImported: 0 })
    expect(await run()).toMatchObject({ notesCreated: 0, alreadyImported: 1 })
    expect((await pool.query('SELECT body FROM case_notes WHERE case_id=$1', [caseId])).rows).toEqual([{ body: data.notes[0]!.text }])
    expect((await pool.query('SELECT raw_snapshot FROM v1_import_source_revisions WHERE stable_source_identity=$1', [sourceIdentity])).rows[0].raw_snapshot.notes).toEqual(data.notes)
  })
})
