import { lstat, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { withConsistentPcloudDatabase } from './pcloud-maintenance-window-gate.mjs'
import {
  CONFLICT_NAME_PATTERN,
  fileSha256,
  findAllConflictNames,
  getCurrentFileRow,
  getTaskReferenceCount,
  resolveFolderIdByRelativeDirParts,
} from './pcloud-post-sync-diff-forensics.mjs'
import { enumerateFilesRecursive, readAttestationRecord, resolveTopLevelFolderId } from './pcloud-source-attestation.mjs'

// Session-0-safe per-case freshness gate (HB-2026-167, Karar 1 -- approved
// architecture, replacing the P:\-dependent pcloud-case-reconciliation.mjs
// CLI contract for the purpose of a live File Agent freshness check).
//
// ZERO P:\ / pCloud-virtual-drive dependency anywhere in this module --
// that is the entire point of it existing separately. Every input is
// either the pCloud LOCAL DATABASE (already granted read-only access to
// svc-hb-fileagent, HB-2026-163/164/165 -- used here purely for folder/
// file NAME resolution against the DB's own folder tree, plus the live
// task-queue reference count -- never for reading P:\ bytes), the TARGET
// tree (C:\HasarBotuStorage\..., real local disk, Session-0-safe by
// construction), or a separately-generated SOURCE SHA-256 ATTESTATION
// store (pcloud-source-attestation.mjs) written by a SEPARATE, ADMIN-run,
// P:\-having process -- never by this module.
//
// Per-file status:
//   ready    -- an attestation exists for the file's CURRENT (fileId,
//               pCloudHash) revision AND its recorded Sha256 equals a
//               FRESH SHA-256 computed from the real target bytes right
//               now. The ONLY path to 'ready'. pCloud's own file.hash
//               column is a plain 64-bit SQLite INTEGER (proven via a
//               real query against the real local DB: sampled values
//               span the full 64-bit signed range) -- structurally
//               incapable of being a 256-bit content hash, so DB hash/
//               size/mtime ALONE are NEVER treated as sufficient here.
//   syncing  -- no attestation for the CURRENT revision, but pCloud has a
//               live task/fstask reference to this fileId right now (the
//               revision is actively changing).
//   unknown  -- no attestation for the CURRENT revision and no live task
//               reference -- freshness cannot be proven; the honest
//               default, never silently upgraded to ready.
//   conflict -- an attestation exists for the current revision but its
//               Sha256 does NOT match the freshly-computed target hash
//               (fail closed -- a real discrepancy), OR pCloud's DB still
//               lists the file but it is missing from the target, OR a
//               pCloud conflict-name pattern exists anywhere in this
//               case's DB subtree.
//
// CaseStatus is the WORST of every per-file/conflict-name status
// (conflict > syncing > unknown > ready) -- 'ready' only when every file
// is individually ready, matching pcloud-case-reconciliation.mjs's
// existing fail-closed all-or-nothing CaseStatus philosophy.

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

const STATUS_PRECEDENCE = { ready: 0, unknown: 1, syncing: 2, conflict: 3 }

/**
 * Recursive, DB-only enumeration of every FILE pCloud's local database
 * currently lists under a folder (accumulating relative paths via the
 * recursive CTE itself, mirroring getRemoteInventory's tree-walk style in
 * pcloud-maintenance-window-gate.mjs but scoped to one case folder and
 * returning file rows directly). Needed so a file pCloud's DB still lists
 * but that is MISSING from the target tree is never silently skipped --
 * without this, iterating target files alone would simply never produce
 * an entry for it at all (found as a real gap while building this
 * module, fixed before any test was written against it).
 */
function enumerateDbFilesUnderFolder(database, folderId) {
  const statement = database.prepare(`
    WITH RECURSIVE tree(id, relpath) AS (
      SELECT ?, ''
      UNION ALL
      SELECT folder.id, CASE WHEN tree.relpath = '' THEN folder.name ELSE tree.relpath || '\\' || folder.name END
      FROM folder
      JOIN tree ON folder.parentfolderid = tree.id
    )
    SELECT
      tree.relpath AS folder_relpath,
      CAST(file.id AS TEXT) AS id_text,
      file.name AS file_name,
      CAST(file.hash AS TEXT) AS hash_text,
      file.size AS size
    FROM file
    JOIN tree ON file.parentfolderid = tree.id
  `)
  return statement.all(BigInt(folderId)).map((row) => ({
    relativePath: row.folder_relpath === '' ? row.file_name : `${row.folder_relpath}\\${row.file_name}`,
    fileId: row.id_text,
    pCloudHash: row.hash_text,
    dbSizeBytes: row.size,
  }))
}

async function checkEmptyWorkspace({ targetCaseRoot, databasePath, topLevelFolderName, caseRelativePath }) {
  const parts = caseRelativePath.split(/[\\/]/)
  assert(parts.every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part)), 'CASE_RELATIVE_PATH_INVALID')
  const nameKey = name => name.normalize('NFC').toUpperCase()
  // Reject aliases/reparse points in ancestors as well as inside the case.
  for (let current = path.resolve(targetCaseRoot); ; current = path.dirname(current)) {
    const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (info) assert(info.isDirectory() && !info.isSymbolicLink(), 'WORKSPACE_PATH_CONFLICT')
    if (current === path.dirname(current)) break
  }
  async function hasLocalContent(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    let content = false
    const names = new Set()
    for (const entry of entries) {
      assert(!entry.isSymbolicLink() && !CONFLICT_NAME_PATTERN.test(entry.name) && !names.has(nameKey(entry.name)), 'WORKSPACE_PATH_CONFLICT')
      names.add(nameKey(entry.name))
      if (!entry.isDirectory() || await hasLocalContent(path.join(directory, entry.name))) content = true
    }
    return content
  }
  const localContent = await hasLocalContent(targetCaseRoot)
  const remoteContent = await withConsistentPcloudDatabase(databasePath, database => {
    let folderId = resolveTopLevelFolderId(database, topLevelFolderName)
    // Folder tasks (including pending deletes/moves) cannot be treated as an
    // empty, stable namespace. Unrelated cases do not block provisioning.
    const fstaskColumns = database.prepare('PRAGMA table_info(fstask)').all().map(row => row.name)
    const hasUploadTasks = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='upload_tasks'").get() !== undefined
    function assertIdle(id) {
      assert(getTaskReferenceCount(database, id) === 0, 'WORKSPACE_SYNC_PENDING')
      for (const column of ['folderid', 'sfolderid']) {
        if (fstaskColumns.includes(column)) assert(database.prepare(`SELECT count(*) AS n FROM fstask WHERE ${column} = ?`).get(BigInt(id)).n === 0, 'WORKSPACE_SYNC_PENDING')
      }
      if (hasUploadTasks) assert(database.prepare('SELECT count(*) AS n FROM upload_tasks WHERE parentfid = ?').get(BigInt(id)).n === 0, 'WORKSPACE_SYNC_PENDING')
    }
    for (const part of parts) {
      assertIdle(folderId)
      const files = database.prepare('SELECT name FROM file WHERE parentfolderid = ?').all(BigInt(folderId))
      assert(!files.some(row => nameKey(row.name) === nameKey(part)), 'WORKSPACE_PATH_CONFLICT')
      const folders = database.prepare('SELECT CAST(id AS TEXT) AS id, name FROM folder WHERE parentfolderid = ?').all(BigInt(folderId)).filter(row => nameKey(row.name) === nameKey(part))
      assert(folders.length <= 1 && (!folders.length || folders[0].name === part), 'WORKSPACE_PATH_CONFLICT')
      if (!folders.length) return false
      folderId = folders[0].id
    }
    assert(findAllConflictNames(database, folderId).length === 0, 'WORKSPACE_PATH_CONFLICT')
    const subtree = database.prepare(`WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT folder.id FROM folder JOIN tree ON folder.parentfolderid=tree.id) SELECT CAST(id AS TEXT) AS id FROM tree`).all(BigInt(folderId))
    for (const row of subtree) {
      assertIdle(row.id)
      const names = database.prepare('SELECT name FROM folder WHERE parentfolderid = ?').all(BigInt(row.id)).map(entry => nameKey(entry.name))
      assert(new Set(names).size === names.length, 'WORKSPACE_PATH_CONFLICT')
    }
    return enumerateDbFilesUnderFolder(database, folderId).length > 0
  })
  return !localContent && !remoteContent
}

