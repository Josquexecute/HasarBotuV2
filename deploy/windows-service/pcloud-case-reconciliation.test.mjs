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
import { reconcileCase } from './pcloud-case-reconciliation.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

// Builds a source/target tree with ONE case folder (2026\<caseId>) plus a
// deliberate OUT-OF-CASE difference (to prove per-case isolation on every
// scenario, not just once) and a ghost-exclusion set (required by the
// underlying diff-forensics schema). `fileSpecs` describes what to put
// under the case folder; `dbExtra` is raw SQL appended after the base
// schema+rows for scenario-specific file/filerevision/fstask rows.
async function buildFixture(context, caseId, fileSpecs, dbExtra) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-case-reconciliation-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const sourceRoot = path.join(temporaryRoot, 'KAYNAK')
  const targetRoot = path.join(temporaryRoot, 'HEDEF')
  const ghostDirectory = path.join(sourceRoot, 'ghost')
  const caseRelativePath = path.win32.join('2026', caseId)
  await mkdir(path.join(sourceRoot, '2026', caseId), { recursive: true })
  await mkdir(path.join(targetRoot, '2026', caseId), { recursive: true })
  await mkdir(ghostDirectory, { recursive: true })

  // Deliberate out-of-case difference: must never leak into a scoped result.
  await writeFile(path.join(sourceRoot, 'baska-vaka-kaynak.txt'), 'disaridaki-kaynak')
  await writeFile(path.join(targetRoot, 'baska-vaka-hedef.txt'), 'disaridaki-hedef')

  for (const spec of fileSpecs) {
    if (spec.sourceContent !== undefined && spec.sourceContent !== null) {
      const sourcePath = path.join(sourceRoot, '2026', caseId, spec.name)
      await writeFile(sourcePath, spec.sourceContent)
      if (spec.sourceMtime) await utimes(sourcePath, spec.sourceMtime, spec.sourceMtime)
    }
    if (spec.targetContent !== undefined && spec.targetContent !== null) {
      const targetPath = path.join(targetRoot, '2026', caseId, spec.name)
      await writeFile(targetPath, spec.targetContent)
      if (spec.targetMtime) await utimes(targetPath, spec.targetMtime, spec.targetMtime)
    }
  }

  const ghostEntries = []
  for (let index = 1; index <= 10; index += 1) {
    const name = `ghost-${String(index).padStart(2, '0')}.tmp`
    await writeFile(path.join(ghostDirectory, name), '')
    ghostEntries.push({
      relativePath: path.win32.join('ghost', name),
      fileId: String(1000 + index),
      parentFolderId: '101',
      expectedMetadata: { name, sizeBytes: 0, hash: String(2100 + index), flags: 1, ctimeRaw: 10 + index, mtimeRaw: 20 + index },
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
    entries: ghostEntries,
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
    INSERT INTO folder VALUES (105, 100, '2026', 0, 1, 1, 1);
    INSERT INTO folder VALUES (106, 105, '${caseId}', 0, 1, 1, 0);
    INSERT INTO syncfolder (id, folderid, localpath) VALUES (1, 100, ?);
  `.replace('?', `'${targetRoot.replace(/'/g, "''")}'`))
  const insertGhost = database.prepare(`
    INSERT INTO file (id, parentfolderid, name, size, hash, flags, ctime, mtime)
    VALUES (?, 101, ?, 0, ?, 1, ?, ?)
  `)
  for (const entry of ghostEntries) {
    insertGhost.run(
      Number(entry.fileId),
      entry.expectedMetadata.name,
      Number(entry.expectedMetadata.hash),
      entry.expectedMetadata.ctimeRaw,
      entry.expectedMetadata.mtimeRaw,
    )
  }
  if (dbExtra) database.exec(dbExtra)
  database.close()

  return { sourceRoot, targetRoot, manifestPath, manifestHash, databasePath, caseRelativePath }
}

test('reconcileCase: fark yoksa ready doner, disaridaki fark hicbir etki yapmaz', async (context) => {
  const identicalMtime = new Date('2026-07-01T00:00:00.000Z')
  const fixture = await buildFixture(context, '11AAA111', [
    { name: 'ayni.txt', sourceContent: 'ayni-icerik', targetContent: 'ayni-icerik', sourceMtime: identicalMtime, targetMtime: identicalMtime },
  ], `INSERT INTO file VALUES (2001, 106, 'ayni.txt', 11, 3001, 0, 1, ${Math.floor(identicalMtime.getTime() / 1000)});`)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.SchemaVersion, 'hasarbotu-pcloud-case-reconciliation/1.0.0')
  assert.equal(report.CaseStatus, 'ready')
  assert.equal(report.Entries.length, 0)
})

