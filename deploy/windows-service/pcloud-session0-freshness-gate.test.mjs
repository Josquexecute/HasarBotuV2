import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { determineSessionSafeCaseStatus } from './pcloud-session0-freshness-gate.mjs'
import { writeAttestationRecord } from './pcloud-source-attestation.mjs'

function sha256Of(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function buildFixture(context) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-session0-gate-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const topLevelFolderName = 'KAYNAK'
  const caseRelativePath = '00AAA000'
  const targetCaseRoot = path.join(temporaryRoot, 'HEDEF', topLevelFolderName, caseRelativePath)
  const attestationStoreDirectory = path.join(temporaryRoot, 'attestations')
  await mkdir(targetCaseRoot, { recursive: true })
  await mkdir(attestationStoreDirectory, { recursive: true })

  // ready.pdf: attested, target bytes match the attestation exactly.
  const readyBytes = 'hazir-dosya-icerigi'
  await writeFile(path.join(targetCaseRoot, 'ready.pdf'), readyBytes)

  // syncing.pdf: no attestation, but pCloud has a live task referencing it.
  const syncingBytes = 'senkronize-oluyor'
  await writeFile(path.join(targetCaseRoot, 'syncing.pdf'), syncingBytes)

  // unknown.pdf: no attestation, no live task -- freshness simply unproven.
  const unknownBytes = 'bilinmeyen-durum'
  await writeFile(path.join(targetCaseRoot, 'unknown.pdf'), unknownBytes)

  // conflict.pdf: attested, but target bytes were changed AFTER attestation
  // (simulates tampering/corruption/a wrong attestation).
  const conflictAttestedBytes = 'attestation-zamanindaki-icerik'
  const conflictActualBytes = 'sonradan-degisen-farkli-icerik'
  await writeFile(path.join(targetCaseRoot, 'conflict.pdf'), conflictActualBytes)

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
    CREATE TABLE task (id INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER);
    CREATE TABLE fstask (id INTEGER, fileid INTEGER);
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (200, 100, '00AAA000', 0, 1, 1, 0);
    INSERT INTO file VALUES (6001, 200, 'ready.pdf', ${readyBytes.length}, 111, 0, 1, 1);
    INSERT INTO file VALUES (6002, 200, 'syncing.pdf', ${syncingBytes.length}, 222, 0, 1, 1);
    INSERT INTO file VALUES (6003, 200, 'unknown.pdf', ${unknownBytes.length}, 333, 0, 1, 1);
    INSERT INTO file VALUES (6004, 200, 'conflict.pdf', ${conflictAttestedBytes.length}, 444, 0, 1, 1);
    INSERT INTO task (id, itemid, localitemid, newitemid) VALUES (1, 6002, 0, 0);
    -- Separate, single-file case folder for the "nothing blocking -> ready"
    -- scenario, deliberately isolated from folder 200's other DB-known
    -- files (which the missing-from-target check would otherwise, and
    -- correctly, flag as missing if a caller only re-created ready.pdf
    -- under the SAME case folder).
    INSERT INTO folder VALUES (300, 100, '00BBB000', 0, 1, 1, 0);
    INSERT INTO file VALUES (6101, 300, 'ready.pdf', ${readyBytes.length}, 111, 0, 1, 1);
  `)
  database.close()

  await writeAttestationRecord(attestationStoreDirectory, {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '6001',
    PCloudHash: '111',
    RelativePath: '00AAA000\\ready.pdf',
    SizeBytes: readyBytes.length,
    Sha256: sha256Of(readyBytes),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test-admin',
  })
  await writeAttestationRecord(attestationStoreDirectory, {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '6004',
    PCloudHash: '444',
    RelativePath: '00AAA000\\conflict.pdf',
    SizeBytes: conflictAttestedBytes.length,
    Sha256: sha256Of(conflictAttestedBytes),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test-admin',
  })

  return { temporaryRoot, topLevelFolderName, caseRelativePath, targetCaseRoot, databasePath, attestationStoreDirectory }
}

test('determineSessionSafeCaseStatus: ready/syncing/unknown/conflict dogru siniflandirilir, CaseStatus en kotu durumu alir', async (context) => {
  const fixture = await buildFixture(context)
  const report = await determineSessionSafeCaseStatus({
    targetCaseRoot: fixture.targetCaseRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestationStoreDirectory: fixture.attestationStoreDirectory,
  })
  const byPath = new Map(report.Entries.map((entry) => [entry.RelativePath, entry]))
  assert.equal(byPath.get('ready.pdf').FileStatus, 'ready')
  assert.equal(byPath.get('syncing.pdf').FileStatus, 'syncing')
  assert.equal(byPath.get('syncing.pdf').Reason, 'NO_ATTESTATION_FOR_CURRENT_REVISION_LIVE_TASK')
  assert.equal(byPath.get('unknown.pdf').FileStatus, 'unknown')
  assert.equal(byPath.get('unknown.pdf').Reason, 'NO_ATTESTATION_FOR_CURRENT_REVISION')
  assert.equal(byPath.get('conflict.pdf').FileStatus, 'conflict')
  assert.equal(byPath.get('conflict.pdf').Reason, 'ATTESTATION_SHA256_MISMATCH')
  // conflict is present among the files -> CaseStatus must be the worst (conflict), never 'ready'.
  assert.equal(report.CaseStatus, 'conflict')
  assert.equal(report.Summary.TotalFiles, 4)
  assert.equal(report.Summary.ReadyCount, 1)
})

test('determineSessionSafeCaseStatus: hicbir engelleyici dosya yoksa CaseStatus=ready', async (context) => {
  const fixture = await buildFixture(context)
  // A DIFFERENT, isolated case folder (00BBB000) whose DB rows exactly
  // match what is on disk here -- deliberately not 00AAA000, which the DB
  // fixture also lists syncing/unknown/conflict files under.
  const cleanCaseRelativePath = '00BBB000'
  const cleanRoot = path.join(fixture.temporaryRoot, 'HEDEF_TEMIZ', fixture.topLevelFolderName, cleanCaseRelativePath)
  await mkdir(cleanRoot, { recursive: true })
  const readyBytes = 'hazir-dosya-icerigi'
  await writeFile(path.join(cleanRoot, 'ready.pdf'), readyBytes)
  await writeAttestationRecord(fixture.attestationStoreDirectory, {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '6101',
    PCloudHash: '111',
    RelativePath: '00BBB000\\ready.pdf',
    SizeBytes: readyBytes.length,
    Sha256: sha256Of(readyBytes),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test-admin',
  })
  const report = await determineSessionSafeCaseStatus({
    targetCaseRoot: cleanRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: cleanCaseRelativePath,
    attestationStoreDirectory: fixture.attestationStoreDirectory,
  })
  const byPath = new Map(report.Entries.map((entry) => [entry.RelativePath, entry]))
  assert.equal(byPath.get('ready.pdf').FileStatus, 'ready')
  assert.equal(report.CaseStatus, 'ready')
})

test('determineSessionSafeCaseStatus: pCloud conflict-name deseni varsa fail-closed conflict (dosyalar hepsi ready olsa bile)', async (context) => {
  const fixture = await buildFixture(context)
  const cleanRoot = path.join(fixture.temporaryRoot, 'HEDEF_TEMIZ2', fixture.topLevelFolderName, fixture.caseRelativePath)
  await mkdir(cleanRoot, { recursive: true })
  const readyBytes = 'hazir-dosya-icerigi'
  await writeFile(path.join(cleanRoot, 'ready.pdf'), readyBytes)
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`INSERT INTO file VALUES (6099, 200, 'baska (conflicted copy 1).pdf', 0, 555, 0, 1, 1);`)
  database.close()
  const report = await determineSessionSafeCaseStatus({
    targetCaseRoot: cleanRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestationStoreDirectory: fixture.attestationStoreDirectory,
  })
  assert.equal(report.CaseStatus, 'conflict')
  assert.ok(report.ConflictNamesFound.includes('baska (conflicted copy 1).pdf'))
})

test('determineSessionSafeCaseStatus: pCloud DB dosyayi listeliyor ama target eksikse asla sessizce atlanmaz (syncing/unknown olarak raporlanir)', async (context) => {
  const fixture = await buildFixture(context)
  const emptyRoot = path.join(fixture.temporaryRoot, 'HEDEF_BOS', fixture.topLevelFolderName, fixture.caseRelativePath)
  await mkdir(emptyRoot, { recursive: true })
  // No files written at all -- but the DB (from buildFixture) still lists
  // ready/syncing/unknown/conflict under this case folder.
  const report = await determineSessionSafeCaseStatus({
    targetCaseRoot: emptyRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestationStoreDirectory: fixture.attestationStoreDirectory,
  })
  assert.equal(report.Entries.length, 4)
  const byPath = new Map(report.Entries.map((entry) => [entry.RelativePath, entry]))
  // syncing.pdf has a live task in the DB fixture -> missing-but-syncing.
  assert.equal(byPath.get('syncing.pdf').FileStatus, 'syncing')
  assert.equal(byPath.get('syncing.pdf').Reason, 'FILE_MISSING_FROM_TARGET_LIVE_TASK')
  // ready.pdf has NO live task -> missing-and-unknown, never 'ready' just
  // because an attestation happens to exist for its revision.
  assert.equal(byPath.get('ready.pdf').FileStatus, 'unknown')
  assert.equal(byPath.get('ready.pdf').Reason, 'FILE_MISSING_FROM_TARGET')
  assert.notEqual(report.CaseStatus, 'ready')
})

test('determineSessionSafeCaseStatus: target dizininde pCloud DB de hic bilinmeyen dosya varsa unknown (asla ready degil)', async (context) => {
  const fixture = await buildFixture(context)
  const cleanRoot = path.join(fixture.temporaryRoot, 'HEDEF_TEMIZ3', fixture.topLevelFolderName, fixture.caseRelativePath)
  await mkdir(cleanRoot, { recursive: true })
  await writeFile(path.join(cleanRoot, 'sürpriz.pdf'), 'db-de-olmayan-dosya')
  const report = await determineSessionSafeCaseStatus({
    targetCaseRoot: cleanRoot,
    databasePath: fixture.databasePath,
    topLevelFolderName: fixture.topLevelFolderName,
    caseRelativePath: fixture.caseRelativePath,
    attestationStoreDirectory: fixture.attestationStoreDirectory,
  })
  const entry = report.Entries.find((e) => e.RelativePath === 'sürpriz.pdf')
  assert.equal(entry.FileStatus, 'unknown')
  assert.equal(entry.Reason, 'PCLOUD_DB_ROW_NOT_FOUND')
  assert.notEqual(report.CaseStatus, 'ready')
})

test('determineSessionSafeCaseStatus: hedef kok bulunamazsa fail-closed hata', async (context) => {
  const fixture = await buildFixture(context)
  await assert.rejects(
    determineSessionSafeCaseStatus({
      targetCaseRoot: path.join(fixture.temporaryRoot, 'HIC-YOK'),
      databasePath: fixture.databasePath,
      topLevelFolderName: fixture.topLevelFolderName,
      caseRelativePath: fixture.caseRelativePath,
      attestationStoreDirectory: fixture.attestationStoreDirectory,
    }),
    /TARGET_CASE_ROOT_NOT_FOUND/,
  )
})