export async function determineSessionSafeCaseStatus({
  targetCaseRoot,
  databasePath,
  topLevelFolderName,
  caseRelativePath,
  attestationStoreDirectory,
  operation,
}) {
  assert(typeof targetCaseRoot === 'string' && targetCaseRoot.length > 0, 'TARGET_CASE_ROOT_REQUIRED')
  assert(typeof databasePath === 'string' && databasePath.length > 0, 'DATABASE_PATH_REQUIRED')
  assert(typeof topLevelFolderName === 'string' && topLevelFolderName.length > 0, 'TOP_LEVEL_FOLDER_NAME_REQUIRED')
  assert(typeof caseRelativePath === 'string' && caseRelativePath.length > 0, 'CASE_RELATIVE_PATH_REQUIRED')
  assert(typeof attestationStoreDirectory === 'string' && attestationStoreDirectory.length > 0, 'ATTESTATION_STORE_DIRECTORY_REQUIRED')
  assert(operation === undefined || operation === 'workspace', 'OPERATION_INVALID')

  // Provisioning only adds directories. An absent/empty tree has no content
  // revision to attest. Check both inventories before allowing this limited
  // operation; any existing content still uses the unchanged freshness gate.
  if (operation === 'workspace') {
    const empty = await checkEmptyWorkspace({ targetCaseRoot, databasePath, topLevelFolderName, caseRelativePath })
    if (empty) return {
      SchemaVersion: 'hasarbotu-pcloud-session0-freshness-gate/1.0.0',
      GeneratedAtUtc: new Date().toISOString(), CaseRelativePath: caseRelativePath,
      CaseStatus: 'ready', Operation: 'workspace', Reason: 'EMPTY_WORKSPACE_CREATE_OR_RESUME',
      Entries: [], ConflictNamesFound: [],
      Summary: { TotalFiles: 0, ReadyCount: 0, SyncingCount: 0, UnknownCount: 0, ConflictCount: 0 },
    }
  }

  const targetStat = await stat(targetCaseRoot).catch(() => null)
  assert(targetStat && targetStat.isDirectory(), 'TARGET_CASE_ROOT_NOT_FOUND')

  const caseRelativeParts = caseRelativePath.split(/[\\/]+/).filter((part) => part.length > 0)
  const targetFiles = await enumerateFilesRecursive(targetCaseRoot)

  // ONE consistent DB snapshot covers conflict-name detection AND every
  // file's DB row resolution -- a single point-in-time view, not one
  // snapshot per file.
  const dbContext = await withConsistentPcloudDatabase(databasePath, (database) => {
    const topId = resolveTopLevelFolderId(database, topLevelFolderName)
    const caseFolderId = resolveFolderIdByRelativeDirParts(database, topId, caseRelativeParts)
    assert(caseFolderId !== null, 'PCLOUD_CASE_FOLDER_NOT_FOUND')
    const conflictNames = findAllConflictNames(database, caseFolderId)
    const dbFiles = enumerateDbFilesUnderFolder(database, caseFolderId)
    const dbFilesByRelativePath = new Map(dbFiles.map((entry) => [entry.relativePath, entry]))

    const resolutions = []
    const targetRelativePaths = new Set()
    for (const file of targetFiles) {
      targetRelativePaths.add(file.relativePath)
      const dbEntry = dbFilesByRelativePath.get(file.relativePath)
      if (dbEntry === undefined) {
        resolutions.push({ file, found: false })
        continue
      }
      const taskReferenceCount = getTaskReferenceCount(database, dbEntry.fileId)
      resolutions.push({
        file,
        found: true,
        fileId: dbEntry.fileId,
        pCloudHash: dbEntry.pCloudHash,
        taskReferenceCount,
      })
    }

    // Files pCloud's DB still lists under this case but that are ABSENT
    // from the target tree -- without this, they would simply never
    // appear anywhere (silently skipped), which is not fail-closed.
    const missingFromTarget = []
    for (const dbEntry of dbFiles) {
      if (targetRelativePaths.has(dbEntry.relativePath)) continue
      const taskReferenceCount = getTaskReferenceCount(database, dbEntry.fileId)
      missingFromTarget.push({
        relativePath: dbEntry.relativePath,
        fileId: dbEntry.fileId,
        pCloudHash: dbEntry.pCloudHash,
        taskReferenceCount,
      })
    }

    return { caseFolderId, conflictNames, resolutions, missingFromTarget }
  })

  const entries = []
  for (const missing of dbContext.missingFromTarget) {
    entries.push({
      RelativePath: missing.relativePath,
      FileStatus: missing.taskReferenceCount > 0 ? 'syncing' : 'unknown',
      Reason: missing.taskReferenceCount > 0 ? 'FILE_MISSING_FROM_TARGET_LIVE_TASK' : 'FILE_MISSING_FROM_TARGET',
      FileId: missing.fileId,
      PCloudHash: missing.pCloudHash,
    })
  }
  for (const resolution of dbContext.resolutions) {
    if (!resolution.found) {
      entries.push({
        RelativePath: resolution.file.relativePath,
        FileStatus: 'unknown',
        Reason: 'PCLOUD_DB_ROW_NOT_FOUND',
      })
      continue
    }

    const targetSha256 = await fileSha256(resolution.file.fullPath)
    const attestation = await readAttestationRecord(attestationStoreDirectory, resolution.fileId, resolution.pCloudHash)

    if (attestation === null) {
      if (resolution.taskReferenceCount > 0) {
        entries.push({
          RelativePath: resolution.file.relativePath,
          FileStatus: 'syncing',
          Reason: 'NO_ATTESTATION_FOR_CURRENT_REVISION_LIVE_TASK',
          FileId: resolution.fileId,
          PCloudHash: resolution.pCloudHash,
          TaskReferenceCount: resolution.taskReferenceCount,
        })
      } else {
        entries.push({
          RelativePath: resolution.file.relativePath,
          FileStatus: 'unknown',
          Reason: 'NO_ATTESTATION_FOR_CURRENT_REVISION',
          FileId: resolution.fileId,
          PCloudHash: resolution.pCloudHash,
        })
      }
      continue
    }

    if (attestation.Sha256 === targetSha256) {
      entries.push({
        RelativePath: resolution.file.relativePath,
        FileStatus: 'ready',
        FileId: resolution.fileId,
        PCloudHash: resolution.pCloudHash,
        AttestedAtUtc: attestation.AttestedAtUtc,
      })
    } else {
      entries.push({
        RelativePath: resolution.file.relativePath,
        FileStatus: 'conflict',
        Reason: 'ATTESTATION_SHA256_MISMATCH',
        FileId: resolution.fileId,
        PCloudHash: resolution.pCloudHash,
      })
    }
  }

  const conflictNameEntries = dbContext.conflictNames.map((name) => ({
    RelativePath: name,
    FileStatus: 'conflict',
    Reason: 'PCLOUD_CONFLICT_NAME_PATTERN',
  }))

  const allStatuses = [...entries, ...conflictNameEntries].map((entry) => entry.FileStatus)
  const caseStatus = allStatuses.length === 0
    ? 'unknown'
    : allStatuses.reduce((worst, status) => (
      STATUS_PRECEDENCE[status] > STATUS_PRECEDENCE[worst] ? status : worst
    ), 'ready')

  return {
    SchemaVersion: 'hasarbotu-pcloud-session0-freshness-gate/1.0.0',
    GeneratedAtUtc: new Date().toISOString(),
    CaseRelativePath: caseRelativePath,
    CaseStatus: caseStatus,
    Entries: entries,
    ConflictNamesFound: dbContext.conflictNames,
    Summary: {
      TotalFiles: entries.length,
      ReadyCount: entries.filter((entry) => entry.FileStatus === 'ready').length,
      SyncingCount: entries.filter((entry) => entry.FileStatus === 'syncing').length,
      UnknownCount: entries.filter((entry) => entry.FileStatus === 'unknown').length,
      ConflictCount: entries.filter((entry) => entry.FileStatus === 'conflict').length + conflictNameEntries.length,
    },
  }
}

// --- CLI entry point (Session-0-safe: no --source-root / --ghost-manifest
// exists in this argument set at all, unlike pcloud-case-reconciliation.mjs
// -- there is structurally nothing here that could default to P:\). ---

function parseArguments(argv) {
  const allowed = new Set([
    '--target-root',
    '--top-level-folder-name',
    '--case-relative-path',
    '--pcloud-db',
    '--attestation-store',
    '--operation',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'ARGUMENT_INVALID')
    assert(!values.has(key), 'ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  for (const key of allowed) if (key !== '--operation') assert(values.has(key), 'ARGUMENT_MISSING')
  return {
    targetCaseRoot: values.get('--target-root'),
    topLevelFolderName: values.get('--top-level-folder-name'),
    caseRelativePath: values.get('--case-relative-path'),
    databasePath: values.get('--pcloud-db'),
    attestationStoreDirectory: values.get('--attestation-store'),
    operation: values.get('--operation'),
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const report = await determineSessionSafeCaseStatus(args)
    emit(report, report.CaseStatus === 'ready' ? 0 : 2)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-pcloud-session0-freshness-gate/1.0.0',
      Status: 'error',
      ReadOnly: true,
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'SESSION0_FRESHNESS_GATE_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