test('reconcileCase: 0-byte hedef placeholder stale_target olarak siniflanir, status conflict', async (context) => {
  const sourceMtime = new Date('2026-08-06T10:00:00.000Z')
  const sourceContent = 'guncel-tam-icerik'
  const fixture = await buildFixture(context, '00AAA000', [
    { name: 'sifir-byte.jpg', sourceContent, targetContent: '', sourceMtime },
  ], `
    INSERT INTO file VALUES (2001, 106, 'sifir-byte.jpg', ${sourceContent.length}, 3001, 0, 1, ${Math.floor(sourceMtime.getTime() / 1000)});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 9999, 0, 0);
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 3001, 1, ${sourceContent.length});
  `)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.CaseStatus, 'conflict')
  assert.equal(report.CaseStatusReason, 'UNRESOLVED_DIFFERENCE_OR_CONFLICT_NAME_PRESENT')
  assert.equal(report.Entries.length, 1)
  assert.equal(report.Entries[0].Classification, 'content_mismatch')
  assert.equal(report.Entries[0].PatternClassification, 'stale_target')
  assert.equal(report.Entries[0].Target.Size, 0)
  assert.equal(report.PatternCounts.stale_target, 1)
})

test('reconcileCase: klasik stale_target (eski gercek revision hedefte) dogru siniflanir', async (context) => {
  const sourceMtime = new Date('2026-08-06T11:00:00.000Z')
  const sourceContent = 'kucuk-yeni-icerik'
  const targetContent = 'cok-daha-buyuk-eski-icerik-xxxxxxxxxxxxxxxxxxxxxxxxx'
  const fixture = await buildFixture(context, '13BBB222', [
    { name: 'klasik.jpg', sourceContent, targetContent, sourceMtime },
  ], `
    INSERT INTO file VALUES (2001, 106, 'klasik.jpg', ${sourceContent.length}, 3001, 0, 1, ${Math.floor(sourceMtime.getTime() / 1000)});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 9999, 0, ${targetContent.length});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 3001, 1, ${sourceContent.length});
  `)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries[0].Currency, 'source_current_target_superseded')
  assert.equal(report.Entries[0].PatternClassification, 'stale_target')
  assert.equal(report.CaseStatus, 'conflict')
})

test('reconcileCase: taskReferenceCount>0 olan TEK fark syncing doner', async (context) => {
  const sourceMtime = new Date('2026-08-06T12:00:00.000Z')
  const sourceContent = 'yeni-icerik-aktif-sync'
  const targetContent = 'eski-icerik-aktif-sync-xxxxxxxxxxxxxxxxxxxxxxxxx'
  const fixture = await buildFixture(context, '14CCC333', [
    { name: 'senkron.jpg', sourceContent, targetContent, sourceMtime },
  ], `
    INSERT INTO file VALUES (2001, 106, 'senkron.jpg', ${sourceContent.length}, 3001, 0, 1, ${Math.floor(sourceMtime.getTime() / 1000)});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 9999, 0, ${targetContent.length});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 3001, 1, ${sourceContent.length});
    INSERT INTO fstask (id, fileid) VALUES (1, 2001);
  `)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries[0].PCloud.TaskReferenceCount, 1)
  assert.equal(report.CaseStatus, 'syncing')
  assert.equal(report.CaseStatusReason, 'ALL_AFFECTED_FILES_HAVE_LIVE_PCLOUD_TASK_REFERENCE')
})

