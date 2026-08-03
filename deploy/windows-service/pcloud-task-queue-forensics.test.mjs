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
import {
  classifyWindow,
  resolveFileRelativePath,
  resolveFolderRelativePath,
  resolveItemRelativePath,
  runTaskQueueForensics,
} from './pcloud-task-queue-forensics.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function buildFixture(context) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-queue-forensics-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  const caseDirectory = path.join(sourceRoot, 'DAVA')
  await mkdir(ghostDirectory, { recursive: true })
  await mkdir(caseDirectory, { recursive: true })
  await writeFile(path.join(caseDirectory, 'belge.txt'), 'alpha')

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
    CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
    CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
    CREATE TABLE task (id INTEGER PRIMARY KEY, type INTEGER, syncid INTEGER, newsyncid INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER, inprogress INTEGER, name TEXT);
    CREATE TABLE fstask (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, folderid INTEGER, sfolderid INTEGER, fileid INTEGER, text1 TEXT, text2 TEXT, int1 INTEGER, int2 INTEGER);
    CREATE TABLE upload_tasks (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, level INTEGER, parentfid INTEGER, fname TEXT, fpath TEXT, size INTEGER, checksum TEXT, error_code INTEGER);
    INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
    INSERT INTO folder VALUES (200, 100, 'DAVA', 0, 1, 1, 1);
    INSERT INTO file VALUES (5001, 200, 'belge.txt', 5, 3001, 0, 1, 1);
  `)
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

  return { sourceRoot, manifestPath, manifestHash, databasePath, temporaryRoot }
}

test('resolveFileRelativePath: bilinen dosya icin kok goreli yolu dogru cozer', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath, { readOnly: true })
  const relativePath = resolveFileRelativePath(database, '100', '5001')
  assert.equal(relativePath, 'DAVA\\belge.txt')
  database.close()
})

test('resolveFolderRelativePath: alt klasor icin dogru yolu cozer, kokun kendisi icin bos string doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath, { readOnly: true })
  assert.equal(resolveFolderRelativePath(database, '100', '200'), 'DAVA')
  assert.equal(resolveFolderRelativePath(database, '100', '100'), '')
  database.close()
})

test('resolveItemRelativePath: once dosya tablosuna bakar, bulamazsa klasore duser, hicbiri yoksa null doner', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath, { readOnly: true })
  assert.deepEqual(resolveItemRelativePath(database, '100', '5001'), { kind: 'file', relativePath: 'DAVA\\belge.txt' })
  assert.deepEqual(resolveItemRelativePath(database, '100', '200'), { kind: 'folder', relativePath: 'DAVA' })
  assert.equal(resolveItemRelativePath(database, '100', '999999'), null)
  database.close()
})

test('classifyWindow: sifir kuyruk girisi unknown/NO_QUEUE_ACTIVITY_OBSERVED doner', () => {
  const result = classifyWindow({ tracker: new Map(), totalSamples: 10, remoteChanged: false, sourceChanged: false, sourceStable: true })
  assert.equal(result.classification, 'unknown')
  assert.equal(result.reason, 'NO_QUEUE_ACTIVITY_OBSERVED')
})

test('classifyWindow: ayni giris cogunluk boyunca kalirsa recurring_retry doner', () => {
  const tracker = new Map([
    ['task:1', { appearanceCount: 8, firstSeenSampleIndex: 0, lastSeenSampleIndex: 9, table: 'task' }],
  ])
  const result = classifyWindow({ tracker, totalSamples: 10, remoteChanged: false, sourceChanged: false, sourceStable: true })
  assert.equal(result.classification, 'recurring_retry')
})

test('classifyWindow: upload_tasks error_code sifir-disi ise recurring_retry doner (kisa omurlu olsa bile)', () => {
  const tracker = new Map([
    ['upload_tasks:1', { appearanceCount: 1, firstSeenSampleIndex: 0, lastSeenSampleIndex: 0, table: 'upload_tasks', errorCodesSeen: [5] }],
  ])
  const result = classifyWindow({ tracker, totalSamples: 10, remoteChanged: false, sourceChanged: false, sourceStable: true })
  assert.equal(result.classification, 'recurring_retry')
  assert.equal(result.reason, 'UPLOAD_TASK_ERROR_CODE_NONZERO_OBSERVED')
})

test('classifyWindow: girisler akip gidiyor ve yerel kaynak da gercekten degistiyse genuine_transfer doner', () => {
  const tracker = new Map([
    ['upload_tasks:1', { appearanceCount: 2, firstSeenSampleIndex: 0, lastSeenSampleIndex: 2, table: 'upload_tasks', errorCodesSeen: [] }],
  ])
  const result = classifyWindow({ tracker, totalSamples: 10, remoteChanged: false, sourceChanged: true, sourceStable: false })
  assert.equal(result.classification, 'genuine_transfer')
})

test('classifyWindow: uzak envanter degisti ama yerel kaynak sabit kaldiysa remote_writer doner', () => {
  const tracker = new Map([
    ['fstask:1', { appearanceCount: 1, firstSeenSampleIndex: 0, lastSeenSampleIndex: 2, table: 'fstask', errorCodesSeen: [] }],
  ])
  const result = classifyWindow({ tracker, totalSamples: 10, remoteChanged: true, sourceChanged: false, sourceStable: true })
  assert.equal(result.classification, 'remote_writer')
})

test('classifyWindow: girisler akip gidiyor ama gercek icerik degisimi yoksa metadata_churn doner', () => {
  const tracker = new Map([
    ['fstask:1', { appearanceCount: 1, firstSeenSampleIndex: 0, lastSeenSampleIndex: 2, table: 'fstask', errorCodesSeen: [] }],
  ])
  const result = classifyWindow({ tracker, totalSamples: 10, remoteChanged: false, sourceChanged: false, sourceStable: true })
  assert.equal(result.classification, 'metadata_churn')
})

test('runTaskQueueForensics: gercek karisik queue fixture (task/fstask/upload_tasks) dogru yakalanir ve yollar cozulur', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`
    INSERT INTO task (id, type, syncid, newsyncid, itemid, localitemid, newitemid, inprogress, name)
      VALUES (1, 7, 1, 1, 5001, 5001, 5001, 1, 'belge.txt');
    INSERT INTO upload_tasks (id, type, status, level, parentfid, fname, fpath, size, checksum, error_code)
      VALUES (1, 1, 1, 0, 200, 'belge.txt', 'DAVA\\belge.txt', 5, 'abc', 0);
  `)
  database.close()

  const report = await runTaskQueueForensics({
    sourceRoot: fixture.sourceRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    durationSeconds: 2,
    sampleIntervalSeconds: 1,
  })

  assert.equal(report.SchemaVersion, 'pcloud-task-queue-forensics/1.0.0')
  assert.equal(report.ReadOnly, true)
  assert.ok(report.SampleCount >= 2)
  assert.equal(report.DistinctQueueEntryCount, 2)
  const taskEntry = report.Entries.find((entry) => entry.Table === 'task')
  assert.equal(taskEntry.ResolvedRelativePath, 'DAVA\\belge.txt')
  assert.equal(taskEntry.ResolvedKind, 'file')
  assert.deepEqual(taskEntry.TypesSeenRaw, [7])
  const uploadEntry = report.Entries.find((entry) => entry.Table === 'upload_tasks')
  assert.equal(uploadEntry.ResolvedRelativePath, 'DAVA')
  assert.ok(uploadEntry.ErrorCodesSeen.every((code) => code === 0))
})

test('CLI: 60 saniyenin altinda duration ARGUMENT hatasi doner', async (context) => {
  const fixture = await buildFixture(context)
  const scriptPath = fileURLToPath(new URL('./pcloud-task-queue-forensics.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', fixture.sourceRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--duration-seconds', '10',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.ErrorCode, 'DURATION_SECONDS_OUT_OF_RANGE')
})
