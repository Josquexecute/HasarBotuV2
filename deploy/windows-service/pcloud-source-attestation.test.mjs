import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  attestationFileNameFor,
  buildAttestationRecords,
  buildAttestationRecordsBatch,
  findCasesNeedingAttestation,
  enumerateFilesRecursive,
  readAttestationRecord,
  resolveTopLevelFolderId,
  writeAttestationRecord,
} from './pcloud-source-attestation.mjs'

test('temporary artifacts match tracking policy while permanent V1 tracking metadata stays protected', async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hb-source-temporary-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '_HASARBOTU'))
  const { isTemporaryTrackedFile } = await import('../../packages/domain/dist/tracked-file.js')
  const names = ['ruhsat.pdf', '~$rapor.docx', '.takip.json.123.tmp', 'report.tmp', 'report.partial', 'Thumbs.db', 'desktop.ini', 'final.docx', 'photo.JPG', 'takip.json', 'HASARBOTU_TAKIP_OZETI.txt']
  for (const name of names) await writeFile(path.join(directory, name), name)
  await writeFile(path.join(directory, '_HASARBOTU', 'takip.json'), '{}')
  await writeFile(path.join(directory, '_HASARBOTU', 'HASARBOTU_TAKIP_OZETI.txt'), 'summary')
  const files = await enumerateFilesRecursive(directory)
  assert.deepEqual(files.filter(file => !file.relativePath.startsWith('_HASARBOTU')).map(file => file.relativePath).sort(), names.filter(name => !isTemporaryTrackedFile(name)).sort())
  assert.ok(files.some(file => file.relativePath === '_HASARBOTU\\takip.json'))
  assert.ok(files.some(file => file.relativePath === '_HASARBOTU\\HASARBOTU_TAKIP_OZETI.txt'))
})