test('reconcileCase: bir dosya syncing, digeri stuck olursa TUM vaka conflict kalir (fail-closed)', async (context) => {
  const sourceMtime = new Date('2026-08-06T13:00:00.000Z')
  const syncingSourceContent = 'senkron-yeni'
  const syncingTargetContent = 'senkron-eski-xxxxxxxxxxxxxxxxxxxxxxxxx'
  const stuckSourceContent = 'takilan-yeni'
  const stuckTargetContent = 'takilan-eski-xxxxxxxxxxxxxxxxxxxxxxxxx'
  const fixture = await buildFixture(context, '15DDD444', [
    { name: 'senkron.jpg', sourceContent: syncingSourceContent, targetContent: syncingTargetContent, sourceMtime },
    { name: 'takilan.jpg', sourceContent: stuckSourceContent, targetContent: stuckTargetContent, sourceMtime },
  ], `
    INSERT INTO file VALUES (2001, 106, 'senkron.jpg', ${syncingSourceContent.length}, 3001, 0, 1, ${Math.floor(sourceMtime.getTime() / 1000)});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 9999, 0, ${syncingTargetContent.length});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2001, 3001, 1, ${syncingSourceContent.length});
    INSERT INTO fstask (id, fileid) VALUES (1, 2001);
    INSERT INTO file VALUES (2002, 106, 'takilan.jpg', ${stuckSourceContent.length}, 3002, 0, 1, ${Math.floor(sourceMtime.getTime() / 1000)});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2002, 9998, 0, ${stuckTargetContent.length});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (2002, 3002, 1, ${stuckSourceContent.length});
  `)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries.length, 2)
  assert.equal(report.CaseStatus, 'conflict')
})

test('reconcileCase: ayni case icinde SHA-256 esleseni olan missing+extra cifti rename_artifact olur', async (context) => {
  const sharedContent = 'tasinan-ayni-icerik-bytes'
  const fixture = await buildFixture(context, '16EEE555', [
    { name: 'yeni-konum.pdf', sourceContent: sharedContent, targetContent: null },
    { name: 'eski-konum.pdf', sourceContent: null, targetContent: sharedContent },
  ], `
    INSERT INTO file VALUES (2001, 106, 'yeni-konum.pdf', ${sharedContent.length}, 3001, 0, 1, 1);
  `)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries.length, 2)
  for (const entry of report.Entries) {
    assert.equal(entry.PatternClassification, 'rename_artifact')
  }
  assert.equal(report.PatternCounts.rename_artifact, 2)
  assert.equal(report.CaseStatus, 'conflict')
})

test('reconcileCase: eslesmeyen extra dosya unknown kalir, asla otomatik silinmez (yalniz siniflandirilir)', async (context) => {
  const fixture = await buildFixture(context, '17FFF666', [
    { name: 'sahipsiz.jpg', sourceContent: null, targetContent: 'sahipsiz-icerik' },
  ], '')

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries.length, 1)
  assert.equal(report.Entries[0].Classification, 'extra')
  assert.equal(report.Entries[0].PatternClassification, 'unknown')
  assert.equal(report.CaseStatus, 'conflict')
  // structural invariant: the file must still exist on disk — this module
  // has no delete capability, verified again statically in
  // scripts/check-windows-service-configs.mjs.
  const stillExists = await readFile(path.join(fixture.targetRoot, fixture.caseRelativePath, 'sahipsiz.jpg'), 'utf8')
  assert.equal(stillExists, 'sahipsiz-icerik')
})

test('reconcileCase: metadata_only tamamen yok sayilir (PatternCounts ve CaseStatus etkilenmez)', async (context) => {
  const mtimeA = new Date('2026-07-01T00:00:00.000Z')
  const mtimeB = new Date('2026-07-02T00:00:00.000Z')
  const fixture = await buildFixture(context, '18GGG777', [
    { name: 'metadata-fark.txt', sourceContent: 'ayni-icerik-farkli-mtime', targetContent: 'ayni-icerik-farkli-mtime', sourceMtime: mtimeA, targetMtime: mtimeB },
  ], `INSERT INTO file VALUES (2001, 106, 'metadata-fark.txt', 24, 3001, 0, 1, ${Math.floor(mtimeA.getTime() / 1000)});`)

  const report = await reconcileCase({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    manifestPath: fixture.manifestPath,
    manifestSha256: fixture.manifestHash,
    pcloudDatabasePath: fixture.databasePath,
    caseRelativePath: fixture.caseRelativePath,
  })

  assert.equal(report.Entries.length, 0)
  assert.equal(report.CaseStatus, 'ready')
  assert.equal(report.Summary.Counts.metadata_only, 1)
})

