import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, cp, symlink, writeFile, rm } from 'node:fs/promises'
import { readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { startAutomaticFolderDiscovery } from './automatic-folder-discovery.mjs'

test('a pCloud source outage invalidates inventory evidence; recovery requires two fresh scans before archiving', { skip: !process.env.TEST_DATABASE_URL, timeout: 90_000 }, async () => {
  const database = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  const pool = new pg.Pool({ connectionString: database.url })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await runMigrations({ databaseUrl: database.url, quiet: true })
  const directory = await mkdtemp(join(tmpdir(), 'hb-pcloud-outage-'))
  const runtime = join(directory, 'runtime'), source = join(directory, 'source'), unavailable = join(directory, 'offline-source')
  const repo = resolve('.')
  await mkdir(join(runtime, 'services/api'), { recursive: true })
  await cp(join(repo, 'services/api/dist'), join(runtime, 'services/api/dist'), { recursive: true })
  await cp(join(repo, 'services/api/package.json'), join(runtime, 'services/api/package.json'))
  await symlink(join(repo, 'node_modules'), join(runtime, 'services/api/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await cp(join(repo, 'deploy/windows-service'), join(runtime, 'tools'), { recursive: true, filter: path => !path.endsWith('.test.mjs') && !path.endsWith('.tests.ps1') })
  await mkdir(join(source, '2026 OFİS/EKİM 2026/34TST123'), { recursive: true })
  const sqlitePath = join(directory, 'synthetic-cloud.db'), sqlite = new DatabaseSync(sqlitePath)
  sqlite.exec("CREATE TABLE folder(id INTEGER PRIMARY KEY,parentfolderid INTEGER,name TEXT); INSERT INTO folder VALUES(100,0,'SyntheticCompany'),(101,100,'2026 OFİS'),(102,101,'EKİM 2026'),(103,102,'34TST123')")
  const org = uuidv7(), admin = uuidv7(), owner = uuidv7(), expert = uuidv7(), staleCase = uuidv7()
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'outage-test','Synthetic')", [org])
  for (const [id, role] of [[admin, 'admin'], [owner, 'case_manager'], [expert, 'expert']]) {
    await pool.query('INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,$3,$4)', [id, org, `${id}@example.test`, role])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
  }
  await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'outage-root','Synthetic')", [uuidv7(), org])
  await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage) VALUES($1,$2,2026,900,'2026/900','06 OLD 900','06OLD900','reporting')", [staleCase, org])
  const statusFile = join(directory, 'status.json'), configFile = join(directory, 'config.json')
  await writeFile(configFile, JSON.stringify({ intervalMs: 15_000, runtimeDirectory: runtime, sourceRoot: source,
    pcloudDatabasePath: sqlitePath, statusFile, topLevelFolderName: 'SyntheticCompany', trackRegisteredMoves: true, officeInventoryOnly: true,
    policy: { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId: org, storageRootKey: 'outage-root',
      actorUserId: admin, responsibleUserId: owner, expertUserId: expert, baselineSourceFolderIds: [], decision: 'Synthetic outage acceptance only.' } }))
  const originalUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = database.url
  const stop = new AbortController(), deadline = setTimeout(() => stop.abort(), 75_000)
  let phase = 'initial', blocked = false, freshAfterRecovery = false, reconciled = false
  const snapshots = []
  try {
    await startAutomaticFolderDiscovery(configFile, { signal: stop.signal, onStatus: text => {
      const status = JSON.parse(text)
      if (phase === 'initial' && status.status === 'PASS') {
        assert.equal(status.archived, undefined)
        phase = 'offline'
        snapshots.push(pool.query('SELECT is_archived FROM cases WHERE id=$1', [staleCase]))
        renameSync(source, unavailable)
      } else if (phase === 'offline' && status.status === 'BLOCKED') {
        assert.equal(status.code, 'ENOENT')
        blocked = true
        snapshots.push(pool.query('SELECT is_archived FROM cases WHERE id=$1', [staleCase]))
        renameSync(unavailable, source)
        phase = 'recovery'
      } else if (phase === 'recovery' && status.status === 'PASS') {
        assert.equal(status.archived, undefined, 'Evidence from before the outage must not permit reconciliation')
        assert.equal(JSON.parse(readFileSync(statusFile, 'utf8')).inventorySettling, true)
        freshAfterRecovery = true
        snapshots.push(pool.query('SELECT is_archived FROM cases WHERE id=$1', [staleCase]))
        phase = 'fresh'
      } else if (phase === 'fresh' && status.archived !== undefined) {
        assert.equal(status.archived, 1)
        reconciled = true
        stop.abort()
      }
    } })
    assert.equal(blocked, true)
    assert.equal(freshAfterRecovery, true)
    assert.equal(reconciled, true)
    for (const snapshot of await Promise.all(snapshots)) assert.deepEqual(snapshot.rows, [{ is_archived: false }])
    assert.deepEqual((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [staleCase])).rows, [{ is_archived: true }])
    assert.equal((await pool.query("SELECT count(*)::int n FROM case_folder_registrations WHERE source_folder_id='103'")).rows[0].n, 1)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM folder').get().n, 4)
  } finally {
    clearTimeout(deadline); stop.abort(); sqlite.close(); await pool.end()
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('hb-pcloud-outage-'))
    await rm(directory, { recursive: true, force: true })
  }
})