async function buildFixture(context, { caseInsensitiveFileNames = false } = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-attestation-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const topLevelFolderName = 'KAYNAK'
  const caseRelativePath = '00AAA000'
  const sourceCaseRoot = path.join(temporaryRoot, topLevelFolderName, caseRelativePath)
  await mkdir(path.join(sourceCaseRoot, 'EVRAK'), { recursive: true })

  const fileABytes = 'dosya-a-icerigi'
  const fileBBytes = 'dosya-b-icerigi-farkli'
  await writeFile(path.join(sourceCaseRoot, 'ruhsat.pdf'), fileABytes)
  await writeFile(path.join(sourceCaseRoot, 'EVRAK', 'poliçe.pdf'), fileBBytes)

  const databasePath = path.join(temporaryRoot, 'data.db')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE folder (
      id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL,
      flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL
    );
    CREATE TABLE file (
      id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT ${caseInsensitiveFileNames ? 'COLLATE NOCASE' : ''} NOT NULL,
      size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL,
      ctime INTEGER NOT NULL, mtime INTEGER NOT NULL
    );
    CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (200, 100, '00AAA000', 0, 1, 1, 1);
    INSERT INTO folder VALUES (201, 200, 'EVRAK', 0, 1, 1, 0);
    INSERT INTO file VALUES (5001, 200, 'ruhsat.pdf', ${fileABytes.length}, -123456789012345, 0, 1, 1);
    INSERT INTO file VALUES (5002, 201, 'poliçe.pdf', ${fileBBytes.length}, 987654321098765, 0, 1, 1);
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (5001, -123456789012345, 1, ${fileABytes.length});
    INSERT INTO filerevision (fileid, hash, ctime, size) VALUES (5002, 987654321098765, 1, ${fileBBytes.length});
  `)
  database.close()

  return { temporaryRoot, topLevelFolderName, caseRelativePath, sourceCaseRoot, databasePath, fileABytes, fileBBytes }
}

test('batch attestation preserves real file hashes across two source cases', async (context) => {
  const fixture = await buildFixture(context)
  const secondRoot = path.join(fixture.temporaryRoot, 'KAYNAK', '00BBB000')
  await mkdir(secondRoot)
  await writeFile(path.join(secondRoot, 'ikinci.pdf'), 'ikinci')
  const database = new DatabaseSync(fixture.databasePath)
  database.exec("INSERT INTO folder VALUES(202,100,'00BBB000',0,1,1,0); INSERT INTO file VALUES(5003,202,'ikinci.pdf',6,42,0,1,1);")
  database.close()
  const records = await buildAttestationRecordsBatch({
    cases: [{ sourceCaseRoot: fixture.sourceCaseRoot, caseRelativePath: fixture.caseRelativePath },
      { sourceCaseRoot: secondRoot, caseRelativePath: '00BBB000' }],
    databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'test-admin',
  })
  assert.equal(records.length, 3)
  const original = await buildAttestationRecords({ ...fixture, attestedBy: 'test-admin' })
  for (const item of original) assert.equal(records.find((row) => row.FileId === item.FileId).Sha256, item.Sha256)
  assert.equal(records.find((row) => row.FileId === '5003').RelativePath, '00BBB000\\ikinci.pdf')
})

test('batch final fence rejects an earlier file revision changed while later files are hashing', async (context) => {
  const fixture = await buildFixture(context)
  process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER = '1'
  context.after(() => { delete process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER })
  const promise = buildAttestationRecordsBatch({ cases: [fixture], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'test-admin' })
  await new Promise((resolve) => { setTimeout(resolve, 150) })
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('UPDATE file SET hash=42 WHERE id=5002')
  database.close()
  await assert.rejects(promise, /IDENTITY_FENCE_REVISION_CHANGED_DURING_HASH/)
})

test('batch final fence rejects a source size change before returning any records', async (context) => {
  const fixture = await buildFixture(context)
  process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER = '1'
  context.after(() => { delete process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER })
  const promise = buildAttestationRecordsBatch({ cases: [fixture], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'test-admin' })
  await new Promise((resolve) => { setTimeout(resolve, 150) })
  await writeFile(path.join(fixture.sourceCaseRoot, 'EVRAK', 'poliçe.pdf'), 'size changed')
  await assert.rejects(promise, /IDENTITY_FENCE_SOURCE_SIZE_CHANGED_DURING_HASH/)
})

test('batch rejects an unbounded or duplicate scope', async (context) => {
  const fixture = await buildFixture(context)
  const settings = { databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'test-admin' }
  await assert.rejects(buildAttestationRecordsBatch({ ...settings, cases: Array(21).fill(fixture) }), /ATTESTATION_BATCH_CASES_INVALID/)
  await assert.rejects(buildAttestationRecordsBatch({ ...settings, cases: [fixture, fixture] }), /ATTESTATION_BATCH_DUPLICATE_CASE/)
})

test('batch source read failure names the file and returns no partial proof', async (context) => {
  const fixture = await buildFixture(context)
  process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER = '1'
  context.after(() => { delete process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER })
  const pending = buildAttestationRecordsBatch({ cases: [fixture], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'test-admin' })
  await new Promise((resolve) => { setTimeout(resolve, 50) })
  await rm(path.join(fixture.sourceCaseRoot, 'ruhsat.pdf'))
  await assert.rejects(pending, (error) => error.safeCode === 'SOURCE_FILE_READ_FAILED'
    && error.fileSystemCode === 'ENOENT' && error.sourceRelativePath === path.win32.join(fixture.caseRelativePath, 'ruhsat.pdf'))
})

test('refresh selection reuses verified source proofs and selects a changed revision', async (context) => {
  const fixture = await buildFixture(context)
  const targetCaseRoot = path.join(fixture.temporaryRoot, 'target')
  await cp(fixture.sourceCaseRoot, targetCaseRoot, { recursive: true })
  const store = path.join(fixture.temporaryRoot, 'proofs')
  const cases = [{ ...fixture, targetCaseRoot }]
  const args = { cases, databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName, attestationStoreDirectory: store }
  assert.deepEqual((await findCasesNeedingAttestation(args)).casesToRefresh, cases)
  for (const record of await buildAttestationRecords({ ...fixture, attestedBy: 'test-admin' })) await writeAttestationRecord(store, record)
  assert.equal((await findCasesNeedingAttestation(args)).casesToRefresh.length, 0)
  // Target edits never become a replacement source-of-truth attestation.
  await writeFile(path.join(targetCaseRoot, 'ruhsat.pdf'), 'different-target-bytes')
  assert.equal((await findCasesNeedingAttestation(args)).casesToRefresh.length, 0)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('UPDATE file SET hash=42 WHERE id=5002')
  database.close()
  assert.deepEqual((await findCasesNeedingAttestation(args)).casesToRefresh, cases)
})

test('refresh selection reuses independently hashed proofs across Windows filename casing aliases', async (context) => {
  const fixture = await buildFixture(context, { caseInsensitiveFileNames: true })
  const targetCaseRoot = path.join(fixture.temporaryRoot, 'target')
  await cp(fixture.sourceCaseRoot, targetCaseRoot, { recursive: true })
  await rename(path.join(targetCaseRoot, 'ruhsat.pdf'), path.join(targetCaseRoot, 'rename-stage.tmp'))
  await rename(path.join(targetCaseRoot, 'rename-stage.tmp'), path.join(targetCaseRoot, 'RUHSAT.PDF'))
  const database = new DatabaseSync(fixture.databasePath)
  database.exec("UPDATE file SET name='RUHSAT.PDF' WHERE id=5001")
  database.close()
  const records = await buildAttestationRecordsBatch({ cases: [fixture], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestedBy: 'independent-source' })
  const store = path.join(fixture.temporaryRoot, 'store')
  for (const record of records) await writeAttestationRecord(store, record)
  const cases = [{ ...fixture, targetCaseRoot }]
  const args = { cases, databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName, attestationStoreDirectory: store }
  const report = await findCasesNeedingAttestation(args)
  assert.equal(report.heldCases.length, 0)
  assert.equal(report.casesToRefresh.length, process.platform === 'win32' ? 0 : 1)
  const current = records.find(record => record.FileId === '5001')
  await writeAttestationRecord(store, { ...current, RelativePath: current.RelativePath.replace('00AAA000', '00BBB000') })
  assert.deepEqual((await findCasesNeedingAttestation(args)).casesToRefresh, cases)
})

test('refresh selection keeps held and refreshable case identities separate', async (context) => {
  const fixture = await buildFixture(context)
  const targetCaseRoot = path.join(fixture.temporaryRoot, 'target')
  await cp(fixture.sourceCaseRoot, targetCaseRoot, { recursive: true })
  const valid = { ...fixture, targetCaseRoot }
  const missing = { ...fixture, caseRelativePath: 'MISSING', targetCaseRoot: path.join(fixture.temporaryRoot, 'missing') }
  const report = await findCasesNeedingAttestation({ cases: [missing, valid], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestationStoreDirectory: path.join(fixture.temporaryRoot, 'proofs') })
  assert.deepEqual(report.casesToRefresh, [valid])
  assert.equal(report.heldCases[0].caseRelativePath, 'MISSING')
  await assert.rejects(findCasesNeedingAttestation({ cases: [{ ...fixture, targetCaseRoot: fixture.sourceCaseRoot }] }), /INDEPENDENT_SOURCE_ROOT_REQUIRED/)
})

test('refresh selection regenerates a corrupted proof from source rather than accepting it', async (context) => {
  const fixture = await buildFixture(context)
  const targetCaseRoot = path.join(fixture.temporaryRoot, 'target')
  await cp(fixture.sourceCaseRoot, targetCaseRoot, { recursive: true })
  const store = path.join(fixture.temporaryRoot, 'proofs')
  const records = await buildAttestationRecords({ ...fixture, attestedBy: 'test-admin' })
  for (const record of records) await writeAttestationRecord(store, record)
  await writeFile(path.join(store, attestationFileNameFor(records[0].FileId, records[0].PCloudHash)), '{}')
  const cases = [{ ...fixture, targetCaseRoot }]
  const report = await findCasesNeedingAttestation({ cases, databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestationStoreDirectory: store })
  assert.deepEqual(report.casesToRefresh, cases)
})

test('direct pCloud refresh selects new revisions only under the explicitly configured source root', async (context) => {
  const fixture = await buildFixture(context)
  const cases = [{ ...fixture, targetCaseRoot: fixture.sourceCaseRoot }]
  const store = path.join(fixture.temporaryRoot, 'proofs')
  const args = { cases, databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName,
    attestationStoreDirectory: store, directSourceRoot: path.dirname(fixture.sourceCaseRoot) }
  assert.deepEqual((await findCasesNeedingAttestation(args)).casesToRefresh, cases)
  const records = await buildAttestationRecordsBatch({ ...args, attestedBy: 'configured-direct-pcloud-source' })
  for (const record of records) await writeAttestationRecord(store, record)
  assert.equal((await findCasesNeedingAttestation(args)).casesToRefresh.length, 0)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('UPDATE file SET hash=42 WHERE id=5002')
  database.close()
  assert.deepEqual((await findCasesNeedingAttestation(args)).casesToRefresh, cases)
})

test('direct pCloud refresh cannot designate a different case directory as source evidence', async (context) => {
  const fixture = await buildFixture(context)
  const args = { cases: [{ ...fixture, targetCaseRoot: fixture.sourceCaseRoot }],
    databasePath: fixture.databasePath, topLevelFolderName: fixture.topLevelFolderName,
    directSourceRoot: path.dirname(fixture.sourceCaseRoot) }
  await assert.rejects(findCasesNeedingAttestation({ ...args, directSourceRoot: 'relative-root' }), /DIRECT_SOURCE_ROOT_INVALID/)
  await assert.rejects(findCasesNeedingAttestation({ ...args, cases: [{ ...args.cases[0], caseRelativePath: '../outside' }] }), /DIRECT_SOURCE_CASE_ROOT_MISMATCH/)
  await assert.rejects(findCasesNeedingAttestation({ ...args, cases: [{ ...args.cases[0], sourceCaseRoot: path.join(fixture.temporaryRoot, 'other') }] }), /DIRECT_SOURCE_CASE_ROOT_MISMATCH/)
  await assert.rejects(findCasesNeedingAttestation({ ...args, cases: [{ ...args.cases[0], targetCaseRoot: path.join(fixture.temporaryRoot, 'mirror') }] }), /DIRECT_SOURCE_CASE_ROOT_MISMATCH/)
})

test('refresh selection reports the unmatched source filename without producing a proof', async (context) => {
  const fixture = await buildFixture(context)
  const targetCaseRoot = path.join(fixture.temporaryRoot, 'target')
  await cp(fixture.sourceCaseRoot, targetCaseRoot, { recursive: true })
  const database = new DatabaseSync(fixture.databasePath)
  database.exec('DELETE FROM file WHERE id=5002')
  database.close()
  const report = await findCasesNeedingAttestation({ cases: [{ ...fixture, targetCaseRoot }], databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName, attestationStoreDirectory: path.join(fixture.temporaryRoot, 'proofs') })
  assert.equal(report.casesToRefresh.length, 0)
  assert.equal(report.heldCases[0].code, 'PCLOUD_FILE_ROW_NOT_FOUND')
  assert.equal(report.heldCases[0].sourceRelativePath, path.win32.join(fixture.caseRelativePath, 'EVRAK', 'poliçe.pdf'))
})

test('resolveTopLevelFolderId: parentfolderid=0 + name eslesmesiyle DB-yalniz cozer', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath, { readOnly: true, timeout: 0 })
  try {
    const id = resolveTopLevelFolderId(database, fixture.topLevelFolderName)
    assert.equal(id, '100')
    assert.throws(() => resolveTopLevelFolderId(database, 'YANLIS_ISIM'), /PCLOUD_TOP_LEVEL_FOLDER_NOT_FOUND/)
  } finally {
    database.close()
  }
})

test('buildAttestationRecords: gercek dosya SHA-256 + dogru fileId/hash eslesmesiyle 2 kayit uretir', async (context) => {
  const fixture = await buildFixture(context)
  const records = await buildAttestationRecords({
    sourceCaseRoot: fixture.sourceCaseRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestedBy: 'test-admin',
  })
  assert.equal(records.length, 2)
  const byFileId = new Map(records.map((r) => [r.FileId, r]))
  const ruhsat = byFileId.get('5001')
  assert.ok(ruhsat)
  assert.equal(ruhsat.PCloudHash, '-123456789012345')
  assert.equal(ruhsat.SizeBytes, fixture.fileABytes.length)
  assert.match(ruhsat.Sha256, /^[a-f0-9]{64}$/)
  const police = byFileId.get('5002')
  assert.ok(police)
  assert.equal(police.PCloudHash, '987654321098765')
  assert.ok(police.RelativePath.includes('EVRAK'))
})

test('buildAttestationRecords: DB kaydinda boyut GERCEK dosyayla uyusmuyorsa fail-closed', async (context) => {
  const fixture = await buildFixture(context)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`UPDATE file SET size = 999999 WHERE id = 5001;`)
  database.close()
  await assert.rejects(
    buildAttestationRecords({
      sourceCaseRoot: fixture.sourceCaseRoot,
      databasePath: fixture.databasePath,
      topLevelFolderName: fixture.topLevelFolderName,
      caseRelativePath: fixture.caseRelativePath,
      attestedBy: 'test-admin',
    }),
    /SOURCE_SIZE_RACE_VS_PCLOUD_DB_DURING_ATTESTATION/,
  )
})

test('buildAttestationRecords: pCloud DB satirinda dosya yoksa fail-closed (uydurulmus attestation yok)', async (context) => {
  const fixture = await buildFixture(context)
  await writeFile(path.join(fixture.sourceCaseRoot, 'bilinmeyen.txt'), 'db-de-hic-yok')
  await assert.rejects(
    buildAttestationRecords({
      sourceCaseRoot: fixture.sourceCaseRoot,
      databasePath: fixture.databasePath,
      topLevelFolderName: fixture.topLevelFolderName,
      caseRelativePath: fixture.caseRelativePath,
      attestedBy: 'test-admin',
    }),
    /PCLOUD_FILE_ROW_NOT_FOUND/,
  )
})

test('attestationFileNameFor: pozitif ve negatif pCloudHash icin stabil, dosya-adi-guvenli, celismesiz kodlama', () => {
  const positive = attestationFileNameFor('5002', '987654321098765')
  const negative = attestationFileNameFor('5001', '-123456789012345')
  assert.match(positive, /^attestation-5002-pos[0-9a-f]+\.json$/)
  assert.match(negative, /^attestation-5001-neg[0-9a-f]+\.json$/)
  assert.notEqual(positive, negative)
  // Deterministic: same input always the same output.
  assert.equal(attestationFileNameFor('5002', '987654321098765'), positive)
})

test('writeAttestationRecord + readAttestationRecord: hash-dogrulamali round-trip', async (context) => {
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-attestation-store-'))
  context.after(async () => rm(storeDir, { recursive: true, force: true }))
  const record = {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '5001',
    PCloudHash: '-123456789012345',
    RelativePath: '00AAA000\\ruhsat.pdf',
    SizeBytes: 15,
    Sha256: 'a'.repeat(64),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test-admin',
  }
  await writeAttestationRecord(storeDir, record)
  const readBack = await readAttestationRecord(storeDir, '5001', '-123456789012345')
  assert.ok(readBack)
  assert.equal(readBack.Sha256, 'a'.repeat(64))
  assert.equal(readBack.FileId, '5001')
})

test('readAttestationRecord: olmayan (fileId,hash) icin null doner (hata degil -- normal "unknown" durumu)', async (context) => {
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-attestation-store-empty-'))
  context.after(async () => rm(storeDir, { recursive: true, force: true }))
  const result = await readAttestationRecord(storeDir, '999999', '111111')
  assert.equal(result, null)
})

test('readAttestationRecord: kanit dosyasi sonradan degistirilirse (tampering) fail-closed', async (context) => {
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-attestation-store-tamper-'))
  context.after(async () => rm(storeDir, { recursive: true, force: true }))
  const record = {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '7001',
    PCloudHash: '42',
    RelativePath: '00AAA000\\x.pdf',
    SizeBytes: 10,
    Sha256: 'b'.repeat(64),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test-admin',
  }
  const written = await writeAttestationRecord(storeDir, record)
  const fullPath = path.join(storeDir, written.fileName)
  const tampered = JSON.parse(await readFile(fullPath, 'utf8'))
  tampered.Sha256 = 'c'.repeat(64)
  await writeFile(fullPath, JSON.stringify(tampered, null, 2), 'utf8')
  await assert.rejects(
    readAttestationRecord(storeDir, '7001', '42'),
    /ATTESTATION_RECORD_HASH_MISMATCH/,
  )
})

test('buildAttestationRecords: POST kimlik-fence -- hash hesaplandiktan SONRA pCloud revizyonu degisirse fail-closed (gercek zamanlamayla, deterministik test-yalniz senkron isaretiyle)', async (context) => {
  const fixture = await buildFixture(context)
  process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER = '1'
  context.after(() => { delete process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER })

  const buildPromise = buildAttestationRecords({
    sourceCaseRoot: fixture.sourceCaseRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestedBy: 'test-admin',
  })
  // Land inside the deterministic 100ms pause the sync marker guarantees
  // (right after SHA-256 completes, right before the POST DB re-check)
  // and mutate the DB out from under it -- a REAL revision change during
  // the exact race window this fence exists to close.
  await new Promise((resolve) => { setTimeout(resolve, 30) })
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`UPDATE file SET hash = -999999999999999 WHERE id = 5001;`)
  database.close()

  await assert.rejects(buildPromise, /IDENTITY_FENCE_REVISION_CHANGED_DURING_HASH/)
})

test('buildAttestationRecords: POST kimlik-fence -- hash hesaplandiktan SONRA kaynak dosya boyutu degisirse fail-closed', async (context) => {
  const fixture = await buildFixture(context)
  process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER = '1'
  context.after(() => { delete process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER })

  const buildPromise = buildAttestationRecords({
    sourceCaseRoot: fixture.sourceCaseRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestedBy: 'test-admin',
  })
  await new Promise((resolve) => { setTimeout(resolve, 30) })
  // Real file content change during the exact race window -- the DB
  // still shows the OLD size/hash, but the file itself has already
  // changed on disk.
  await writeFile(path.join(fixture.sourceCaseRoot, 'ruhsat.pdf'), 'degisti-farkli-uzunlukta-icerik')

  await assert.rejects(buildPromise, /IDENTITY_FENCE_SOURCE_SIZE_CHANGED_DURING_HASH/)
})

test('buildAttestationRecords: senkron isareti KAPALIYKEN (uretimdeki normal durum) davranis degismez, tum kayitlar basariyla uretilir', async (context) => {
  const fixture = await buildFixture(context)
  assert.equal(process.env.HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER, undefined)
  const records = await buildAttestationRecords({
    sourceCaseRoot: fixture.sourceCaseRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestedBy: 'test-admin',
  })
  assert.equal(records.length, 2)
})
