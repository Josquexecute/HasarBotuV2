import { pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  getExactGhostRootId,
  getTextSetting,
  loadGhostManifest,
  withConsistentPcloudDatabase,
} from './pcloud-maintenance-window-gate.mjs'

// D8 stale-target-file repair — read-only pCloud DB state probe (HB-2026-130).
//
// This module is READ-ONLY: it never writes to pCloud's database, source,
// target, env or services. It exists to give the repair wrapper
// (repair-post-sync-stale-target-files.ps1) a FRESH, live answer — at the
// moment of repair, not from a possibly-stale earlier forensic report — to
// three questions for one exact relative path:
//   1. What file id does this relative path currently resolve to under the
//      exact ghost-manifest root, and what is its CURRENT (size, mtime,
//      flags) row plus full filerevision history?
//   2. Does ANY task/fstask row currently reference that file id (pending
//      work or a recorded conflict/error against it)?
//   3. Is pCloud's diff flow actually running right now (runstatus)?
// It does not decide anything; the wrapper compares this against its own
// independently-recomputed source/target SHA-256 values before touching
// any file.

class SafeError extends Error {
  constructor(safeCode) {
    super(safeCode)
    this.name = 'SafeError'
    this.safeCode = safeCode
  }
}
function fail(safeCode) { throw new SafeError(safeCode) }
function assert(condition, safeCode) { if (!condition) fail(safeCode) }

function safeInteger(value, safeCode) {
  const number = Number(value)
  assert(Number.isSafeInteger(number) && number >= 0, safeCode)
  return number
}

function parseArguments(argv) {
  const allowed = new Set([
    '--source-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--relative-path',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'ARGUMENT_INVALID')
    assert(!values.has(key), 'ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  for (const key of ['--source-root', '--ghost-manifest', '--ghost-manifest-sha256', '--pcloud-db', '--relative-path']) {
    assert(values.has(key), 'ARGUMENT_MISSING')
  }
  return {
    sourceRoot: values.get('--source-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256: values.get('--ghost-manifest-sha256'),
    pcloudDatabasePath: values.get('--pcloud-db'),
    relativePath: values.get('--relative-path'),
  }
}

function resolveFolderIdByRelativePath(db, rootId, relativeDirParts) {
  let currentId = rootId
  for (const segment of relativeDirParts) {
    const row = db.prepare(
      'SELECT CAST(id AS TEXT) AS id_text FROM folder WHERE parentfolderid = ? AND name = ?',
    ).get(BigInt(currentId), segment)
    if (!row) return null
    currentId = row.id_text
  }
  return currentId
}

function getCurrentFileRow(db, folderId, fileName) {
  return db.prepare(`
    SELECT CAST(id AS TEXT) AS id_text, name, size, CAST(hash AS TEXT) AS hash_text, flags, ctime, mtime
    FROM file WHERE parentfolderid = ? AND name = ?
  `).get(BigInt(folderId), fileName)
}

function getRevisionHistory(db, fileId) {
  return db.prepare(`
    SELECT CAST(hash AS TEXT) AS hash_text, ctime, size
    FROM filerevision WHERE fileid = ? ORDER BY ctime ASC
  `).all(BigInt(fileId))
}

function getTaskReferenceCount(db, fileId) {
  const taskRow = db.prepare(
    'SELECT count(*) AS c FROM task WHERE itemid = ? OR localitemid = ? OR newitemid = ?',
  ).get(BigInt(fileId), BigInt(fileId), BigInt(fileId))
  const fstaskRow = db.prepare('SELECT count(*) AS c FROM fstask WHERE fileid = ?').get(BigInt(fileId))
  return safeInteger(taskRow.c, 'TASK_COUNT_INVALID') + safeInteger(fstaskRow.c, 'FSTASK_COUNT_INVALID')
}

export async function getStaleTargetFileState(args) {
  const ghost = await loadGhostManifest(args.manifestPath, args.manifestSha256, args.sourceRoot)
  return withConsistentPcloudDatabase(args.pcloudDatabasePath, (db) => {
    const runStatus = getTextSetting(db, 'runstatus', 'PCLOUD_RUN_STATUS_MISSING')
    assert(runStatus === '1', 'PCLOUD_DIFF_FLOW_NOT_RUNNING')
    const rootId = getExactGhostRootId(db, ghost)

    const parts = args.relativePath.split(/[\\/]+/).filter((p) => p.length > 0)
    assert(parts.length >= 2, 'RELATIVE_PATH_TOO_SHORT')
    const fileName = parts[parts.length - 1]
    const dirParts = parts.slice(0, -1)

    const folderId = resolveFolderIdByRelativePath(db, rootId, dirParts)
    if (folderId === null) {
      return { found: false, runStatus, relativePath: args.relativePath }
    }
    const currentRow = getCurrentFileRow(db, folderId, fileName)
    if (!currentRow) {
      return { found: false, runStatus, relativePath: args.relativePath }
    }
    const revisions = getRevisionHistory(db, currentRow.id_text)
    const taskReferenceCount = getTaskReferenceCount(db, currentRow.id_text)

    return {
      found: true,
      runStatus,
      relativePath: args.relativePath,
      fileId: currentRow.id_text,
      currentRow: {
        size: safeInteger(currentRow.size, 'CURRENT_ROW_SIZE_INVALID'),
        hash: currentRow.hash_text,
        flags: currentRow.flags,
        ctime: currentRow.ctime,
        mtime: currentRow.mtime,
      },
      revisions: revisions.map((r) => ({
        hash: r.hash_text,
        ctime: r.ctime,
        size: safeInteger(r.size, 'REVISION_SIZE_INVALID'),
      })),
      taskReferenceCount,
    }
  })
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const state = await getStaleTargetFileState(args)
    emit({ Status: 'ok', ...state }, 0)
  } catch (error) {
    emit({
      Status: 'error',
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'STALE_TARGET_FILE_STATE_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
