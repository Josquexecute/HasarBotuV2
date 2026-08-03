import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildDiffForensicsReport, classifyCurrency, classifyEntry } from './pcloud-post-sync-diff-forensics.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function buildFixture(context) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-diff-forensics-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const targetRoot = path.join(temporaryRoot, 'HEDEF')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  await mkdir(ghostDirectory, { recursive: true })
  await mkdir(targetRoot, { recursive: true })

  // identical.txt: byte-identical in both trees (must never appear as a diff entry).
  // Real synced copies preserve the remote mtime, so pin both explicitly —
  // otherwise two sequential writeFile calls get distinct mtimes and the
  // fixture would (incorrectly) simulate a metadata-only drift instead.
  const identicalMtime = new Date('2026-07-01T00:00:00.000Z')
  await writeFile(path.join(sourceRoot, 'identical.txt'), 'ayni-icerik')
  await utimes(path.join(sourceRoot, 'identical.txt'), identicalMtime, identicalMtime)
  await writeFile(path.join(targetRoot, 'identical.txt'), 'ayni-icerik')
  await utimes(path.join(targetRoot, 'identical.txt'), identicalMtime, identicalMtime)

  // stale.jpg: source holds the current (newer, smaller) content; target
  // still holds an older, superseded copy — mirrors the real HB-2026-130
  // shape (content_mismatch, source current, target stale).
  const staleSourceBytes = 'kucuk-guncel-icerik'
  const staleTargetBytes = 'cok-daha-buyuk-eski-icerik-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  await writeFile(path.join(sourceRoot, 'stale.jpg'), staleSourceBytes)
  await writeFile(path.join(targetRoot, 'stale.jpg'), staleTargetBytes)
  const sourceMtime = new Date('2026-08-01T10:00:00.000Z')
  await utimes(path.join(sourceRoot, 'stale.jpg'), sourceMtime, sourceMtime)

  // onlysource.txt: uploaded to pCloud but never downloaded to target yet.
  await writeFile(path.join(sourceRoot, 'onlysource.txt'), 'sadece-kaynak')

  // onlytarget.txt: exists locally in target with no source counterpart.
  await writeFile(path.join(targetRoot, 'onlytarget.txt'), 'sadece-hedef')

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
    CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE task (id INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER);
    CREATE TABLE fstask (id INTEGER, fileid INTEGER);
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
    INSERT INTO file VALUES (2001, 100, 'identical.txt', 11, 3001, 0, 1, 1);
  `)
  const staleSourceMtimeSeconds = Math.floor(sourceMtime.getTime() / 1000)
  database.exec(`
    INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime)
    VALUES (2002, 100, 'stale.jpg', ${staleSourceBytes.length}, 3002, 0, 1, ${staleSourceMtimeSeconds});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2002, 3099, 0, ${staleTargetBytes.length});
    INSERT INTO file VALUES (2003, 100, 'onlysource.txt', 13, 3003, 0, 1, 1);
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

test('classifyEntry: kaynak+hedef sha256 esitse identical doner', () => {
  const entry = { sha256: 'a', size: 1, mtimeNs: '1' }
  assert.equal(classifyEntry(entry, entry), 'identical')
})

test('classifyEntry: hash farkliysa content_mismatch, sadece kaynaktaysa missing, sadece hedefteyse extra', () => {
  const left = { sha256: 'a', size: 1, mtimeNs: '1' }
  const right = { sha256: 'b', size: 1, mtimeNs: '1' }
  assert.equal(classifyEntry(left, right), 'content_mismatch')
  assert.equal(classifyEntry(left, null), 'missing')
  assert.equal(classifyEntry(null, right), 'extra')
})

test('classifyCurrency: pcloud current satiri kaynakla, en eski revision hedefle eslesirse source_current_target_superseded doner', () => {
  const sourceEntry = { size: 100, mtimeNs: '1754049600000000000' }
  const targetEntry = { size: 999 }
  const pcloudState = {
    found: true,
    currentRow: { size: 100, mtime: 1754049600 },
    revisions: [{ size: 999 }],
  }
  assert.equal(classifyCurrency('content_mismatch', sourceEntry, targetEntry, pcloudState), 'source_current_target_superseded')
})

