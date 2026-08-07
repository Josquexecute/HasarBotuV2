import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { withConsistentPcloudDatabase } from './pcloud-maintenance-window-gate.mjs'
import {
  fileSha256,
  getCurrentFileRow,
  resolveFolderIdByRelativeDirParts,
} from './pcloud-post-sync-diff-forensics.mjs'

// Source SHA-256 attestation store (HB-2026-167, Karar 1).
//
// WHY this module exists: pCloud's local SQLite DB (already granted
// read-only access to svc-hb-fileagent, HB-2026-163/164/165) stores a
// `file.hash` column, but it is a plain SQLite INTEGER -- confirmed by a
// real query against the real local DB on this machine: sampled values
// span the full 64-bit SIGNED range (e.g. -5965063559331438791), which is
// mathematically impossible for a 256-bit SHA-256 digest to fit in (a
// SQLite INTEGER column caps at 8 bytes / 64 bits; SHA-256 needs 32
// bytes / 256 bits). So `file.hash` CANNOT be, and is not claimed here to
// be, a cryptographically trustworthy content hash -- it is pCloud's own
// internal (fast, non-cryptographic) change-detection value. The
// `filerevision(fileid, hash, ctime, size)` table already treats the
// (fileid, hash) PAIR as the natural revision-identity key (confirmed by
// its own PRIMARY KEY), which this module reuses as the attestation key
// -- but the actual trust anchor is always a SEPARATELY, independently
// computed SHA-256 of the real source bytes, recorded here.
//
// This module runs in an ADMIN/interactive context that has REAL access
// to the pCloud source (P:\ or wherever `sourceCaseRoot` points) -- NOT
// Session 0 / a Windows service (that constraint is exactly why this
// attestation step exists as a separate, offline step in the first
// place; see pcloud-session0-freshness-gate.mjs for the Session-0-safe
// consumer side). It only ever READS source file bytes and READS the
// pCloud DB (via the existing withConsistentPcloudDatabase snapshot
// discipline) -- it never writes to pCloud, source, or target, only to
// its own attestation store.

export const ATTESTATION_RECORD_SCHEMA_VERSION = 'hasarbotu-pcloud-source-attestation-record/1.0.0'
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

class SafeError extends Error {
  constructor(safeCode) {
    super(safeCode)
    this.name = 'SafeError'
    this.safeCode = safeCode
  }
}

function fail(safeCode) {
  throw new SafeError(safeCode)
}

function assert(condition, safeCode) {
  if (!condition) fail(safeCode)
}

function foldWindows(value) {
  return value.normalize('NFC').toLowerCase()
}

/** Purely DB-based: no filesystem access to the source tree is needed. */
export function resolveTopLevelFolderId(database, topLevelFolderName) {
  const row = database.prepare(
    'SELECT CAST(id AS TEXT) AS id_text FROM folder WHERE parentfolderid = 0 AND name = ?',
  ).get(topLevelFolderName)
  assert(row, 'PCLOUD_TOP_LEVEL_FOLDER_NOT_FOUND')
  return row.id_text
}

/**
 * Filename-safe, unambiguous, deterministic encoding of a (fileId,
 * pCloudHash) revision-identity pair -- the SAME pair for the SAME
 * revision always resolves to the SAME attestation filename, with no
 * separate index needed. pCloudHash can be negative (signed 64-bit); '-'
 * is replaced with a 'neg' prefix rather than relied on as a filename
 * character.
 */
export function attestationFileNameFor(fileId, pCloudHash) {
  const hashBigInt = BigInt(pCloudHash)
  const hashToken = hashBigInt < 0n ? `neg${(-hashBigInt).toString(16)}` : `pos${hashBigInt.toString(16)}`
  return `attestation-${fileId}-${hashToken}.json`
}

/**
 * Shared by both this module (source-side attestation) and
 * pcloud-session0-freshness-gate.mjs (target-side gate evaluation) -- one
 * plain recursive file walk, no pCloud/DB dependency either way.
 */
