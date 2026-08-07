import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  enumerateSourceTree,
  getExactGhostRootId,
  getPcloudTaskState,
  getTextSetting,
  loadGhostManifest,
  windowsPathEqual,
  withConsistentPcloudDatabase,
} from './pcloud-maintenance-window-gate.mjs'

// D8 post-sync source/target diff forensics (HB-2026-131 follow-up).
//
// This module is READ-ONLY: it never writes to pCloud's database, source,
// target, env or services. It exists to isolate WHICH file(s) cause a
// SOURCE_TARGET_HASH_MISMATCH_AT_PASS verdict from
// pcloud-post-sync-rebaseline-gate.mjs, which only reports an aggregate
// manifest hash mismatch with no per-file detail. It hashes every file in
// both trees individually (source with the ghost exclusion set applied,
// target with none — matching the rebaseline gate's own comparison rule),
// diffs the two by relative path, and for every non-identical entry looks
// up pCloud's live per-file state (current object row + full filerevision
// history + task/fstask reference count), the same read-only technique
// already proven in pcloud-stale-target-file-state.mjs (HB-2026-130).
//
// Every entry is classified exactly one of:
//   - missing:           present in source, absent in target
//   - extra:              present in target, absent in source
//   - content_mismatch:   present in both, SHA-256 differs
//   - metadata_only:      present in both, SHA-256 identical, but recorded
//                          mtime differs (content is provably identical;
//                          informational only, never a real inconsistency)
// Identical entries (same SHA-256 and same mtime) are not included in the
// report body, only counted.

