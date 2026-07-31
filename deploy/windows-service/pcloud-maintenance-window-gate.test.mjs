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
  MINIMUM_QUIET_SECONDS,
  QuietWindowTracker,
  capturePcloudSnapshot,
  compareEntryMaps,
  compareObservations,
  enumerateSourceTree,
  hashSourceTree,
  loadGhostManifest,
  validateReportShape,
} from './pcloud-maintenance-window-gate.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function observation(capturedAtMs, diffCursorSha256, remoteEntries, sourceEntries) {
  return {
    capturedAtMs,
    pcloud: { diffCursorSha256, entries: remoteEntries },
    source: { entries: sourceEntries },
  }
}

test('create/modify/delete ve yalniz diff cursor ilerlemesini ayri sayar', () => {
  const previous = new Map([
    ['file:1', 'a'],
    ['file:2', 'b'],
    ['file:3', 'c'],
  ])
  const current = new Map([
    ['file:1', 'a'],
    ['file:2', 'changed'],
    ['file:4', 'd'],
  ])
  assert.deepEqual(compareEntryMaps(previous, current), {
    createCount: 1,
    modifyCount: 1,
    deleteCount: 1,
  })

  const delta = compareObservations(
    observation(0, digest('10'), previous, new Map()),
    observation(1, digest('11'), current, new Map()),
  )
  assert.equal(delta.movement, true)
  assert.equal(delta.diffCursorAdvanceCount, 1)
})

test('uzak hareket sessizlik suresini sifirlar ve 600 saniye dolmadan izin vermez', () => {
  const remote = new Map([['file:1', 'a']])
  const source = new Map([['doc.txt', 'a']])
  const tracker = new QuietWindowTracker(
    MINIMUM_QUIET_SECONDS * 1000,
    observation(0, digest('10'), remote, source),
  )

  assert.equal(tracker.isEligibleByTime(599_999), false)
  assert.equal(tracker.isEligibleByTime(600_000), true)

  const moved = observation(
    300_000,
    digest('11'),
    new Map([...remote, ['file:2', 'b']]),
    source,
  )
  const delta = tracker.observe(moved)
  assert.equal(delta.movement, true)
  assert.equal(tracker.windowResetCount, 1)
  assert.equal(tracker.activity.RemoteCreateCount, 1)
  assert.equal(tracker.activity.DiffCursorAdvanceCount, 1)
  assert.equal(tracker.isEligibleByTime(899_999), false)
  assert.equal(tracker.isEligibleByTime(900_000), true)
})

test('envanter degismese bile diff cursor ilerlemesi fail-closed reset uretir', () => {
  const remote = new Map([['file:1', 'same']])
  const source = new Map([['doc.txt', 'same']])
  const tracker = new QuietWindowTracker(
    MINIMUM_QUIET_SECONDS * 1000,
    observation(0, digest('20'), remote, source),
  )
  const delta = tracker.observe(observation(120_000, digest('21'), remote, source))

  assert.equal(delta.remote.createCount, 0)
  assert.equal(delta.remote.modifyCount, 0)
  assert.equal(delta.remote.deleteCount, 0)
  assert.equal(delta.diffCursorAdvanceCount, 1)
  assert.equal(delta.movement, true)
  assert.equal(tracker.quietSinceMs, 120_000)
})

