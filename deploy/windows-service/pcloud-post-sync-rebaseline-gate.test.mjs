import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadExpectedRootId } from './pcloud-post-sync-rebaseline-gate.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function buildFixture(context) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-rebaseline-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const targetRoot = path.join(temporaryRoot, 'HEDEF')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  await mkdir(ghostDirectory, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  await writeFile(path.join(sourceRoot, 'belge.txt'), 'alpha')
  await writeFile(path.join(targetRoot, 'belge.txt'), 'alpha')

  const entries = []
  for (let index = 1; index <= 10; index += 1) {
    const name = `ghost-${String(index).padStart(2, '0')}.tmp`
    const relativePath = path.win32.join('ghost', name)
    await writeFile(path.join(ghostDirectory, name), '')
    entries.push({
      relativePath,
      fileId: String(1000 + index),
      parentFolderId: '101',
      expectedMetadata: {
        name,
        sizeBytes: 0,
        hash: String(2000 + index),
        flags: 1,
        ctimeRaw: 10 + index,
        mtimeRaw: 20 + index,
      },
    })
  }
  const manifest = {
    schemaVersion: 'storage-ghost-exclusion/1.0.0',
    readOnly: true,
    sourceRoot,
    entryCount: 10,
    policy: {
      matchMode: 'exact_windows_path_and_pcloud_file_id',
      wildcardsAllowed: false,
      extensionRulesAllowed: false,
      folderRulesAllowed: false,
    },
    entries,
  }
  const manifestPath = path.join(temporaryRoot, 'ghost-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const manifestHash = digest(await readFile(manifestPath))

  const databasePath = path.join(temporaryRoot, 'data.db')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE folder (
      id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL,
      flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL
    );
    CREATE TABLE file (
      id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL,
      size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL,
      ctime INTEGER NOT NULL, mtime INTEGER NOT NULL
    );
    CREATE TABLE task (id INTEGER);
    CREATE TABLE fstask (id INTEGER);
    CREATE TABLE upload_tasks (id INTEGER);
    CREATE TABLE localfileupload (id INTEGER);
    CREATE TABLE uptask_fileupload (id INTEGER);
    CREATE TABLE pagecachetask (id INTEGER);
    CREATE TABLE localfolder (id INTEGER, taskcnt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE syncfolder (id INTEGER, folderid INTEGER, localpath TEXT);
    CREATE TABLE syncfolderdelayed (id INTEGER);
    INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
    INSERT INTO file VALUES (2001, 100, 'belge.txt', 5, 3001, 0, 1, 1);
    INSERT INTO syncfolder (id, folderid, localpath) VALUES (1, 100, ?);
  `.replace('?', `'${targetRoot.replace(/'/g, "''")}'`))
  const insertGhost = database.prepare(`
    INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime)
    VALUES (?, 101, ?, 0, ?, 1, ?, ?)
  `)
  for (const entry of entries) {
    insertGhost.run(
      Number(entry.fileId),
      entry.expectedMetadata.name,
      Number(entry.expectedMetadata.hash),
      entry.expectedMetadata.ctimeRaw,
      entry.expectedMetadata.mtimeRaw,
    )
  }
  database.close()

  return { sourceRoot, targetRoot, manifestPath, manifestHash, databasePath, temporaryRoot }
}

test('loadExpectedRootId ghost manifestindeki kok klasoru dogru cozer', async (context) => {
  const fixture = await buildFixture(context)
  const { rootId } = await loadExpectedRootId(
    fixture.manifestPath,
    fixture.manifestHash,
    fixture.sourceRoot,
    fixture.databasePath,
  )
  assert.equal(rootId, '100')
})