export const CONFLICT_NAME_PATTERN = /\(conflicted copy|conflicted copy \d+|\.deleted\b/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const EMPTY_EXCLUDED_PATHS = new Set()

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

function safeInteger(value, safeCode) {
  const number = Number(value)
  assert(Number.isSafeInteger(number) && number >= 0, safeCode)
  return number
}

function canonicalRelativePath(value) {
  return value.split(path.sep).join('\\')
}

function foldWindows(value) {
  return value.normalize('NFC').toLocaleUpperCase('tr-TR')
}

function parseArguments(argv) {
  const allowed = new Set([
    '--source-root',
    '--target-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--progress-interval',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'ARGUMENT_INVALID')
    assert(!values.has(key), 'ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  for (const key of ['--source-root', '--target-root', '--ghost-manifest', '--ghost-manifest-sha256', '--pcloud-db']) {
    assert(values.has(key), 'ARGUMENT_MISSING')
  }
  const manifestSha256 = values.get('--ghost-manifest-sha256')
  assert(SHA256_PATTERN.test(manifestSha256), 'GHOST_EXCLUSION_HASH_INVALID')
  const progressIntervalRaw = values.get('--progress-interval') ?? '500'
  assert(/^[0-9]+$/.test(progressIntervalRaw), 'PROGRESS_INTERVAL_INVALID')
  return {
    sourceRoot: values.get('--source-root'),
    targetRoot: values.get('--target-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256,
    pcloudDatabasePath: values.get('--pcloud-db'),
    progressInterval: Number(progressIntervalRaw),
  }
}

function normalizeWindowsRoot(value) {
  return path.win32.normalize(path.win32.resolve(value)).replace(/[\\/]+$/, '')
}

export async function fileSha256(fullPath) {
  const hasher = createHash('sha256')
  for await (const chunk of createReadStream(fullPath, { flags: 'r' })) {
    hasher.update(chunk)
  }
  return hasher.digest('hex')
}

async function isNotLockedForWrite(fullPath) {
  // Best-effort probe only (mirrors repair-post-sync-stale-target-files.ps1's
  // Test-FileNotLockedForWrite): open shared-read, close immediately. Never
  // opens for write, never deletes, never renames.
  try {
    const handle = await stat(fullPath)
    if (!handle.isFile()) return false
    const stream = createReadStream(fullPath, { flags: 'r', highWaterMark: 1 })
    await new Promise((resolve, reject) => {
      stream.once('open', () => { stream.close(); resolve() })
      stream.once('error', reject)
    })
    return true
  } catch {
    return false
  }
}

async function hashTreeDetailed(root, excludedPaths, progressInterval, label, scopeRelativePath) {
  const inventory = await enumerateSourceTree(root, excludedPaths, scopeRelativePath ? { scopeRelativePath } : undefined)
  const byKey = new Map()
  let processed = 0
  for (const record of inventory.files) {
    const sha256 = await fileSha256(record.fullPath)
    const relativeKey = foldWindows(path.win32.normalize(record.relativePath))
    byKey.set(relativeKey, {
      relativePath: record.relativePath,
      fullPath: record.fullPath,
      size: record.size,
      mtimeNs: record.mtimeNs,
      sha256,
    })
    processed += 1
    if (progressInterval > 0 && processed % progressInterval === 0) {
      process.stderr.write(`DIFF_HASH_PROGRESS side=${label} processed=${processed} total=${inventory.fileCount}\n`)
    }
  }
  return { byKey, fileCount: inventory.fileCount, bytes: inventory.bytes }
}

export function resolveFolderIdByRelativeDirParts(database, rootId, relativeDirParts) {
  let currentId = rootId
  for (const segment of relativeDirParts) {
    const row = database.prepare(
      'SELECT CAST(id AS TEXT) AS id_text FROM folder WHERE parentfolderid = ? AND name = ?',
    ).get(BigInt(currentId), segment)
    if (!row) return null
    currentId = row.id_text
  }
  return currentId
}

export function getCurrentFileRow(database, folderId, fileName) {
  return database.prepare(`
    SELECT CAST(id AS TEXT) AS id_text, name, size, CAST(hash AS TEXT) AS hash_text, flags, ctime, mtime
    FROM file WHERE parentfolderid = ? AND name = ?
  `).get(BigInt(folderId), fileName)
}

export function getRevisionHistory(database, fileId) {
  return database.prepare(`
    SELECT CAST(hash AS TEXT) AS hash_text, ctime, size
    FROM filerevision WHERE fileid = ? ORDER BY ctime ASC
  `).all(BigInt(fileId))
}

export function getTaskReferenceCount(database, fileId) {
  const taskRow = database.prepare(
    'SELECT count(*) AS c FROM task WHERE itemid = ? OR localitemid = ? OR newitemid = ?',
  ).get(BigInt(fileId), BigInt(fileId), BigInt(fileId))
  const fstaskRow = database.prepare('SELECT count(*) AS c FROM fstask WHERE fileid = ?').get(BigInt(fileId))
  return safeInteger(taskRow.c, 'TASK_COUNT_INVALID') + safeInteger(fstaskRow.c, 'FSTASK_COUNT_INVALID')
}

export function findAllConflictNames(database, rootId) {
  const statement = database.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT ?
      UNION ALL
      SELECT folder.id
      FROM folder
      JOIN tree ON folder.parentfolderid = tree.id
    )
    SELECT folder.name AS name
    FROM folder
    JOIN tree ON folder.id = tree.id
    WHERE folder.id <> ?
    UNION ALL
    SELECT file.name AS name
    FROM file
    JOIN tree ON file.parentfolderid = tree.id
  `)
  const rows = statement.all(BigInt(rootId), BigInt(rootId))
  return rows.filter((row) => CONFLICT_NAME_PATTERN.test(row.name)).map((row) => row.name)
}

function resolvePcloudFileState(database, rootId, relativePath) {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part.length > 0)
  if (parts.length < 1) return { found: false }
  const fileName = parts[parts.length - 1]
  const dirParts = parts.slice(0, -1)
  const folderId = resolveFolderIdByRelativeDirParts(database, rootId, dirParts)
  if (folderId === null) return { found: false }
  const currentRow = getCurrentFileRow(database, folderId, fileName)
  if (!currentRow) return { found: false }
  const revisions = getRevisionHistory(database, currentRow.id_text)
  const taskReferenceCount = getTaskReferenceCount(database, currentRow.id_text)
  return {
    found: true,
    fileId: currentRow.id_text,
    currentRow: {
      size: safeInteger(currentRow.size, 'CURRENT_ROW_SIZE_INVALID'),
      hash: currentRow.hash_text,
      flags: currentRow.flags,
      ctime: currentRow.ctime,
      mtime: currentRow.mtime,
    },
    revisions: revisions.map((row) => ({
      hash: row.hash_text,
      ctime: row.ctime,
      size: safeInteger(row.size, 'REVISION_SIZE_INVALID'),
    })),
    taskReferenceCount,
  }
}

function classifyEntry(sourceEntry, targetEntry) {
  if (sourceEntry && !targetEntry) return 'missing'
  if (!sourceEntry && targetEntry) return 'extra'
  if (sourceEntry.sha256 !== targetEntry.sha256) return 'content_mismatch'
  if (sourceEntry.size !== targetEntry.size || sourceEntry.mtimeNs !== targetEntry.mtimeNs) return 'metadata_only'
  return 'identical'
}

function unixSecondsFromMtimeNs(mtimeNs) {
  return Math.floor(Number(BigInt(mtimeNs) / 1000000000n))
}

function classifyCurrency(classification, sourceEntry, targetEntry, pcloudState) {
  if (classification === 'missing') return 'source_only_target_missing'
  if (classification === 'extra') return 'target_only_no_source_counterpart'
  if (classification === 'metadata_only') return 'content_identical_metadata_differs'
  if (classification !== 'content_mismatch') return 'not_applicable'
  if (!pcloudState?.found) return 'ambiguous_pcloud_row_not_found'

  const sourceMatchesCurrent = safeInteger(pcloudState.currentRow.size, 'CURRENT_ROW_SIZE_INVALID') === sourceEntry.size
    && pcloudState.currentRow.mtime === unixSecondsFromMtimeNs(sourceEntry.mtimeNs)
  const targetMatchesRevision = pcloudState.revisions.some((revision) => revision.size === targetEntry.size)

  if (sourceMatchesCurrent && targetMatchesRevision) return 'source_current_target_superseded'
  if (sourceMatchesCurrent && !targetMatchesRevision) return 'source_current_target_unexplained'
  if (!sourceMatchesCurrent) {
    const targetMatchesCurrent = safeInteger(pcloudState.currentRow.size, 'CURRENT_ROW_SIZE_INVALID') === targetEntry.size
      && pcloudState.currentRow.mtime === unixSecondsFromMtimeNs(targetEntry.mtimeNs)
    if (targetMatchesCurrent) return 'target_current_source_stale'
  }
  return 'ambiguous'
}

export async function buildDiffForensicsReport(args) {
  const sourceRoot = normalizeWindowsRoot(args.sourceRoot)
  const targetRoot = normalizeWindowsRoot(args.targetRoot)
  const ghost = await loadGhostManifest(args.manifestPath, args.manifestSha256, sourceRoot)
  const rootId = await withConsistentPcloudDatabase(args.pcloudDatabasePath, (database) => getExactGhostRootId(database, ghost))

  // HB-2026-162 (per-case reconciliation): when args.caseRelativePath is
  // given, only that subtree is walked/hashed on both sides — everything
  // else below (Classification/Currency/PCloud-per-file logic) is
  // unchanged. Omitting it preserves exact prior whole-tree behavior.
  const caseRelativePath = args.caseRelativePath ?? null
  const source = await hashTreeDetailed(sourceRoot, ghost.excludedPaths, args.progressInterval, 'source', caseRelativePath)
  const target = await hashTreeDetailed(targetRoot, EMPTY_EXCLUDED_PATHS, args.progressInterval, 'target', caseRelativePath)

  const allKeys = new Set([...source.byKey.keys(), ...target.byKey.keys()])
  const diffEntries = []
  const counts = { missing: 0, extra: 0, content_mismatch: 0, metadata_only: 0, identical: 0 }

  for (const key of allKeys) {
    const sourceEntry = source.byKey.get(key) ?? null
    const targetEntry = target.byKey.get(key) ?? null
    const classification = classifyEntry(sourceEntry, targetEntry)
    counts[classification] += 1
    if (classification === 'identical') continue
    diffEntries.push({ key, sourceEntry, targetEntry, classification })
  }
  diffEntries.sort((left, right) => {
    const leftPath = left.sourceEntry?.relativePath ?? left.targetEntry?.relativePath ?? ''
    const rightPath = right.sourceEntry?.relativePath ?? right.targetEntry?.relativePath ?? ''
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
  })

  const { globalQueueState, conflictNames, runStatus, conflictScanRootId } = await withConsistentPcloudDatabase(args.pcloudDatabasePath, (database) => {
    const taskState = getPcloudTaskState(database)
    const status = getTextSetting(database, 'runstatus', 'PCLOUD_RUN_STATUS_MISSING')
    let scanRootId = rootId
    if (caseRelativePath !== null) {
      const caseFolderId = resolveFolderIdByRelativeDirParts(database, rootId, caseRelativePath.split(/[\\/]+/).filter((part) => part.length > 0))
      // A case folder that doesn't exist yet in pCloud's remote tree (e.g.
      // never synced) has no conflict names to find — that's a fact, not
      // an error; fall back to an empty scan rather than the whole tenant
      // tree, preserving per-case isolation (INV-3).
      scanRootId = caseFolderId
    }
    const names = scanRootId === null ? [] : findAllConflictNames(database, scanRootId)
    return { globalQueueState: taskState, conflictNames: names, runStatus: status, conflictScanRootId: scanRootId }
  })

  const entries = []
  for (const diff of diffEntries) {
    const relativePath = diff.sourceEntry?.relativePath ?? diff.targetEntry?.relativePath
    // eslint-disable-next-line no-await-in-loop
    const pcloudState = await withConsistentPcloudDatabase(args.pcloudDatabasePath, (database) => resolvePcloudFileState(database, rootId, relativePath))
    const currency = classifyCurrency(diff.classification, diff.sourceEntry, diff.targetEntry, pcloudState)
    // eslint-disable-next-line no-await-in-loop
    const sourceLockOk = diff.sourceEntry ? await isNotLockedForWrite(diff.sourceEntry.fullPath) : null
    // eslint-disable-next-line no-await-in-loop
    const targetLockOk = diff.targetEntry ? await isNotLockedForWrite(diff.targetEntry.fullPath) : null

    entries.push({
      RelativePath: relativePath,
      FileExtension: path.extname(relativePath).toLowerCase() || null,
      Classification: diff.classification,
      Currency: currency,
      Source: diff.sourceEntry ? {
        FullPath: diff.sourceEntry.fullPath,
        Size: diff.sourceEntry.size,
        LastWriteTimeUtc: new Date(unixSecondsFromMtimeNs(diff.sourceEntry.mtimeNs) * 1000).toISOString(),
        Sha256: diff.sourceEntry.sha256,
        NotLockedForWrite: sourceLockOk,
      } : null,
      Target: diff.targetEntry ? {
        FullPath: diff.targetEntry.fullPath,
        Size: diff.targetEntry.size,
        LastWriteTimeUtc: new Date(unixSecondsFromMtimeNs(diff.targetEntry.mtimeNs) * 1000).toISOString(),
        Sha256: diff.targetEntry.sha256,
        NotLockedForWrite: targetLockOk,
      } : null,
      PCloud: pcloudState.found ? {
        found: true,
        FileId: pcloudState.fileId,
        CurrentRow: pcloudState.currentRow,
        Revisions: pcloudState.revisions,
        TaskReferenceCount: pcloudState.taskReferenceCount,
      } : { found: false },
    })
  }

  return {
    SchemaVersion: 'pcloud-post-sync-diff-forensics/1.0.0',
    Status: 'ok',
    ReadOnly: true,
    GeneratedAtUtc: new Date().toISOString(),
    CaseRelativePath: caseRelativePath,
    GhostExclusion: {
      ManifestSha256: ghost.manifestSha256,
      EntryCount: ghost.excludedPaths.size,
    },
    PCloudRunStatus: runStatus,
    PCloudQueueState: globalQueueState,
    ConflictNamesFound: conflictNames,
    Summary: {
      SourceFileCount: source.fileCount,
      SourceBytes: source.bytes,
      TargetFileCount: target.fileCount,
      TargetBytes: target.bytes,
      Counts: counts,
    },
    Entries: entries,
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const report = await buildDiffForensicsReport(args)
    const hasDifference = report.Summary.Counts.missing > 0
      || report.Summary.Counts.extra > 0
      || report.Summary.Counts.content_mismatch > 0
      || report.Summary.Counts.metadata_only > 0
    emit(report, hasDifference ? 2 : 0)
  } catch (error) {
    emit({
      SchemaVersion: 'pcloud-post-sync-diff-forensics/1.0.0',
      Status: 'error',
      ReadOnly: true,
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'DIFF_FORENSICS_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()

export { classifyCurrency, classifyEntry, windowsPathEqual }