test('snapshot ve tam hash kararsizligi da pencereyi fail-closed sifirlar', () => {
  const remote = new Map([['file:1', 'same']])
  const source = new Map([['doc.txt', 'same']])
  const tracker = new QuietWindowTracker(
    MINIMUM_QUIET_SECONDS * 1000,
    observation(0, digest('30'), remote, source),
  )

  const observationDelta = tracker.observe(
    observation(10_000, digest('30'), remote, source),
    { observationInstabilityCount: 1 },
  )
  assert.equal(observationDelta.movement, true)
  assert.equal(tracker.windowResetCount, 1)
  assert.equal(tracker.activity.ObservationInstabilityCount, 1)
  assert.equal(tracker.isEligibleByTime(609_999), false)

  tracker.recordMovement(20_000, {
    remote: { createCount: 0, modifyCount: 0, deleteCount: 0 },
    source: { createCount: 0, modifyCount: 0, deleteCount: 0 },
    diffCursorAdvanceCount: 0,
    observationInstabilityCount: 0,
    sourceHashInstabilityCount: 1,
    sourceInventoryInstabilityCount: 1,
    movement: true,
  })
  assert.equal(tracker.windowResetCount, 2)
  assert.equal(tracker.activity.SourceHashInstabilityCount, 1)
  assert.equal(tracker.activity.SourceInventoryInstabilityCount, 1)
  assert.equal(tracker.isEligibleByTime(619_999), false)
  assert.equal(tracker.isEligibleByTime(620_000), true)
})

test('PASS raporu baslangic ve son pCloud/source hashleri esit degilse reddedilir', () => {
  const source = {
    ObservedFileCount: 12,
    ObservedBytes: 9,
    ExcludedFileCount: 10,
    ExcludedBytes: 0,
    FileCount: 2,
    DirectoryCount: 1,
    Bytes: 9,
    MetadataSha256: digest('source-metadata'),
    ManifestSha256: digest('source-full'),
    HashedFileCount: 2,
    HashErrorCount: 0,
    SnapshotStable: true,
  }
  const pcloud = {
    DiffCursorSha256: digest('diff'),
    RootIdentitySha256: digest('root'),
    RunStatus: '1',
    PendingTaskCount: 0,
    SyncRecordCount: 0,
    FileCount: 12,
    DirectoryCount: 2,
    Bytes: 9,
    InventorySha256: digest('remote-inventory'),
  }
  const report = {
    SchemaVersion: 'pcloud-maintenance-window/1.0.0',
    Mode: 'gate',
    Status: 'pass',
    ReadOnly: true,
    EligibleForD8: true,
    MinimumQuietSeconds: 600,
    ObservedQuietSeconds: 600,
    GhostExclusion: {
      ManifestSha256: digest('ghost-manifest'),
      EntryCount: 10,
    },
    FinalWindow: {
      Baseline: {
        Source: { ...source },
        PCloud: { ...pcloud },
      },
      RemoteChanges: {
        CreateCount: 0,
        ModifyCount: 0,
        DeleteCount: 0,
        DiffCursorAdvanceCount: 0,
      },
      SourceChanges: { CreateCount: 0, ModifyCount: 0, DeleteCount: 0 },
      Source: { ...source },
      PCloud: { ...pcloud },
    },
    Blockers: [],
  }
  const ghost = { manifestSha256: digest('ghost-manifest') }

  assert.deepEqual(validateReportShape(report, ghost), { source, pcloud })
  report.FinalWindow.Baseline.PCloud.InventorySha256 = digest('tampered')
  assert.throws(
    () => validateReportShape(report, ghost),
    /MAINTENANCE_WINDOW_PCLOUD_BASELINE_MISMATCH/,
  )
})