test('buildDiffForensicsReport: gercek karisik fixture (identical/missing/extra/content_mismatch) dogru siniflandirilir', async (context) => {
  const fixture = await buildFixture(context)
  const report = await buildDiffForensicsReport({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    progressInterval: 0,
  })

  assert.equal(report.SchemaVersion, 'pcloud-post-sync-diff-forensics/1.0.0')
  assert.equal(report.ReadOnly, true)
  assert.equal(report.Summary.Counts.identical, 1)
  assert.equal(report.Summary.Counts.missing, 1)
  assert.equal(report.Summary.Counts.extra, 1)
  assert.equal(report.Summary.Counts.content_mismatch, 1)
  assert.equal(report.Summary.Counts.metadata_only, 0)

  const byRelativePath = new Map(report.Entries.map((entry) => [entry.RelativePath, entry]))
  assert.equal(byRelativePath.has('identical.txt'), false)

  const missing = byRelativePath.get('onlysource.txt')
  assert.equal(missing.Classification, 'missing')
  assert.equal(missing.Currency, 'source_only_target_missing')
  assert.equal(missing.Target, null)

  const extra = byRelativePath.get('onlytarget.txt')
  assert.equal(extra.Classification, 'extra')
  assert.equal(extra.Currency, 'target_only_no_source_counterpart')
  assert.equal(extra.Source, null)

  const staleEntry = byRelativePath.get('stale.jpg')
  assert.equal(staleEntry.Classification, 'content_mismatch')
  assert.equal(staleEntry.Currency, 'source_current_target_superseded')
  assert.equal(staleEntry.FileExtension, '.jpg')
  assert.equal(staleEntry.PCloud.FileId, '2002')
  assert.equal(staleEntry.PCloud.TaskReferenceCount, 0)
  assert.equal(staleEntry.Source.NotLockedForWrite, true)
  assert.equal(staleEntry.Target.NotLockedForWrite, true)

  assert.deepEqual(report.ConflictNamesFound, [])
  assert.equal(report.PCloudQueueState.pendingTaskCount, 0)
})

test('buildDiffForensicsReport: pending task fileid referans ederse TaskReferenceCount sifir olmaz', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('INSERT INTO fstask (id, fileid) VALUES (1, 2002);')
  database.close()

  const report = await buildDiffForensicsReport({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    progressInterval: 0,
  })
  const staleEntry = report.Entries.find((entry) => entry.RelativePath === 'stale.jpg')
  assert.equal(staleEntry.PCloud.TaskReferenceCount, 1)
})

test('CLI: farklar bulununca cikis kodu 2, sifir fark oldugunda 0 doner', async (context) => {
  const fixture = await buildFixture(context)
  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-diff-forensics.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Summary.Counts.content_mismatch, 1)

  // Remove the two asymmetric files and make stale.jpg byte-identical so a
  // second run reports zero differences (exit code 0).
  await rm(path.join(fixture.sourceRoot, 'onlysource.txt'))
  await rm(path.join(fixture.targetRoot, 'onlytarget.txt'))
  await writeFile(path.join(fixture.targetRoot, 'stale.jpg'), 'kucuk-guncel-icerik')
  const sourceStaleMtime = new Date('2026-08-01T10:00:00.000Z')
  await utimes(path.join(fixture.targetRoot, 'stale.jpg'), sourceStaleMtime, sourceStaleMtime)

  const secondResult = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', fixture.manifestHash,
    '--pcloud-db', fixture.databasePath,
    '--progress-interval', '0',
  ], { encoding: 'utf8' })
  assert.equal(secondResult.status, 0)
  const secondOutput = JSON.parse(secondResult.stdout)
  assert.equal(secondOutput.Summary.Counts.content_mismatch, 0)
  assert.equal(secondOutput.Summary.Counts.missing, 0)
  assert.equal(secondOutput.Summary.Counts.extra, 0)
})

test('CLI: manifest hash mismatch GHOST_EXCLUSION_HASH_MISMATCH ile ERROR doner', async (context) => {
  const fixture = await buildFixture(context)
  const scriptPath = fileURLToPath(new URL('./pcloud-post-sync-diff-forensics.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', fixture.sourceRoot,
    '--target-root', fixture.targetRoot,
    '--ghost-manifest', fixture.manifestPath,
    '--ghost-manifest-sha256', '0'.repeat(64),
    '--pcloud-db', fixture.databasePath,
    '--progress-interval', '0',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.ErrorCode, 'GHOST_EXCLUSION_HASH_MISMATCH')
})
