import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { getStaleTargetFileState } from './pcloud-stale-target-file-state.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function buildFixture(context) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-stalefile-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  await mkdir(ghostDirectory, { recursive: true })
  await mkdir(path.join(sourceRoot, 'DAVA', 'HASAR'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'DAVA', 'HASAR', 'foto.jpeg'), 'kucuk')

  const entries = []
  for (let index = 1; index <= 10; index += 1) {
    const name = `ghost-${String(index).padStart(2, '0')}.tmp`
    await writeFile(path.join(ghostDirectory, name), '')
    entries.push({
      relativePath: path.win32.join('ghost', name),
      fileId: String(1000 + index),
      parentFolderId: '101',
      expectedMetadata: { name, sizeBytes: 0, hash: String(2000 + index), flags: 1, ctimeRaw: 10 + index, mtimeRaw: 20 + index },
    })
  }
  const manifest = {
    schemaVersion: 'storage-ghost-exclusion/1.0.0',
    readOnly: true,
    sourceRoot,
    entryCount: 10,
    policy: { matchMode: 'exact_windows_path_and_pcloud_file_id', wildcardsAllowed: false, extensionRulesAllowed: false, folderRulesAllowed: false },
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
    CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
    CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
    CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE task (id INTEGER PRIMARY KEY, type INTEGER, syncid INTEGER, newsyncid INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER, inprogress INTEGER, name TEXT);
    CREATE TABLE fstask (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, folderid INTEGER, sfolderid INTEGER, fileid INTEGER, text1 TEXT, text2 TEXT, int1 INTEGER, int2 INTEGER);
    INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
    INSERT INTO folder VALUES (200, 100, 'DAVA', 0, 1, 1, 1);
    INSERT INTO folder VALUES (201, 200, 'HASAR', 0, 1, 1, 0);
    INSERT INTO file VALUES (5001, 201, 'foto.jpeg', 5, 999, 0, 1785574249, 1785748920);
    INSERT INTO filerevision VALUES (5001, 888, 1785574249, 500000);
    INSERT INTO filerevision VALUES (5001, 999, 1785748920, 5);
  `)
  const insertGhost = database.prepare('INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime) VALUES (?, 101, ?, 0, ?, 1, ?, ?)')
  for (const entry of entries) {
    insertGhost.run(Number(entry.fileId), entry.expectedMetadata.name, Number(entry.expectedMetadata.hash), entry.expectedMetadata.ctimeRaw, entry.expectedMetadata.mtimeRaw)
  }
  database.close()

  return { sourceRoot, manifestPath, manifestHash, databasePath, temporaryRoot }
}

test('getStaleTargetFileState: bilinen dosya icin current row + revision history + sifir task referansi', async (context) => {
  const fixture = await buildFixture(context)
  const state = await getStaleTargetFileState({
    sourceRoot: fixture.sourceRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    relativePath: 'DAVA\\HASAR\\foto.jpeg',
  })
  assert.equal(state.found, true)
  assert.equal(state.fileId, '5001')
  assert.equal(state.currentRow.size, 5)
  assert.equal(state.currentRow.mtime, 1785748920)
  assert.equal(state.revisions.length, 2)
  assert.equal(state.revisions[0].size, 500000)
  assert.equal(state.revisions[1].size, 5)
  assert.equal(state.taskReferenceCount, 0)
})

test('getStaleTargetFileState: task tablosunda referans varsa taskReferenceCount > 0', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('INSERT INTO task (id, itemid) VALUES (1, 5001);')
  database.close()

  const state = await getStaleTargetFileState({
    sourceRoot: fixture.sourceRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    relativePath: 'DAVA\\HASAR\\foto.jpeg',
  })
  assert.equal(state.taskReferenceCount, 1)
})

test('getStaleTargetFileState: olmayan dosya icin found=false doner', async (context) => {
  const fixture = await buildFixture(context)
  const state = await getStaleTargetFileState({
    sourceRoot: fixture.sourceRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    relativePath: 'DAVA\\HASAR\\olmayan.jpeg',
  })
  assert.equal(state.found, false)
})

test('getStaleTargetFileState: olmayan klasor icin found=false doner', async (context) => {
  const fixture = await buildFixture(context)
  const state = await getStaleTargetFileState({
    sourceRoot: fixture.sourceRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    relativePath: 'OLMAYAN\\HASAR\\foto.jpeg',
  })
  assert.equal(state.found, false)
})