test('sentetik kaynak ve WAL dahil pCloud snapshot ayni exact ghost kokunu izler', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-maintenance-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  await mkdir(ghostDirectory, { recursive: true })
  await mkdir(path.join(sourceRoot, 'alt'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'belge.txt'), 'alpha')
  await writeFile(path.join(sourceRoot, 'alt', 'ikinci.txt'), 'beta')

  const entries = []
  for (let index = 1; index <= 10; index += 1) {
    const name = `ghost-${String(index).padStart(2, '0')}.tmp`
    const relativePath = path.win32.join('ghost', name)
    await writeFile(path.join(ghostDirectory, name), '')
    entries.push({
      itemId: `F${String(index).padStart(2, '0')}`,
      absolutePath: path.win32.join(sourceRoot, relativePath),
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
      localClassification: 'stale_temp_candidate',
      serverStatus: 'MISSING',
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
  const ghost = await loadGhostManifest(manifestPath, manifestHash, sourceRoot)

  const databasePath = path.join(temporaryRoot, 'data.db')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE folder (
      id INTEGER PRIMARY KEY,
      parentfolderid INTEGER NOT NULL,
      name TEXT NOT NULL,
      flags INTEGER NOT NULL,
      ctime INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      subdircnt INTEGER NOT NULL
    );
    CREATE TABLE file (
      id INTEGER PRIMARY KEY,
      parentfolderid INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      hash INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      ctime INTEGER NOT NULL,
      mtime INTEGER NOT NULL
    );
    CREATE TABLE task (id INTEGER);
    CREATE TABLE fstask (id INTEGER);
    CREATE TABLE upload_tasks (id INTEGER);
    CREATE TABLE localfileupload (id INTEGER);
    CREATE TABLE uptask_fileupload (id INTEGER);
    CREATE TABLE pagecachetask (id INTEGER);
    CREATE TABLE syncfolder (id INTEGER);
    CREATE TABLE syncfolderdelayed (id INTEGER);
    INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
    INSERT INTO folder VALUES (102, 100, 'alt', 0, 1, 1, 0);
    INSERT INTO file VALUES (2001, 100, 'belge.txt', 5, 3001, 0, 1, 1);
    INSERT INTO file VALUES (2002, 102, 'ikinci.txt', 4, 3002, 0, 1, 1);
  `)
  const insertGhost = database.prepare(`
    INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime)
    VALUES (?, 101, ?, 0, ?, 1, ?, ?)
  `)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    insertGhost.run(
      Number(entry.fileId),
      entry.expectedMetadata.name,
      Number(entry.expectedMetadata.hash),
      entry.expectedMetadata.ctimeRaw,
      entry.expectedMetadata.mtimeRaw,
    )
  }
  database.close()

  const source = await enumerateSourceTree(sourceRoot, ghost.excludedPaths)
  assert.equal(source.observedFileCount, 12)
  assert.equal(source.excludedFileCount, 10)
  assert.equal(source.fileCount, 2)
  const fullHash = await hashSourceTree(sourceRoot, ghost.excludedPaths, 0)
  assert.equal(fullHash.hashedFileCount, 2)
  assert.equal(fullHash.hashErrorCount, 0)
  assert.match(fullHash.manifestSha256, /^[a-f0-9]{64}$/)

  const firstPcloud = await capturePcloudSnapshot(databasePath, ghost)
  assert.equal(firstPcloud.runStatus, '1')
  assert.equal(firstPcloud.pendingTaskCount, 0)
  assert.equal(firstPcloud.syncRecordCount, 0)
  assert.equal(firstPcloud.fileCount, 12)
  assert.equal(firstPcloud.directoryCount, 2)

  const changedDatabase = new DatabaseSync(databasePath)
  changedDatabase.exec(`
    UPDATE setting SET value = '101' WHERE id = 'diffid';
    INSERT INTO file VALUES (2003, 100, 'yeni.txt', 3, 3003, 0, 2, 2);
  `)
  changedDatabase.close()
  const secondPcloud = await capturePcloudSnapshot(databasePath, ghost)
  const remoteDelta = compareEntryMaps(firstPcloud.entries, secondPcloud.entries)
  assert.deepEqual(remoteDelta, { createCount: 1, modifyCount: 0, deleteCount: 0 })
  assert.notEqual(firstPcloud.diffCursorSha256, secondPcloud.diffCursorSha256)
})

test('CLI 600 saniyenin altinda test bypass kabul etmez', () => {
  const scriptPath = fileURLToPath(new URL('./pcloud-maintenance-window-gate.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--mode', 'gate',
    '--source-root', 'X:\\sentetik',
    '--ghost-manifest', 'sentetik.json',
    '--ghost-manifest-sha256', '0'.repeat(64),
    '--pcloud-db', 'data.db',
    '--maximum-seconds', '599',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.EligibleForD8, false)
  assert.equal(output.ErrorCode, 'MAXIMUM_SECONDS_INVALID')
})