export async function enumerateFilesRecursive(root, relativePrefix = '') {
  const entries = await readdir(path.join(root, relativePrefix), { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const entryRelative = relativePrefix ? path.win32.join(relativePrefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      results.push(...await enumerateFilesRecursive(root, entryRelative))
    } else if (entry.isFile()) {
      const fullPath = path.join(root, entryRelative)
      const stats = await stat(fullPath)
      results.push({ relativePath: entryRelative, fullPath, sizeBytes: stats.size })
    }
  }
  return results
}

/**
 * Builds (but does not persist) attestation records for every file under
 * a source case folder. Real source bytes ARE read here (SHA-256), which
 * is exactly why this cannot run Session-0-safe -- it needs the same
 * source access `run-pcloud-case-reconciliation.ps1` already requires.
 *
 * All of this case's DB rows are resolved from a SINGLE consistent DB
 * snapshot (one withConsistentPcloudDatabase call for the whole case, not
 * one per file) -- both for efficiency (each snapshot copies data.db +
 * -wal + -shm) and correctness (every file's fileId/hash comes from the
 * exact same point-in-time view of the DB, not N independently-taken
 * snapshots that could disagree on a fast-changing case).
 */
export async function buildAttestationRecords({
  sourceCaseRoot,
  databasePath,
  topLevelFolderName,
  caseRelativePath,
  attestedBy,
}) {
  assert(typeof sourceCaseRoot === 'string' && sourceCaseRoot.length > 0, 'SOURCE_CASE_ROOT_REQUIRED')
  assert(typeof databasePath === 'string' && databasePath.length > 0, 'DATABASE_PATH_REQUIRED')
  assert(typeof topLevelFolderName === 'string' && topLevelFolderName.length > 0, 'TOP_LEVEL_FOLDER_NAME_REQUIRED')
  assert(typeof caseRelativePath === 'string' && caseRelativePath.length > 0, 'CASE_RELATIVE_PATH_REQUIRED')
  assert(typeof attestedBy === 'string' && attestedBy.length > 0, 'ATTESTED_BY_REQUIRED')

  const caseDirStat = await stat(sourceCaseRoot).catch(() => null)
  assert(caseDirStat && caseDirStat.isDirectory(), 'SOURCE_CASE_ROOT_NOT_FOUND')

  const files = await enumerateFilesRecursive(sourceCaseRoot)
  const caseRelativeParts = caseRelativePath.split(/[\\/]+/).filter((part) => part.length > 0)
  const nowIso = new Date().toISOString()

  const dbInfoByRelativePath = await withConsistentPcloudDatabase(databasePath, (database) => {
    const topId = resolveTopLevelFolderId(database, topLevelFolderName)
    const caseFolderId = resolveFolderIdByRelativeDirParts(database, topId, caseRelativeParts)
    assert(caseFolderId !== null, 'PCLOUD_CASE_FOLDER_NOT_FOUND')
    const resolved = new Map()
    for (const file of files) {
      const fileRelativeParts = file.relativePath.split(/[\\/]+/).filter((part) => part.length > 0)
      const fileName = fileRelativeParts[fileRelativeParts.length - 1]
      const fileDirParts = fileRelativeParts.slice(0, -1)
      const fileFolderId = fileDirParts.length === 0
        ? caseFolderId
        : resolveFolderIdByRelativeDirParts(database, caseFolderId, fileDirParts)
      assert(fileFolderId !== null, 'PCLOUD_FILE_FOLDER_NOT_FOUND')
      const row = getCurrentFileRow(database, fileFolderId, fileName)
      assert(row, 'PCLOUD_FILE_ROW_NOT_FOUND')
      resolved.set(file.relativePath, { fileId: row.id_text, pCloudHash: row.hash_text, dbSizeBytes: row.size })
    }
    return resolved
  })

  const records = []
  for (const file of files) {
    const sha256 = await fileSha256(file.fullPath)
    const dbInfo = dbInfoByRelativePath.get(file.relativePath)

    // Real, source-of-truth cross-check: the DB's recorded size for the
    // CURRENT revision must match the size just observed on disk -- a
    // mismatch means the file changed between the stat() and the DB
    // snapshot (a real race), and attesting under those conditions would
    // silently bind the WRONG (fileId, hash) key to this SHA-256. Fail
    // closed rather than attest a possibly-stale pairing.
    assert(
      Number(dbInfo.dbSizeBytes) === file.sizeBytes,
      'SOURCE_SIZE_RACE_VS_PCLOUD_DB_DURING_ATTESTATION',
    )

    records.push({
      SchemaVersion: ATTESTATION_RECORD_SCHEMA_VERSION,
      FileId: dbInfo.fileId,
      PCloudHash: dbInfo.pCloudHash,
      RelativePath: path.win32.join(caseRelativePath, file.relativePath),
      SizeBytes: file.sizeBytes,
      Sha256: sha256,
      AttestedAtUtc: nowIso,
      AttestedBy: attestedBy,
    })
  }

  return records
}

/**
 * Persists one attestation record as its own file, named deterministically
 * from (FileId, PCloudHash) -- callers are responsible for the store
 * directory's ACL (Administrators-only WRITE; a read grant for
 * svc-hb-fileagent is a SEPARATE, not-yet-applied decision, see
 * DECISION_LOG HB-2026-167 SS "Açık kalan"). This function itself performs
 * no ACL work -- it only writes plain files, matching every other
 * evidence-writing helper in this directory (the .ps1 wrapper is
 * responsible for admin-only ACL + hash sidecar, same as
 * Write-AdminOnlyEvidence elsewhere).
 */
export async function writeAttestationRecord(storeDirectory, record) {
  assert(record && typeof record.FileId === 'string' && typeof record.PCloudHash === 'string', 'INVALID_ATTESTATION_RECORD')
  assert(SHA256_HEX_PATTERN.test(record.Sha256), 'INVALID_ATTESTATION_SHA256')
  await mkdir(storeDirectory, { recursive: true })
  const fileName = attestationFileNameFor(record.FileId, record.PCloudHash)
  const fullPath = path.join(storeDirectory, fileName)
  const json = JSON.stringify(record, null, 2)
  await writeFile(fullPath, json, 'utf8')
  const sha256 = createHash('sha256').update(json, 'utf8').digest('hex')
  await writeFile(`${fullPath}.sha256`, `${sha256}  ${fileName}\n`, 'utf8')
  return { fileName, sha256 }
}

/**
 * Reads back and hash-verifies one attestation record for a given
 * (fileId, pCloudHash) revision-identity pair. Returns null (not an
 * error) when no attestation exists for that exact revision -- this is
 * the NORMAL, expected "unknown" case, not a failure.
 */
export async function readAttestationRecord(storeDirectory, fileId, pCloudHash) {
  const fileName = attestationFileNameFor(fileId, pCloudHash)
  const fullPath = path.join(storeDirectory, fileName)
  const json = await readFile(fullPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (json === null) return null
  const sidecar = await readFile(`${fullPath}.sha256`, 'utf8').catch(() => null)
  assert(sidecar !== null, 'ATTESTATION_SHA256_SIDECAR_MISSING')
  const expectedHash = sidecar.trim().split(/\s+/)[0]
  const actualHash = createHash('sha256').update(json, 'utf8').digest('hex')
  assert(expectedHash === actualHash, 'ATTESTATION_RECORD_HASH_MISMATCH')
  const record = JSON.parse(json)
  assert(record.SchemaVersion === ATTESTATION_RECORD_SCHEMA_VERSION, 'ATTESTATION_RECORD_SCHEMA_INVALID')
  assert(record.FileId === fileId && record.PCloudHash === pCloudHash, 'ATTESTATION_RECORD_KEY_MISMATCH')
  return record
}
