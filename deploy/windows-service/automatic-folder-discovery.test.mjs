import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, cp, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { startAutomaticFolderDiscovery } from './automatic-folder-discovery.mjs'
import { writeFile } from 'node:fs/promises'

test('real background scans discover a later folder and preserve its case after restart', { skip: !process.env.TEST_DATABASE_URL, timeout: 60_000 }, async () => {
  const database = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  const pool = new pg.Pool({ connectionString: database.url })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: database.url, quiet: true })
  const directory = await mkdtemp(join(tmpdir(), 'hasarbotu-auto-folder-test-'))
  const runtime = join(directory, 'runtime'), source = join(directory, 'source'), repo = resolve('.')
  await mkdir(join(runtime, 'services/api'), { recursive: true })
  await cp(join(repo, 'services/api/dist'), join(runtime, 'services/api/dist'), { recursive: true })
  await cp(join(repo, 'services/api/package.json'), join(runtime, 'services/api/package.json'))
  await symlink(join(repo, 'node_modules'), join(runtime, 'services/api/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await cp(join(repo, 'deploy/windows-service'), join(runtime, 'tools'), { recursive: true, filter: path => !path.endsWith('.test.mjs') && !path.endsWith('.tests.ps1') })
  await mkdir(join(source, '2026/EKİM 2026'), { recursive: true })
  const sqlitePath = join(directory, 'pcloud-test.db'), sqlite = new DatabaseSync(sqlitePath)
  sqlite.exec("CREATE TABLE folder(id INTEGER PRIMARY KEY,parentfolderid INTEGER,name TEXT); INSERT INTO folder VALUES(100,0,'SyntheticCompany'),(101,100,'2026'),(102,101,'EKİM 2026')")
  const org = uuidv7(), admin = uuidv7(), owner = uuidv7(), expert = uuidv7()
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'auto-folder-test','Synthetic')", [org])
  for (const [id, role] of [[admin, 'admin'], [owner, 'case_manager'], [expert, 'expert']]) {
    await pool.query('INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,$3,$4)', [id, org, `${id}@example.test`, role])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
  }
  await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'test-root','Synthetic')", [uuidv7(), org])
  const statusFile = join(directory, 'status.json'), configFile = join(directory, 'config.json')
  await writeFile(configFile, JSON.stringify({ intervalMs: 15_000, runtimeDirectory: runtime, sourceRoot: source, pcloudDatabasePath: sqlitePath,
    statusFile, topLevelFolderName: 'SyntheticCompany', policy: { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId: org,
      storageRootKey: 'test-root', actorUserId: admin, responsibleUserId: owner, expertUserId: expert, baselineSourceFolderIds: [],
      decision: 'Explicitly authorized automatic registration of new source IDs, with unknown types pending.' } }))
  const originalUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = database.url
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), 45_000)
  let first = true, setup, created = false
  try {
    await startAutomaticFolderDiscovery(configFile, { signal: abort.signal, onStatus: text => {
      const status = JSON.parse(text)
      if (first) {
        first = false
        setup = mkdir(join(source, '2026/EKİM 2026/34AUT123')).then(() => sqlite.exec("INSERT INTO folder VALUES(103,102,'34AUT123')"))
      }
      if (status.created === 1) { created = true; abort.abort() }
    } })
    await setup
    assert.equal(created, true)
    const status = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(status.status, 'PASS'); assert.equal(status.created, 1)
    const rows = (await pool.query('SELECT c.*,r.source_folder_id,l.relative_path FROM cases c JOIN case_folder_registrations r ON r.case_id=c.id JOIN case_locations l ON l.case_id=c.id')).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].case_type, null); assert.equal(rows[0].responsible_user_id, owner)
    assert.equal(rows[0].source_folder_id, '103'); assert.equal(rows[0].relative_path, '2026/EKİM 2026/34AUT123')
    assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE type='verify_case_location'")).rows[0].n, 1)
    await pool.query("UPDATE cases SET case_type='traffic',version=version+1 WHERE id=$1", [rows[0].id])
    const preserved = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows
    await startAutomaticFolderDiscovery(configFile, { once: true })
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows, preserved)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM folder').get().n, 4)
    const unavailableConfig = JSON.parse(await readFile(configFile, 'utf8'))
    unavailableConfig.sourceRoot = join(directory, 'unavailable-source')
    await writeFile(configFile, JSON.stringify(unavailableConfig))
    await assert.rejects(startAutomaticFolderDiscovery(configFile, { once: true }), error => error.cause?.code === 'ENOENT')
    const offline = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(offline.status, 'BLOCKED'); assert.equal(offline.code, 'ENOENT')
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows, preserved)
  } finally {
    clearTimeout(deadline); abort.abort(); sqlite.close(); await pool.end()
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl
  }
})