test('CLI: aktif sync eslemesi olmadan REBASELINE_PRECONDITION_FAILED ile BLOCKED doner (syncfolder bos)', async (context) => {
  const fixture = await buildFixture(context)
  const emptyDb = path.join(fixture.temporaryRoot, 'empty-sync.db')
  const database = new DatabaseSync(fixture.databasePath)
  const backup = database.exec(`DELETE FROM syncfolder;`)
  database.close()

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--poll-seconds', '1',
    '--maximum-seconds', '600',
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'blocked')
  assert.deepEqual(output.Blockers, ['SYNC_MAPPING_ROW_COUNT_INVALID'])
  // HB-2026-130 follow-up: a hard block reached before any finalObservation
  // must still carry these two fields so a PowerShell consumer running
  // under Set-StrictMode never throws PropertyNotFoundException reading
  // them unconditionally (real incident: the wrapper crashed on exactly
  // this report shape).
  assert.equal(output.EligibleForRebaseline, false)
  assert.equal(output.SourceTargetHashMatch, false)
})

test('CLI: pCloud localfolder.taskcnt toplami gecici olarak negatifse cokmez, PCLOUD_LOCALFOLDER_TASKS_FOUND ile temiz BLOCKED doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('INSERT INTO localfolder (id, taskcnt) VALUES (1, -2);')
  database.close()

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'probe',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
  ], { encoding: 'utf8' })

  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.ErrorCode, 'PCLOUD_LOCALFOLDER_TASKS_FOUND')
})

test('CLI: hedef yerel yolu beklenenle uyusmuyorsa SYNC_MAPPING_TARGET_MISMATCH ile BLOCKED doner', async (context) => {
  const fixture = await buildFixture(context)
  const otherTarget = path.join(fixture.temporaryRoot, 'BASKA_HEDEF')
  await mkdir(otherTarget, { recursive: true })

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', fixture.sourceRoot,
    '--target-root', otherTarget,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--poll-seconds', '1',
    '--maximum-seconds', '600',
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'blocked')
  assert.deepEqual(output.Blockers, ['SYNC_MAPPING_TARGET_MISMATCH'])
})

test('CLI: bekleyen task varsa PCLOUD_PENDING_TASKS_FOUND ile BLOCKED doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('INSERT INTO task (id) VALUES (1);')
  database.close()

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--poll-seconds', '1',
    '--maximum-seconds', '600',
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'blocked')
  assert.deepEqual(output.Blockers, ['PCLOUD_PENDING_TASKS_FOUND'])
})

test('CLI: delayed sync ogesi varsa SYNC_MAPPING_DELAYED_ITEMS_PRESENT ile BLOCKED doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('INSERT INTO syncfolderdelayed (id) VALUES (1);')
  database.close()

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--poll-seconds', '1',
    '--maximum-seconds', '600',
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'blocked')
  assert.deepEqual(output.Blockers, ['SYNC_MAPPING_DELAYED_ITEMS_PRESENT'])
})

test('CLI: conflict adi deseni varsa PCLOUD_CONFLICT_NAME_PATTERN_DETECTED ile BLOCKED doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`
    INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime)
    VALUES (3001, 100, 'belge (conflicted copy 2026-08-03).txt', 5, 9999, 0, 1, 1);
  `)
  database.close()

  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--poll-seconds', '1',
    '--maximum-seconds', '600',
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'blocked')
  assert.deepEqual(output.Blockers, ['PCLOUD_CONFLICT_NAME_PATTERN_DETECTED'])
})

test('CLI: 600 saniyenin altinda test bypass kabul etmez', () => {
  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', 'X:\\sentetik-kaynak',
    '--target-root', 'X:\\sentetik-hedef',
    '--ghost-manifest', 'sentetik.json',
    '--ghost-manifest-sha256', '0'.repeat(64),
    '--pcloud-db', 'data.db',
    '--maximum-seconds', '599',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.EligibleForRebaseline, false)
  assert.equal(output.ErrorCode, 'MAXIMUM_SECONDS_INVALID')
})

test('ProbeOnly modu her zaman PROBE_ONLY_NOT_REBASELINE_GATE ile bloklu doner', async (context) => {
  const fixture = await buildFixture(context)
  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-rebaseline-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'probe',
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Mode, 'probe')
  assert.equal(output.Status, 'blocked')
  assert.equal(output.EligibleForRebaseline, false)
  assert.deepEqual(output.Blockers, ['PROBE_ONLY_NOT_REBASELINE_GATE'])
})