test('reconcileCase: case klasoru hedefte hic yoksa conflict, ikisinde de yoksa unknown doner', async (context) => {
  const missingOnTarget = await buildFixture(context, '19HHH888', [], '')
  await rm(path.join(missingOnTarget.targetRoot, missingOnTarget.caseRelativePath), { recursive: true, force: true })
  const reportMissingTarget = await reconcileCase({
    sourceRoot: missingOnTarget.sourceRoot,
    targetRoot: missingOnTarget.targetRoot,
    manifestPath: missingOnTarget.manifestPath,
    manifestSha256: missingOnTarget.manifestHash,
    pcloudDatabasePath: missingOnTarget.databasePath,
    caseRelativePath: missingOnTarget.caseRelativePath,
  })
  assert.equal(reportMissingTarget.CaseStatus, 'conflict')
  assert.equal(reportMissingTarget.CaseStatusReason, 'CASE_FOLDER_MISSING_ON_TARGET')
  // Regression (found against real production data, HB-2026-162): the
  // PowerShell wrapper runs under Set-StrictMode and unconditionally reads
  // .PCloudQueueState/.ConflictNamesFound/.Summary off the JSON result --
  // an early-return shape missing any of these keys entirely (not just
  // null-valued) throws PropertyNotFoundException in the wrapper even
  // though this module's own Node-level tests all passed. Assert the keys
  // are present (value may be null) on every short-circuit path.
  assert.ok('PCloudQueueState' in reportMissingTarget)
  assert.ok('ConflictNamesFound' in reportMissingTarget)
  assert.ok('Summary' in reportMissingTarget)

  const missingBoth = await buildFixture(context, '20III999', [], '')
  await rm(path.join(missingBoth.sourceRoot, missingBoth.caseRelativePath), { recursive: true, force: true })
  await rm(path.join(missingBoth.targetRoot, missingBoth.caseRelativePath), { recursive: true, force: true })
  const reportMissingBoth = await reconcileCase({
    sourceRoot: missingBoth.sourceRoot,
    targetRoot: missingBoth.targetRoot,
    manifestPath: missingBoth.manifestPath,
    manifestSha256: missingBoth.manifestHash,
    pcloudDatabasePath: missingBoth.databasePath,
    caseRelativePath: missingBoth.caseRelativePath,
  })
  assert.equal(reportMissingBoth.CaseStatus, 'unknown')
  assert.equal(reportMissingBoth.CaseStatusReason, 'CASE_FOLDER_NOT_FOUND_ON_EITHER_SIDE')
  assert.ok('PCloudQueueState' in reportMissingBoth)
  assert.ok('ConflictNamesFound' in reportMissingBoth)
  assert.ok('Summary' in reportMissingBoth)
})

test('CLI: ready durumda cikis kodu 0, ready-disi durumda 2 doner', async (context) => {
  const identicalMtime = new Date('2026-07-01T00:00:00.000Z')
  const readyFixture = await buildFixture(context, '21JJJ000', [
    { name: 'ayni.txt', sourceContent: 'x', targetContent: 'x', sourceMtime: identicalMtime, targetMtime: identicalMtime },
  ], `INSERT INTO file VALUES (2001, 106, 'ayni.txt', 1, 3001, 0, 1, ${Math.floor(identicalMtime.getTime() / 1000)});`)
  const scriptPath = fileURLToPath(new URL('./pcloud-case-reconciliation.mjs', import.meta.url))
  const readyResult = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', readyFixture.sourceRoot,
    '--target-root', readyFixture.targetRoot,
    '--ghost-manifest', readyFixture.manifestPath,
    '--ghost-manifest-sha256', readyFixture.manifestHash,
    '--pcloud-db', readyFixture.databasePath,
    '--case-relative-path', readyFixture.caseRelativePath,
  ], { encoding: 'utf8' })
  assert.equal(readyResult.status, 0)
  assert.equal(JSON.parse(readyResult.stdout).CaseStatus, 'ready')

  const orphanFixture = await buildFixture(context, '22KKK111', [
    { name: 'sahipsiz.jpg', sourceContent: null, targetContent: 'x' },
  ], '')
  const conflictResult = spawnSync(process.execPath, [
    scriptPath,
    '--source-root', orphanFixture.sourceRoot,
    '--target-root', orphanFixture.targetRoot,
    '--ghost-manifest', orphanFixture.manifestPath,
    '--ghost-manifest-sha256', orphanFixture.manifestHash,
    '--pcloud-db', orphanFixture.databasePath,
    '--case-relative-path', orphanFixture.caseRelativePath,
  ], { encoding: 'utf8' })
  assert.equal(conflictResult.status, 2)
  assert.equal(JSON.parse(conflictResult.stdout).CaseStatus, 'conflict')
})
