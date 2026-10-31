import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { runIdentityMaintenance } from './repair-folder-identity.mjs'

test('maintenance CLI restores a real database backup, hashes real folder copies and repeats/rolls back without touching source files',
  { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_PG_BIN, timeout: 120_000 }, async () => {
    const database = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
    const pool = new pg.Pool({ connectionString: database.url })
    const directory = await mkdtemp(join(tmpdir(), 'hb-identity-maintenance-'))
    const restoreName = 'identity_restore_' + randomUUID().replaceAll('-', '') + '_test'
    const original = { database: process.env.DATABASE_URL, restore: process.env.RESTORE_TEST_DATABASE_URL }
    let sqlite
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
      await runMigrations({ databaseUrl: database.url, quiet: true })
      await pool.query(`CREATE DATABASE "${restoreName}"`)
      const restored = new URL(database.url); restored.pathname = '/' + restoreName
      process.env.DATABASE_URL = database.url
      process.env.RESTORE_TEST_DATABASE_URL = restored.href
      const org = uuidv7(), admin = uuidv7(), retired = uuidv7(), canonical = uuidv7(), runtime = join(directory, 'runtime')
      await mkdir(runtime)
      for (const [source, target] of [['services', 'services'], ['deploy/windows-service', 'tools'], ['node_modules', 'node_modules']]) await symlink(resolve(source), join(runtime, target), process.platform === 'win32' ? 'junction' : 'dir')
      const sourceRoot = join(directory, 'source'), backupDirectory = join(directory, 'backup')
      await mkdir(backupDirectory)
      const currentPath = '2026 OFİS/Ekim/34TST999', oldPath = '2026 OFİS/Ekim/34TST999 - 2'
      await mkdir(join(sourceRoot, currentPath, 'EVRAK'), { recursive: true })
      const bytes = Buffer.from('synthetic immutable claim evidence'), filePath = join(sourceRoot, currentPath, 'EVRAK/proof.txt')
      await writeFile(filePath, bytes)
      const hash = value => createHash('sha256').update(value).digest('hex')
      const evidence = { schemaVersion: 'folder-identity-evidence/1', folders: [{ sourceFolderId: '104', relativePath: currentPath,
        directories: ['EVRAK'], files: [{ path: 'EVRAK/proof.txt', size: bytes.length, sha256: hash(bytes) }] }], absentPaths: [oldPath] }
      const evidenceFile = join(directory, 'evidence.json'), configFile = join(directory, 'config.json')
      await writeFile(evidenceFile, JSON.stringify(evidence))
      const sqlitePath = join(directory, 'pcloud.db')
      sqlite = new DatabaseSync(sqlitePath)
      sqlite.exec("CREATE TABLE folder(id INTEGER PRIMARY KEY,parentfolderid INTEGER,name TEXT); INSERT INTO folder VALUES(100,0,'Synthetic'),(101,100,'2026 OFİS'),(102,101,'Ekim'),(104,102,'34TST999')")
      const bin = process.env.TEST_PG_BIN, suffix = process.platform === 'win32' ? '.exe' : ''
      const config = { runtimeDirectory: runtime, sourceRoot, backupDirectory, pcloudDatabasePath: sqlitePath, evidenceFile,
        organizationId: org, actorUserId: admin, topLevelFolderName: 'Synthetic', maintenanceWindowConfirmed: true,
        pgDumpPath: join(bin, 'pg_dump' + suffix), pgRestorePath: join(bin, 'pg_restore' + suffix) }
      await writeFile(configFile, JSON.stringify(config))
      await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'maintenance-test','Synthetic')", [org])
      await pool.query("INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,'operator@example.test','Synthetic')", [admin, org])
      await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [admin])
      await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'test-root','Synthetic')", [uuidv7(), org])
      for (const [index, id, path, archived] of [[1, retired, oldPath, true], [2, canonical, currentPath, false]]) {
        await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,is_archived,workflow_stage)
          VALUES($1,$2,2026,$3,$4,'34 TST 999','34TST999',$5,'reporting')`, [id, org, index, `2026/${index}`, archived])
        await pool.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
          VALUES($1,$2,$3,'test-root',$4,'verified','system')`, [uuidv7(), org, id, path])
      }
      await pool.query(`INSERT INTO case_folder_registrations(id,organization_id,case_id,storage_root_key,source_folder_id,source_relative_path,evidence,plan_hash,created_by_user_id)
        VALUES($1,$2,$3,'test-root','104',$4,'{}',$5,$6)`, [uuidv7(), org, retired, oldPath, 'a'.repeat(64), admin])
      const decisionFile = join(directory, 'decision.json'), planFile = join(directory, 'plan.json'), approvalFile = join(directory, 'approval.json'), receiptFile = join(directory, 'receipt.json')
      await writeFile(decisionFile, JSON.stringify({ storageRootKey: 'test-root', relationship: 'duplicate_claim', evidenceSha256: hash(await readFile(evidenceFile)), cases: [
        { caseId: retired, officialEvidenceReference: 'synthetic duplicate independently checked', target: null },
        { caseId: canonical, officialEvidenceReference: 'synthetic official claim independently checked', target: { sourceFolderId: '104', relativePath: currentPath } },
      ] }))
      const planned = await runIdentityMaintenance(configFile, 'plan', decisionFile, planFile)
      assert.equal(planned.productionMutations, 0)
      await writeFile(approvalFile, JSON.stringify({ operatorId: admin, approvedAt: new Date().toISOString(), approvedPlanHash: planned.planHash }))
      const applied = await runIdentityMaintenance(configFile, 'apply', planFile, approvalFile, receiptFile)
      assert.equal(applied.status, 'APPLIED')
      assert.deepEqual(await readFile(filePath), bytes)
      const backups = await readdir(backupDirectory)
      assert.equal(backups.length, 1)
      const files = await readdir(join(backupDirectory, backups[0]))
      for (const file of ['database.dump', 'folder-manifest.json', 'restore-proof.json', 'receipt.json']) assert.ok(files.includes(file))
      assert.equal((await runIdentityMaintenance(configFile, 'apply', planFile, approvalFile, join(directory, 'replay.json'))).status, 'ALREADY_APPLIED')
      const rollbackFile = join(directory, 'rollback.json')
      await writeFile(rollbackFile, JSON.stringify({ operatorId: admin, approvedAt: new Date().toISOString(), approvedReceiptHash: applied.receiptDigest }))
      assert.equal((await runIdentityMaintenance(configFile, 'rollback', receiptFile, rollbackFile)).status, 'ROLLED_BACK')
      assert.equal((await runIdentityMaintenance(configFile, 'rollback', receiptFile, rollbackFile)).status, 'ALREADY_ROLLED_BACK')
      assert.equal((await pool.query("SELECT case_id FROM case_folder_registrations WHERE source_folder_id='104'")).rows[0].case_id, retired)
      assert.deepEqual(await readFile(filePath), bytes)
    } finally {
      sqlite?.close()
      if (original.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.database
      if (original.restore === undefined) delete process.env.RESTORE_TEST_DATABASE_URL; else process.env.RESTORE_TEST_DATABASE_URL = original.restore
      await pool.query(`DROP DATABASE IF EXISTS "${restoreName}" WITH (FORCE)`)
      await pool.end()
      assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('hb-identity-maintenance-'))
      // Remove junctions themselves before recursive cleanup; never traverse repository targets.
      for (const name of ['services', 'tools', 'node_modules']) {
        const { rmdir } = await import('node:fs/promises')
        try { await rmdir(join(directory, 'runtime', name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      await rm(directory, { recursive: true, force: true })
    }
  })
