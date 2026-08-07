import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  attestationFileNameFor,
  buildAttestationRecords,
  readAttestationRecord,
  resolveTopLevelFolderId,
  writeAttestationRecord,
} from './pcloud-source-attestation.mjs'

async function buildFixture(context) {
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
      id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL,
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
