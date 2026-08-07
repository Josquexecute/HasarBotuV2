import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdtemp,
  opendir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MINIMUM_QUIET_SECONDS = 600
const DEFAULT_POLL_SECONDS = 15
const DEFAULT_MAXIMUM_SECONDS = 1800
const DATABASE_SNAPSHOT_ATTEMPTS = 5
const DATABASE_SNAPSHOT_RETRY_DELAY_MS = 250
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const DECIMAL_ID_PATTERN = /^[1-9][0-9]*$/

class SafeGateError extends Error {
  constructor(safeCode, safeDetails = null) {
    super(safeCode)
    this.name = 'SafeGateError'
    this.safeCode = safeCode
    this.safeDetails = safeDetails
  }
}

function fail(safeCode, safeDetails = null) {
  throw new SafeGateError(safeCode, safeDetails)
}

function assert(condition, safeCode) {
  if (!condition) fail(safeCode)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ordinalCompare(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeWindowsPath(value) {
  return path.win32.normalize(path.win32.resolve(value)).replace(/[\\/]+$/, '')
}

function foldWindows(value) {
  return value.normalize('NFC').toLocaleUpperCase('tr-TR')
}

export function windowsPathEqual(left, right) {
  return foldWindows(normalizeWindowsPath(left)) === foldWindows(normalizeWindowsPath(right))
}

function canonicalRelativePath(value) {
  return value.split(path.sep).join('\\')
}

function stableMapDigest(entries) {
  return sha256([...entries.entries()]
    .sort(([left], [right]) => ordinalCompare(left, right))
    .map(([key, value]) => `${key}\0${value}`)
    .join('\n'))
}

function safeInteger(value, safeCode) {
  const number = Number(value)
  assert(Number.isSafeInteger(number) && number >= 0, safeCode)
  return number
}

function parseIntegerArgument(value, minimum, safeCode) {
  assert(typeof value === 'string' && /^[0-9]+$/.test(value), safeCode)
  const parsed = Number(value)
  assert(Number.isSafeInteger(parsed) && parsed >= minimum, safeCode)
  return parsed
}

function parseArguments(argv) {
  const allowed = new Set([
    '--mode',
    '--source-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--maintenance-report',
    '--poll-seconds',
    '--maximum-seconds',
    '--progress-interval',
  ])
  const values = new Map()

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'GATE_ARGUMENT_INVALID')
    assert(!values.has(key), 'GATE_ARGUMENT_DUPLICATE')
    values.set(key, value)
  }

  const mode = values.get('--mode') ?? 'gate'
  assert(['gate', 'probe', 'verify-current'].includes(mode), 'GATE_MODE_INVALID')
  for (const key of [
    '--source-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
  ]) {
    assert(values.has(key), 'GATE_ARGUMENT_MISSING')
  }

  const manifestSha256 = values.get('--ghost-manifest-sha256')
  assert(SHA256_PATTERN.test(manifestSha256), 'GHOST_EXCLUSION_HASH_INVALID')

  if (mode === 'verify-current') {
    assert(values.has('--maintenance-report'), 'MAINTENANCE_WINDOW_REPORT_REQUIRED')
  } else {
    assert(!values.has('--maintenance-report'), 'MAINTENANCE_WINDOW_REPORT_UNEXPECTED')
  }

  const pollSeconds = parseIntegerArgument(
    values.get('--poll-seconds') ?? String(DEFAULT_POLL_SECONDS),
    1,
    'POLL_SECONDS_INVALID',
  )
  const maximumSeconds = parseIntegerArgument(
    values.get('--maximum-seconds') ?? String(DEFAULT_MAXIMUM_SECONDS),
    MINIMUM_QUIET_SECONDS,
    'MAXIMUM_SECONDS_INVALID',
  )
  const progressInterval = parseIntegerArgument(
    values.get('--progress-interval') ?? '500',
    0,
    'PROGRESS_INTERVAL_INVALID',
  )

  return {
    mode,
    sourceRoot: values.get('--source-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256,
    pcloudDatabasePath: values.get('--pcloud-db'),
    maintenanceReportPath: values.get('--maintenance-report'),
    pollSeconds,
    maximumSeconds,
    progressInterval,
  }
}

export async function loadGhostManifest(manifestPath, expectedSha256, sourceRoot) {
  const bytes = await readFile(manifestPath)
  assert(sha256(bytes) === expectedSha256, 'GHOST_EXCLUSION_HASH_MISMATCH')

  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('GHOST_EXCLUSION_MANIFEST_JSON_INVALID')
  }

  assert(manifest?.schemaVersion === 'storage-ghost-exclusion/1.0.0', 'GHOST_EXCLUSION_SCHEMA_UNSUPPORTED')
  assert(manifest?.readOnly === true, 'GHOST_EXCLUSION_READ_ONLY_FLAG_REQUIRED')
  assert(manifest?.policy?.matchMode === 'exact_windows_path_and_pcloud_file_id', 'GHOST_EXCLUSION_MATCH_MODE_INVALID')
  assert(manifest?.policy?.wildcardsAllowed === false, 'GHOST_EXCLUSION_WILDCARD_POLICY_INVALID')
  assert(manifest?.policy?.extensionRulesAllowed === false, 'GHOST_EXCLUSION_EXTENSION_POLICY_INVALID')
  assert(manifest?.policy?.folderRulesAllowed === false, 'GHOST_EXCLUSION_FOLDER_POLICY_INVALID')
  assert(windowsPathEqual(manifest?.sourceRoot, sourceRoot), 'GHOST_EXCLUSION_SOURCE_ROOT_MISMATCH')
  assert(manifest?.entryCount === 10 && Array.isArray(manifest.entries) && manifest.entries.length === 10, 'GHOST_EXCLUSION_ENTRY_COUNT_INVALID')

  const excludedPaths = new Set()
  const fileIds = new Set()
  for (const entry of manifest.entries) {
    assert(typeof entry?.relativePath === 'string' && entry.relativePath.length > 0, 'GHOST_EXCLUSION_RELATIVE_PATH_INVALID')
    assert(!path.win32.isAbsolute(entry.relativePath), 'GHOST_EXCLUSION_RELATIVE_PATH_ABSOLUTE')
    assert(!entry.relativePath.split(/[\\/]+/).some((segment) => segment.length === 0 || segment === '.' || segment === '..'), 'GHOST_EXCLUSION_RELATIVE_PATH_UNSAFE')
    assert(DECIMAL_ID_PATTERN.test(entry?.fileId), 'GHOST_EXCLUSION_FILE_ID_INVALID')
    assert(DECIMAL_ID_PATTERN.test(entry?.parentFolderId), 'GHOST_EXCLUSION_PARENT_ID_INVALID')
    const pathKey = foldWindows(path.win32.normalize(entry.relativePath))
    assert(!excludedPaths.has(pathKey), 'GHOST_EXCLUSION_DUPLICATE_PATH')
    assert(!fileIds.has(entry.fileId), 'GHOST_EXCLUSION_DUPLICATE_FILE_ID')
    excludedPaths.add(pathKey)
    fileIds.add(entry.fileId)
  }

  return {
    manifest,
    manifestSha256: expectedSha256,
    excludedPaths,
  }
}

async function statOptional(filePath) {
  try {
    const value = await stat(filePath, { bigint: true })
    return {
      size: value.size.toString(),
      mtimeNs: value.mtimeNs.toString(),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function databaseFilesStable(before, after) {
  return before.length === after.length && before.every((value, index) => (
    value.name === after[index].name
    && value.stamp?.size === after[index].stamp?.size
    && value.stamp?.mtimeNs === after[index].stamp?.mtimeNs
  ))
}

async function captureDatabaseFiles(databasePath) {
  const names = [
    path.basename(databasePath),
    `${path.basename(databasePath)}-wal`,
    `${path.basename(databasePath)}-shm`,
  ]
  const directory = path.dirname(databasePath)
  const values = []
  for (const name of names) {
    values.push({ name, stamp: await statOptional(path.join(directory, name)) })
  }
  return values
}

export async function withConsistentPcloudDatabase(databasePath, reader) {
  for (let attempt = 1; attempt <= DATABASE_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-pcloud-ro-'))
    try {
      const before = await captureDatabaseFiles(databasePath)
      assert(before[0].stamp !== null, 'PCLOUD_LOCAL_DATABASE_NOT_FOUND')
      for (const entry of before) {
        if (entry.stamp !== null) {
          await copyFile(
            path.join(path.dirname(databasePath), entry.name),
            path.join(temporaryDirectory, entry.name),
          )
        }
      }
      const after = await captureDatabaseFiles(databasePath)
      if (!databaseFilesStable(before, after)) {
        // HB-2026-127: heavy sustained source reads (a full-tree hash pass)
        // can leave pCloud's local DB/WAL momentarily busy right afterward.
        // Retrying with zero backoff can exhaust all attempts before it
        // settles; a short pause gives a real chance to observe a stable
        // snapshot instead of failing closed on transient contention.
        if (attempt < DATABASE_SNAPSHOT_ATTEMPTS) await sleep(DATABASE_SNAPSHOT_RETRY_DELAY_MS)
        continue
      }

      const snapshotPath = path.join(temporaryDirectory, path.basename(databasePath))
      const database = new DatabaseSync(snapshotPath, { readOnly: true, timeout: 0 })
      try {
        const quickCheck = database.prepare('PRAGMA quick_check').get()
        assert(Object.values(quickCheck)[0] === 'ok', 'PCLOUD_DATABASE_SNAPSHOT_INVALID')
        return reader(database)
      } finally {
        database.close()
      }
    } catch (error) {
      if (error?.safeCode === 'PCLOUD_LOCAL_DATABASE_NOT_FOUND') throw error
      if (
        error?.safeCode
        && error.safeCode !== 'PCLOUD_DATABASE_SNAPSHOT_INVALID'
      ) throw error
      if (attempt === DATABASE_SNAPSHOT_ATTEMPTS) {
        fail('PCLOUD_DATABASE_SNAPSHOT_UNSTABLE')
      }
      await sleep(DATABASE_SNAPSHOT_RETRY_DELAY_MS)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  fail('PCLOUD_DATABASE_SNAPSHOT_UNSTABLE')
}

export function getTextSetting(database, id, safeCode) {
  const row = database.prepare('SELECT value FROM setting WHERE id = ?').get(id)
  assert(row && typeof row.value === 'string' && row.value.length > 0, safeCode)
  return row.value
}

export function getExactGhostRootId(database, ghost) {
  const getFile = database.prepare(`
    SELECT
      CAST(id AS TEXT) AS id_text,
      CAST(parentfolderid AS TEXT) AS parentfolderid_text,
      name,
      size,
      CAST(hash AS TEXT) AS hash_text,
      flags,
      ctime,
      mtime
    FROM file
    WHERE id = ?
  `)
  const getFolder = database.prepare(`
    SELECT
      CAST(id AS TEXT) AS id_text,
      CAST(parentfolderid AS TEXT) AS parentfolderid_text,
      name
    FROM folder
    WHERE id = ?
  `)
  const rootIds = new Set()

  for (const entry of ghost.manifest.entries) {
    const file = getFile.get(BigInt(entry.fileId))
    assert(file, 'GHOST_EXCLUSION_PCLOUD_ROW_MISSING')
    assert(file.id_text === entry.fileId, 'GHOST_EXCLUSION_PCLOUD_FILE_ID_MISMATCH')
    assert(file.parentfolderid_text === entry.parentFolderId, 'GHOST_EXCLUSION_PCLOUD_PARENT_ID_MISMATCH')
    assert(file.name === entry.expectedMetadata.name, 'GHOST_EXCLUSION_PCLOUD_NAME_MISMATCH')
    assert(file.size === entry.expectedMetadata.sizeBytes, 'GHOST_EXCLUSION_PCLOUD_SIZE_MISMATCH')
    assert(file.hash_text === entry.expectedMetadata.hash, 'GHOST_EXCLUSION_PCLOUD_HASH_MISMATCH')
    assert(file.flags === entry.expectedMetadata.flags, 'GHOST_EXCLUSION_PCLOUD_FLAGS_MISMATCH')
    assert(file.ctime === entry.expectedMetadata.ctimeRaw, 'GHOST_EXCLUSION_PCLOUD_CTIME_MISMATCH')
    assert(file.mtime === entry.expectedMetadata.mtimeRaw, 'GHOST_EXCLUSION_PCLOUD_MTIME_MISMATCH')

    const directorySegments = entry.relativePath.split(/[\\/]+/).slice(0, -1)
    let currentFolderId = entry.parentFolderId
    for (let index = directorySegments.length - 1; index >= 0; index -= 1) {
      const folder = getFolder.get(BigInt(currentFolderId))
      assert(folder, 'PCLOUD_REMOTE_FOLDER_CHAIN_MISSING')
      assert(foldWindows(folder.name) === foldWindows(directorySegments[index]), 'PCLOUD_REMOTE_FOLDER_CHAIN_MISMATCH')
      currentFolderId = folder.parentfolderid_text
    }
    rootIds.add(currentFolderId)
  }

  assert(rootIds.size === 1, 'PCLOUD_REMOTE_ROOT_AMBIGUOUS')
  const [rootId] = rootIds
  const root = getFolder.get(BigInt(rootId))
  assert(root, 'PCLOUD_REMOTE_ROOT_MISSING')
  assert(foldWindows(root.name) === foldWindows(path.win32.basename(ghost.manifest.sourceRoot)), 'PCLOUD_REMOTE_ROOT_NAME_MISMATCH')
  return rootId
}

export function getRemoteInventory(database, rootId) {
  const statement = database.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT ?
      UNION ALL
      SELECT folder.id
      FROM folder
      JOIN tree ON folder.parentfolderid = tree.id
    )
    SELECT
      'folder' AS kind,
      CAST(folder.id AS TEXT) AS id_text,
      CAST(folder.parentfolderid AS TEXT) AS parent_id_text,
      folder.name,
      0 AS size,
      '' AS hash_text,
      folder.flags,
      folder.ctime,
      folder.mtime,
      folder.subdircnt
    FROM folder
    JOIN tree ON folder.id = tree.id
    WHERE folder.id <> ?
    UNION ALL
    SELECT
      'file' AS kind,
      CAST(file.id AS TEXT) AS id_text,
      CAST(file.parentfolderid AS TEXT) AS parent_id_text,
      file.name,
      file.size,
      CAST(file.hash AS TEXT) AS hash_text,
      file.flags,
      file.ctime,
      file.mtime,
      0 AS subdircnt
    FROM file
    JOIN tree ON file.parentfolderid = tree.id
  `)
  const rows = statement.all(BigInt(rootId), BigInt(rootId))
  const entries = new Map()
  let fileCount = 0
  let directoryCount = 0
  let bytes = 0

  for (const row of rows) {
    const key = `${row.kind}:${row.id_text}`
    const signature = [
      row.parent_id_text,
      row.name.normalize('NFC'),
      String(row.size),
      row.hash_text,
      String(row.flags),
      String(row.ctime),
      String(row.mtime),
      String(row.subdircnt),
    ].join('\0')
    assert(!entries.has(key), 'PCLOUD_REMOTE_INVENTORY_DUPLICATE_ID')
    entries.set(key, signature)
    if (row.kind === 'file') {
      fileCount += 1
      bytes += safeInteger(row.size, 'PCLOUD_REMOTE_SIZE_INVALID')
    } else {
      directoryCount += 1
    }
  }

  return {
    entries,
    fileCount,
    directoryCount,
    bytes,
    manifestSha256: stableMapDigest(entries),
  }
}

export function getPcloudTaskState(database) {
  const taskTables = [
    'task',
    'fstask',
    'upload_tasks',
    'localfileupload',
    'uptask_fileupload',
    'pagecachetask',
  ]
  let pendingTaskCount = 0
  for (const table of taskTables) {
    const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get()
    pendingTaskCount += safeInteger(row.count, 'PCLOUD_TASK_COUNT_INVALID')
  }
  const sync = database.prepare(`
    SELECT
      (SELECT count(*) FROM syncfolder) AS active_count,
      (SELECT count(*) FROM syncfolderdelayed) AS delayed_count
  `).get()

  return {
    pendingTaskCount,
    syncRecordCount: safeInteger(sync.active_count, 'PCLOUD_SYNC_COUNT_INVALID')
      + safeInteger(sync.delayed_count, 'PCLOUD_SYNC_COUNT_INVALID'),
  }
}

export async function capturePcloudSnapshot(databasePath, ghost) {
  return withConsistentPcloudDatabase(databasePath, (database) => {
    const diffId = getTextSetting(database, 'diffid', 'PCLOUD_DIFF_CURSOR_MISSING')
    assert(/^[0-9]+$/.test(diffId), 'PCLOUD_DIFF_CURSOR_INVALID')
    const runStatus = getTextSetting(database, 'runstatus', 'PCLOUD_RUN_STATUS_MISSING')
    assert(runStatus === '1', 'PCLOUD_DIFF_FLOW_NOT_RUNNING')
    const rootId = getExactGhostRootId(database, ghost)
    const inventory = getRemoteInventory(database, rootId)
    const tasks = getPcloudTaskState(database)
    return {
      diffCursorSha256: sha256(diffId),
      rootIdentitySha256: sha256(rootId),
      runStatus,
      ...tasks,
      ...inventory,
    }
  })
}

export async function enumerateSourceTree(sourceRoot, excludedPaths, options) {
  const root = normalizeWindowsPath(sourceRoot)
  const rootInfo = await lstat(root, { bigint: true })
  assert(rootInfo.isDirectory(), 'SOURCE_ROOT_NOT_DIRECTORY')
  assert(!rootInfo.isSymbolicLink(), 'SOURCE_ROOT_REPARSE_POINT')

  // Optional scoped walk (HB-2026-162, per-case reconciliation): when
  // options.scopeRelativePath is given, only that subtree is visited, but
  // every relativePath/relativeKey below is still computed against the
  // FULL root (unchanged), so output shapes stay identical to an unscoped
  // call — callers see the same relative paths a whole-tree scan would
  // have produced for those same files. Omitting options preserves the
  // exact prior behavior (all 5 existing call sites pass no 3rd argument).
  const scopeRelativePath = options?.scopeRelativePath ?? null
  let walkStart = root
  let scopedExpectedExcludedCount = null
  if (scopeRelativePath !== null) {
    assert(typeof scopeRelativePath === 'string' && scopeRelativePath.length > 0, 'SOURCE_SCOPE_RELATIVE_PATH_INVALID')
    assert(!path.win32.isAbsolute(scopeRelativePath), 'SOURCE_SCOPE_RELATIVE_PATH_ABSOLUTE')
    assert(!scopeRelativePath.split(/[\\/]+/).some((segment) => segment.length === 0 || segment === '.' || segment === '..'), 'SOURCE_SCOPE_RELATIVE_PATH_UNSAFE')
    walkStart = path.join(root, scopeRelativePath)
    const scopeInfo = await lstat(walkStart, { bigint: true })
    assert(scopeInfo.isDirectory(), 'SOURCE_SCOPE_NOT_DIRECTORY')
    assert(!scopeInfo.isSymbolicLink(), 'SOURCE_SCOPE_REPARSE_POINT')
    const scopeKeyPrefix = `${foldWindows(path.win32.normalize(scopeRelativePath))}\\`
    scopedExpectedExcludedCount = 0
    for (const key of excludedPaths) {
      if (key.startsWith(scopeKeyPrefix)) scopedExpectedExcludedCount += 1
    }
  }

  const stack = [walkStart]
  const files = []
  const entries = new Map()
  let directoryCount = 0
  let observedFileCount = 0
  let observedBytes = 0
  let excludedFileCount = 0
  let excludedBytes = 0
  let bytes = 0

  while (stack.length > 0) {
    const current = stack.pop()
    try {
      const directory = await opendir(current)
      for await (const entry of directory) {
        const fullPath = path.join(current, entry.name)
        const info = await lstat(fullPath, { bigint: true })
        assert(!info.isSymbolicLink(), 'SOURCE_REPARSE_POINT_FOUND')
        if (info.isDirectory()) {
          directoryCount += 1
          stack.push(fullPath)
          continue
        }
        assert(info.isFile(), 'SOURCE_UNSUPPORTED_ENTRY_FOUND')

        const relativePath = canonicalRelativePath(path.relative(root, fullPath))
        const relativeKey = foldWindows(path.win32.normalize(relativePath))
        observedFileCount += 1
        observedBytes += safeInteger(info.size, 'SOURCE_SIZE_INVALID')
        if (excludedPaths.has(relativeKey)) {
          excludedFileCount += 1
          excludedBytes += safeInteger(info.size, 'SOURCE_SIZE_INVALID')
          continue
        }

        assert(!entries.has(relativeKey), 'SOURCE_CASE_INSENSITIVE_PATH_COLLISION')
        const record = {
          fullPath,
          relativePath,
          size: safeInteger(info.size, 'SOURCE_SIZE_INVALID'),
          mtimeNs: info.mtimeNs.toString(),
        }
        files.push(record)
        entries.set(relativeKey, `${relativePath.normalize('NFC')}\0${record.size}\0${record.mtimeNs}`)
        bytes += record.size
      }
    } catch (error) {
      if (error?.safeCode) throw error
      if (['ENOENT', 'ENOTDIR', 'ESTALE'].includes(error?.code)) {
        fail('SOURCE_CHANGED_DURING_INVENTORY')
      }
      throw error
    }
  }

  assert(excludedFileCount === (scopedExpectedExcludedCount ?? excludedPaths.size), 'SOURCE_GHOST_EXCLUSION_SET_MISMATCH')
  files.sort((left, right) => ordinalCompare(left.relativePath, right.relativePath))
  return {
    files,
    entries,
    observedFileCount,
    observedBytes,
    excludedFileCount,
    excludedBytes,
    fileCount: files.length,
    directoryCount,
    bytes,
    metadataSha256: stableMapDigest(entries),
  }
}

function sameSourceMetadata(left, right) {
  return left.fileCount === right.fileCount
    && left.directoryCount === right.directoryCount
    && left.bytes === right.bytes
    && left.observedFileCount === right.observedFileCount
    && left.observedBytes === right.observedBytes
    && left.excludedFileCount === right.excludedFileCount
    && left.excludedBytes === right.excludedBytes
    && left.metadataSha256 === right.metadataSha256
}

export async function hashSourceTree(sourceRoot, excludedPaths, progressInterval) {
  const before = await enumerateSourceTree(sourceRoot, excludedPaths)
  const manifestRows = []
  let processed = 0

  for (const record of before.files) {
    const hasher = createHash('sha256')
    try {
      for await (const chunk of createReadStream(record.fullPath, { flags: 'r' })) {
        hasher.update(chunk)
      }
      const afterFile = await stat(record.fullPath, { bigint: true })
      assert(
        safeInteger(afterFile.size, 'SOURCE_SIZE_INVALID') === record.size
          && afterFile.mtimeNs.toString() === record.mtimeNs,
        'SOURCE_CHANGED_DURING_FULL_HASH',
      )
      manifestRows.push(`${record.relativePath}\0${record.size}\0${hasher.digest('hex')}`)
    } catch (error) {
      if (error?.safeCode === 'SOURCE_CHANGED_DURING_FULL_HASH') throw error
      if (['ENOENT', 'ENOTDIR', 'ESTALE'].includes(error?.code)) {
        fail('SOURCE_CHANGED_DURING_FULL_HASH')
      }
      fail('SOURCE_FULL_HASH_INCOMPLETE')
    }

    processed += 1
    if (progressInterval > 0 && processed % progressInterval === 0) {
      process.stderr.write(`HASH_PROGRESS processed=${processed} total=${before.fileCount}\n`)
    }
  }

  const after = await enumerateSourceTree(sourceRoot, excludedPaths)
  assert(sameSourceMetadata(before, after), 'SOURCE_CHANGED_DURING_FULL_HASH')
  manifestRows.sort(ordinalCompare)
  return {
    observedFileCount: before.observedFileCount,
    observedBytes: before.observedBytes,
    excludedFileCount: before.excludedFileCount,
    excludedBytes: before.excludedBytes,
    fileCount: before.fileCount,
    directoryCount: before.directoryCount,
    bytes: before.bytes,
    metadataSha256: before.metadataSha256,
    manifestSha256: sha256(manifestRows.join('\n')),
    hashedFileCount: before.fileCount,
    hashErrorCount: 0,
    snapshotStable: true,
  }
}

function publicSourceSnapshot(source) {
  return {
    ObservedFileCount: source.observedFileCount,
    ObservedBytes: source.observedBytes,
    ExcludedFileCount: source.excludedFileCount,
    ExcludedBytes: source.excludedBytes,
    FileCount: source.fileCount,
    DirectoryCount: source.directoryCount,
    Bytes: source.bytes,
    MetadataSha256: source.metadataSha256,
  }
}

function publicPcloudSnapshot(pcloud) {
  return {
    DiffCursorSha256: pcloud.diffCursorSha256,
    RootIdentitySha256: pcloud.rootIdentitySha256,
    RunStatus: pcloud.runStatus,
    PendingTaskCount: pcloud.pendingTaskCount,
    SyncRecordCount: pcloud.syncRecordCount,
    FileCount: pcloud.fileCount,
    DirectoryCount: pcloud.directoryCount,
    Bytes: pcloud.bytes,
    InventorySha256: pcloud.manifestSha256,
  }
}

async function takeCombinedObservation(sourceRoot, databasePath, ghost) {
  const pcloudBefore = await capturePcloudSnapshot(databasePath, ghost)
  const source = await enumerateSourceTree(sourceRoot, ghost.excludedPaths)
  const pcloudAfter = await capturePcloudSnapshot(databasePath, ghost)
  const remoteDelta = compareEntryMaps(pcloudBefore.entries, pcloudAfter.entries)
  const diffCursorAdvanceCount = pcloudBefore.diffCursorSha256 === pcloudAfter.diffCursorSha256 ? 0 : 1
  const changedDuringObservation = diffCursorAdvanceCount > 0
    || remoteDelta.createCount > 0
    || remoteDelta.modifyCount > 0
    || remoteDelta.deleteCount > 0
    || pcloudBefore.pendingTaskCount !== pcloudAfter.pendingTaskCount
    || pcloudBefore.syncRecordCount !== pcloudAfter.syncRecordCount
  if (changedDuringObservation) {
    fail('PCLOUD_CHANGED_DURING_OBSERVATION', {
      delta: createMovementDelta({
        remote: remoteDelta,
        diffCursorAdvanceCount,
        observationInstabilityCount: 1,
      }),
      observation: {
        capturedAtMs: Date.now(),
        source,
        pcloud: pcloudAfter,
      },
    })
  }
  assert(pcloudAfter.pendingTaskCount === 0, 'PCLOUD_PENDING_TASKS_FOUND')
  assert(pcloudAfter.syncRecordCount === 0, 'PCLOUD_SYNC_ALREADY_CONFIGURED')
  return {
    capturedAtMs: Date.now(),
    source,
    pcloud: pcloudAfter,
  }
}

export function compareEntryMaps(previous, current) {
  let createCount = 0
  let modifyCount = 0
  let deleteCount = 0

  for (const [key, signature] of current) {
    if (!previous.has(key)) createCount += 1
    else if (previous.get(key) !== signature) modifyCount += 1
  }
  for (const key of previous.keys()) {
    if (!current.has(key)) deleteCount += 1
  }

  return { createCount, modifyCount, deleteCount }
}

export function compareObservations(previous, current) {
  const remote = compareEntryMaps(previous.pcloud.entries, current.pcloud.entries)
  const source = compareEntryMaps(previous.source.entries, current.source.entries)
  const diffCursorAdvanceCount = previous.pcloud.diffCursorSha256 === current.pcloud.diffCursorSha256 ? 0 : 1
  return {
    remote,
    source,
    diffCursorAdvanceCount,
    movement: remote.createCount > 0
      || remote.modifyCount > 0
      || remote.deleteCount > 0
      || source.createCount > 0
      || source.modifyCount > 0
      || source.deleteCount > 0
      || diffCursorAdvanceCount > 0,
  }
}

function createMovementDelta({
  remote = {},
  source = {},
  diffCursorAdvanceCount = 0,
  observationInstabilityCount = 0,
  sourceHashInstabilityCount = 0,
  sourceInventoryInstabilityCount = 0,
} = {}) {
  return {
    remote: {
      createCount: remote.createCount ?? 0,
      modifyCount: remote.modifyCount ?? 0,
      deleteCount: remote.deleteCount ?? 0,
    },
    source: {
      createCount: source.createCount ?? 0,
      modifyCount: source.modifyCount ?? 0,
      deleteCount: source.deleteCount ?? 0,
    },
    diffCursorAdvanceCount,
    observationInstabilityCount,
    sourceHashInstabilityCount,
    sourceInventoryInstabilityCount,
    movement: true,
  }
}

function emptyActivity() {
  return {
    RemoteCreateCount: 0,
    RemoteModifyCount: 0,
    RemoteDeleteCount: 0,
    SourceCreateCount: 0,
    SourceModifyCount: 0,
    SourceDeleteCount: 0,
    DiffCursorAdvanceCount: 0,
    ObservationInstabilityCount: 0,
    SourceHashInstabilityCount: 0,
    SourceInventoryInstabilityCount: 0,
  }
}

function addActivity(activity, delta) {
  activity.RemoteCreateCount += delta.remote.createCount
  activity.RemoteModifyCount += delta.remote.modifyCount
  activity.RemoteDeleteCount += delta.remote.deleteCount
  activity.SourceCreateCount += delta.source.createCount
  activity.SourceModifyCount += delta.source.modifyCount
  activity.SourceDeleteCount += delta.source.deleteCount
  activity.DiffCursorAdvanceCount += delta.diffCursorAdvanceCount
  activity.ObservationInstabilityCount += delta.observationInstabilityCount ?? 0
  activity.SourceHashInstabilityCount += delta.sourceHashInstabilityCount ?? 0
  activity.SourceInventoryInstabilityCount += delta.sourceInventoryInstabilityCount ?? 0
}

export class QuietWindowTracker {
  constructor(minimumQuietMs, firstObservation) {
    assert(Number.isSafeInteger(minimumQuietMs) && minimumQuietMs > 0, 'MINIMUM_QUIET_WINDOW_INVALID')
    this.minimumQuietMs = minimumQuietMs
    this.previous = firstObservation
    this.quietSinceMs = firstObservation.capturedAtMs
    this.windowResetCount = 0
    this.activity = emptyActivity()
  }

  recordMovement(capturedAtMs, delta) {
    assert(Number.isSafeInteger(capturedAtMs) && capturedAtMs >= 0, 'MOVEMENT_TIMESTAMP_INVALID')
    assert(delta?.movement === true, 'MOVEMENT_DELTA_INVALID')
    this.quietSinceMs = capturedAtMs
    this.windowResetCount += 1
    addActivity(this.activity, delta)
  }

  observe(current, indicators = {}) {
    const delta = compareObservations(this.previous, current)
    delta.observationInstabilityCount = indicators.observationInstabilityCount ?? 0
    delta.sourceHashInstabilityCount = indicators.sourceHashInstabilityCount ?? 0
    delta.movement = delta.movement
      || delta.observationInstabilityCount > 0
      || delta.sourceHashInstabilityCount > 0
    if (delta.movement) {
      this.recordMovement(current.capturedAtMs, delta)
    }
    this.previous = current
    return delta
  }

  getQuietMilliseconds(nowMs) {
    return Math.max(0, nowMs - this.quietSinceMs)
  }

  isEligibleByTime(nowMs) {
    return this.getQuietMilliseconds(nowMs) >= this.minimumQuietMs
  }
}

function sameFullSource(left, right) {
  return left.fileCount === right.fileCount
    && left.directoryCount === right.directoryCount
    && left.bytes === right.bytes
    && left.metadataSha256 === right.metadataSha256
    && left.manifestSha256 === right.manifestSha256
    && left.hashErrorCount === 0
    && right.hashErrorCount === 0
    && left.snapshotStable === true
    && right.snapshotStable === true
}

function emitReset(delta, tracker) {
  process.stderr.write([
    'MAINTENANCE_WINDOW_RESET',
    `reset_count=${tracker.windowResetCount}`,
    `remote_create=${delta.remote.createCount}`,
    `remote_modify=${delta.remote.modifyCount}`,
    `remote_delete=${delta.remote.deleteCount}`,
    `source_create=${delta.source.createCount}`,
    `source_modify=${delta.source.modifyCount}`,
    `source_delete=${delta.source.deleteCount}`,
    `diff_cursor_advance=${delta.diffCursorAdvanceCount}`,
    `observation_unstable=${delta.observationInstabilityCount ?? 0}`,
    `source_hash_unstable=${delta.sourceHashInstabilityCount ?? 0}`,
    `source_inventory_unstable=${delta.sourceInventoryInstabilityCount ?? 0}`,
  ].join(' ') + '\n')
}

function buildProbeResult(observation, ghost) {
  return {
    SchemaVersion: 'pcloud-maintenance-window/1.0.0',
    Mode: 'probe',
    Status: 'blocked',
    ReadOnly: true,
    EligibleForD8: false,
    MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
    GhostExclusion: {
      ManifestSha256: ghost.manifestSha256,
      EntryCount: ghost.excludedPaths.size,
    },
    Current: {
      Source: publicSourceSnapshot(observation.source),
      PCloud: publicPcloudSnapshot(observation.pcloud),
    },
    Blockers: ['PROBE_ONLY_NOT_D8_GATE'],
  }
}

async function runGate(args, ghost) {
  const gateStartedAtMs = Date.now()
  const maximumEndsAtMs = gateStartedAtMs + args.maximumSeconds * 1000
  const initialActivity = emptyActivity()
  let initialResetCount = 0

  const getTransientDelta = (error) => {
    if (error?.safeCode === 'PCLOUD_CHANGED_DURING_OBSERVATION') {
      return error.safeDetails?.delta ?? createMovementDelta({ observationInstabilityCount: 1 })
    }
    if (error?.safeCode === 'PCLOUD_DATABASE_SNAPSHOT_UNSTABLE') {
      return createMovementDelta({ observationInstabilityCount: 1 })
    }
    if (error?.safeCode === 'SOURCE_CHANGED_DURING_FULL_HASH') {
      return createMovementDelta({ sourceHashInstabilityCount: 1 })
    }
    if (error?.safeCode === 'SOURCE_CHANGED_DURING_INVENTORY') {
      return createMovementDelta({ sourceInventoryInstabilityCount: 1 })
    }
    return null
  }

  const waitForNextPoll = async () => {
    const remainingMs = maximumEndsAtMs - Date.now()
    if (remainingMs <= 0) return
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(args.pollSeconds * 1000, remainingMs),
    ))
  }

  let firstObservation = null
  while (Date.now() <= maximumEndsAtMs && firstObservation === null) {
    try {
      firstObservation = await takeCombinedObservation(
        args.sourceRoot,
        args.pcloudDatabasePath,
        ghost,
      )
    } catch (error) {
      const delta = getTransientDelta(error)
      if (delta === null) throw error
      initialResetCount += 1
      addActivity(initialActivity, delta)
      emitReset(delta, { windowResetCount: initialResetCount })
      await waitForNextPoll()
    }
  }

  if (firstObservation === null) {
    return {
      SchemaVersion: 'pcloud-maintenance-window/1.0.0',
      Mode: 'gate',
      Status: 'blocked',
      ReadOnly: true,
      EligibleForD8: false,
      StartedAtUtc: new Date(gateStartedAtMs).toISOString(),
      CompletedAtUtc: new Date().toISOString(),
      MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
      ObservedQuietSeconds: 0,
      WindowResetCount: initialResetCount,
      ActivityObserved: initialActivity,
      GhostExclusion: {
        ManifestSha256: ghost.manifestSha256,
        EntryCount: ghost.excludedPaths.size,
      },
      Blockers: ['STABLE_INITIAL_OBSERVATION_NOT_REACHED'],
    }
  }

  const tracker = new QuietWindowTracker(MINIMUM_QUIET_SECONDS * 1000, firstObservation)
  tracker.windowResetCount = initialResetCount
  tracker.activity = initialActivity

  const captureWithReset = async () => {
    while (Date.now() <= maximumEndsAtMs) {
      try {
        return await takeCombinedObservation(
          args.sourceRoot,
          args.pcloudDatabasePath,
          ghost,
        )
      } catch (error) {
        const delta = getTransientDelta(error)
        if (delta === null) throw error
        if (error.safeDetails?.observation) {
          const observedDelta = tracker.observe(error.safeDetails.observation, {
            observationInstabilityCount: 1,
          })
          emitReset(observedDelta, tracker)
        } else {
          tracker.recordMovement(Date.now(), delta)
          emitReset(delta, tracker)
        }
        await waitForNextPoll()
      }
    }
    return null
  }

  const hashWithReset = async () => {
    while (Date.now() <= maximumEndsAtMs) {
      try {
        return await hashSourceTree(
          args.sourceRoot,
          ghost.excludedPaths,
          args.progressInterval,
        )
      } catch (error) {
        const delta = getTransientDelta(error)
        if (delta === null) throw error
        tracker.recordMovement(Date.now(), delta)
        emitReset(delta, tracker)
        await waitForNextPoll()
      }
    }
    return null
  }

  const establishFullHashBaseline = async () => {
    while (Date.now() <= maximumEndsAtMs) {
      const fullHash = await hashWithReset()
      if (fullHash === null) return null
      const observation = await captureWithReset()
      if (observation === null) return null
      const delta = tracker.observe(observation)
      if (delta.movement) {
        emitReset(delta, tracker)
        continue
      }
      baselineObservation = observation
      return fullHash
    }
    return null
  }

  let baselineObservation = null
  let baselineFullHash = await establishFullHashBaseline()

  while (baselineFullHash !== null && Date.now() <= maximumEndsAtMs) {
    if (!tracker.isEligibleByTime(Date.now())) {
      const quietSeconds = Math.floor(tracker.getQuietMilliseconds(Date.now()) / 1000)
      process.stderr.write(`MAINTENANCE_WINDOW_PROGRESS quiet_seconds=${quietSeconds} required=${MINIMUM_QUIET_SECONDS}\n`)
      await waitForNextPoll()
      const observation = await captureWithReset()
      if (observation === null) break
      const delta = tracker.observe(observation)
      if (delta.movement) {
        emitReset(delta, tracker)
        baselineFullHash = await establishFullHashBaseline()
      }
      continue
    }

    const finalFullHash = await hashWithReset()
    if (finalFullHash === null) break
    const finalObservation = await captureWithReset()
    if (finalObservation === null) break
    const finalDelta = tracker.observe(finalObservation)
    if (finalDelta.movement) {
      emitReset(finalDelta, tracker)
      baselineFullHash = await establishFullHashBaseline()
      continue
    }

    const quietSeconds = Math.floor(tracker.getQuietMilliseconds(finalObservation.capturedAtMs) / 1000)
    if (quietSeconds < MINIMUM_QUIET_SECONDS) continue
    if (!sameFullSource(baselineFullHash, finalFullHash)) {
      const syntheticDelta = createMovementDelta({ sourceHashInstabilityCount: 1 })
      tracker.recordMovement(finalObservation.capturedAtMs, syntheticDelta)
      emitReset(syntheticDelta, tracker)
      baselineFullHash = finalFullHash
      baselineObservation = finalObservation
      continue
    }

    return {
      SchemaVersion: 'pcloud-maintenance-window/1.0.0',
      Mode: 'gate',
      Status: 'pass',
      ReadOnly: true,
      EligibleForD8: true,
      StartedAtUtc: new Date(gateStartedAtMs).toISOString(),
      CompletedAtUtc: new Date(finalObservation.capturedAtMs).toISOString(),
      MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
      ObservedQuietSeconds: quietSeconds,
      WindowResetCount: tracker.windowResetCount,
      ActivityObservedBeforeFinalWindow: tracker.activity,
      GhostExclusion: {
        ManifestSha256: ghost.manifestSha256,
        EntryCount: ghost.excludedPaths.size,
      },
      FinalWindow: {
        Baseline: {
          Source: {
            ...publicSourceSnapshot(baselineFullHash),
            ManifestSha256: baselineFullHash.manifestSha256,
            HashedFileCount: baselineFullHash.hashedFileCount,
            HashErrorCount: baselineFullHash.hashErrorCount,
            SnapshotStable: baselineFullHash.snapshotStable,
          },
          PCloud: publicPcloudSnapshot(baselineObservation.pcloud),
        },
        RemoteChanges: {
          CreateCount: 0,
          ModifyCount: 0,
          DeleteCount: 0,
          DiffCursorAdvanceCount: 0,
        },
        SourceChanges: {
          CreateCount: 0,
          ModifyCount: 0,
          DeleteCount: 0,
        },
        Source: {
          ...publicSourceSnapshot(finalObservation.source),
          ManifestSha256: finalFullHash.manifestSha256,
          HashedFileCount: finalFullHash.hashedFileCount,
          HashErrorCount: finalFullHash.hashErrorCount,
          SnapshotStable: finalFullHash.snapshotStable,
        },
        PCloud: publicPcloudSnapshot(finalObservation.pcloud),
      },
      Blockers: [],
    }
  }

  const observedQuietSeconds = Math.floor(tracker.getQuietMilliseconds(Date.now()) / 1000)
  const blockers = ['STABLE_FINAL_HASH_AND_INVENTORY_NOT_REACHED']
  if (observedQuietSeconds < MINIMUM_QUIET_SECONDS) {
    blockers.unshift('MINIMUM_QUIET_WINDOW_NOT_REACHED')
  }
  return {
    SchemaVersion: 'pcloud-maintenance-window/1.0.0',
    Mode: 'gate',
    Status: 'blocked',
    ReadOnly: true,
    EligibleForD8: false,
    StartedAtUtc: new Date(gateStartedAtMs).toISOString(),
    CompletedAtUtc: new Date().toISOString(),
    MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
    ObservedQuietSeconds: observedQuietSeconds,
    WindowResetCount: tracker.windowResetCount,
    ActivityObserved: tracker.activity,
    GhostExclusion: {
      ManifestSha256: ghost.manifestSha256,
      EntryCount: ghost.excludedPaths.size,
    },
    Blockers: blockers,
  }
}

export function validateReportShape(report, ghost) {
  assert(report?.SchemaVersion === 'pcloud-maintenance-window/1.0.0', 'MAINTENANCE_WINDOW_REPORT_SCHEMA_INVALID')
  assert(report?.Mode === 'gate', 'MAINTENANCE_WINDOW_REPORT_MODE_INVALID')
  assert(report?.Status === 'pass', 'MAINTENANCE_WINDOW_REPORT_NOT_PASS')
  assert(report?.ReadOnly === true && report?.EligibleForD8 === true, 'MAINTENANCE_WINDOW_REPORT_NOT_ELIGIBLE')
  assert(report?.MinimumQuietSeconds === MINIMUM_QUIET_SECONDS, 'MAINTENANCE_WINDOW_REPORT_DURATION_INVALID')
  assert(Number.isSafeInteger(report?.ObservedQuietSeconds) && report.ObservedQuietSeconds >= MINIMUM_QUIET_SECONDS, 'MAINTENANCE_WINDOW_REPORT_DURATION_INVALID')
  assert(Array.isArray(report?.Blockers) && report.Blockers.length === 0, 'MAINTENANCE_WINDOW_REPORT_HAS_BLOCKERS')
  assert(report?.GhostExclusion?.ManifestSha256 === ghost.manifestSha256, 'MAINTENANCE_WINDOW_EXCLUSION_MISMATCH')
  assert(report?.GhostExclusion?.EntryCount === 10, 'MAINTENANCE_WINDOW_EXCLUSION_COUNT_INVALID')
  const remoteChanges = report?.FinalWindow?.RemoteChanges
  const sourceChanges = report?.FinalWindow?.SourceChanges
  const baselineSource = report?.FinalWindow?.Baseline?.Source
  const baselinePcloud = report?.FinalWindow?.Baseline?.PCloud
  assert(
    remoteChanges?.CreateCount === 0
      && remoteChanges?.ModifyCount === 0
      && remoteChanges?.DeleteCount === 0
      && remoteChanges?.DiffCursorAdvanceCount === 0,
    'MAINTENANCE_WINDOW_REMOTE_ACTIVITY_FOUND',
  )
  assert(
    sourceChanges?.CreateCount === 0
      && sourceChanges?.ModifyCount === 0
      && sourceChanges?.DeleteCount === 0,
    'MAINTENANCE_WINDOW_SOURCE_ACTIVITY_FOUND',
  )
  const source = report?.FinalWindow?.Source
  const pcloud = report?.FinalWindow?.PCloud
  assert(baselineSource && baselinePcloud, 'MAINTENANCE_WINDOW_BASELINE_MISSING')
  const sourceCountFields = [
    'ObservedFileCount',
    'ObservedBytes',
    'ExcludedFileCount',
    'ExcludedBytes',
    'FileCount',
    'DirectoryCount',
    'Bytes',
    'HashedFileCount',
    'HashErrorCount',
  ]
  assert(
    sourceCountFields.every((field) => Number.isSafeInteger(source?.[field]) && source[field] >= 0)
      && sourceCountFields.every((field) => Number.isSafeInteger(baselineSource?.[field]) && baselineSource[field] >= 0),
    'MAINTENANCE_WINDOW_SOURCE_COUNTS_INVALID',
  )
  assert(source?.ManifestSha256 && SHA256_PATTERN.test(source.ManifestSha256), 'MAINTENANCE_WINDOW_SOURCE_HASH_INVALID')
  assert(source?.MetadataSha256 && SHA256_PATTERN.test(source.MetadataSha256), 'MAINTENANCE_WINDOW_SOURCE_METADATA_INVALID')
  assert(source?.FileCount === source?.HashedFileCount && source?.HashErrorCount === 0 && source?.SnapshotStable === true, 'MAINTENANCE_WINDOW_SOURCE_HASH_INCOMPLETE')
  assert(pcloud?.DiffCursorSha256 && SHA256_PATTERN.test(pcloud.DiffCursorSha256), 'MAINTENANCE_WINDOW_DIFF_CURSOR_INVALID')
  assert(pcloud?.RootIdentitySha256 && SHA256_PATTERN.test(pcloud.RootIdentitySha256), 'MAINTENANCE_WINDOW_PCLOUD_ROOT_INVALID')
  assert(pcloud?.InventorySha256 && SHA256_PATTERN.test(pcloud.InventorySha256), 'MAINTENANCE_WINDOW_PCLOUD_INVENTORY_INVALID')
  const pcloudCountFields = [
    'PendingTaskCount',
    'SyncRecordCount',
    'FileCount',
    'DirectoryCount',
    'Bytes',
  ]
  assert(
    pcloudCountFields.every((field) => Number.isSafeInteger(pcloud?.[field]) && pcloud[field] >= 0)
      && pcloudCountFields.every((field) => Number.isSafeInteger(baselinePcloud?.[field]) && baselinePcloud[field] >= 0),
    'MAINTENANCE_WINDOW_PCLOUD_COUNTS_INVALID',
  )
  assert(pcloud?.RunStatus === '1' && pcloud?.PendingTaskCount === 0 && pcloud?.SyncRecordCount === 0, 'MAINTENANCE_WINDOW_PCLOUD_STATE_INVALID')
  assert(
    baselineSource.ObservedFileCount === source.ObservedFileCount
      && baselineSource.ObservedBytes === source.ObservedBytes
      && baselineSource.ExcludedFileCount === source.ExcludedFileCount
      && baselineSource.ExcludedBytes === source.ExcludedBytes
      && baselineSource.FileCount === source.FileCount
      && baselineSource.DirectoryCount === source.DirectoryCount
      && baselineSource.Bytes === source.Bytes
      && baselineSource.MetadataSha256 === source.MetadataSha256
      && baselineSource.ManifestSha256 === source.ManifestSha256
      && baselineSource.HashedFileCount === source.HashedFileCount
      && baselineSource.HashErrorCount === 0
      && baselineSource.SnapshotStable === true,
    'MAINTENANCE_WINDOW_SOURCE_BASELINE_MISMATCH',
  )
  assert(
    baselinePcloud.DiffCursorSha256 === pcloud.DiffCursorSha256
      && baselinePcloud.RootIdentitySha256 === pcloud.RootIdentitySha256
      && baselinePcloud.RunStatus === pcloud.RunStatus
      && baselinePcloud.PendingTaskCount === pcloud.PendingTaskCount
      && baselinePcloud.SyncRecordCount === pcloud.SyncRecordCount
      && baselinePcloud.FileCount === pcloud.FileCount
      && baselinePcloud.DirectoryCount === pcloud.DirectoryCount
      && baselinePcloud.Bytes === pcloud.Bytes
      && baselinePcloud.InventorySha256 === pcloud.InventorySha256,
    'MAINTENANCE_WINDOW_PCLOUD_BASELINE_MISMATCH',
  )
  return { source, pcloud }
}

async function verifyCurrent(args, ghost) {
  let report
  try {
    report = JSON.parse(await readFile(args.maintenanceReportPath, 'utf8'))
  } catch {
    fail('MAINTENANCE_WINDOW_REPORT_JSON_INVALID')
  }
  const baseline = validateReportShape(report, ghost)
  const current = await takeCombinedObservation(args.sourceRoot, args.pcloudDatabasePath, ghost)
  const source = publicSourceSnapshot(current.source)
  const pcloud = publicPcloudSnapshot(current.pcloud)
  const blockers = []

  if (
    source.FileCount !== baseline.source.FileCount
    || source.DirectoryCount !== baseline.source.DirectoryCount
    || source.Bytes !== baseline.source.Bytes
    || source.MetadataSha256 !== baseline.source.MetadataSha256
  ) blockers.push('MAINTENANCE_WINDOW_SOURCE_NO_LONGER_CURRENT')
  if (
    pcloud.DiffCursorSha256 !== baseline.pcloud.DiffCursorSha256
    || pcloud.FileCount !== baseline.pcloud.FileCount
    || pcloud.DirectoryCount !== baseline.pcloud.DirectoryCount
    || pcloud.Bytes !== baseline.pcloud.Bytes
    || pcloud.InventorySha256 !== baseline.pcloud.InventorySha256
  ) blockers.push('MAINTENANCE_WINDOW_PCLOUD_NO_LONGER_CURRENT')

  return {
    SchemaVersion: 'pcloud-maintenance-window-current-check/1.0.0',
    Status: blockers.length === 0 ? 'pass' : 'blocked',
    ReadOnly: true,
    CurrentMatches: blockers.length === 0,
    Source: source,
    PCloud: pcloud,
    BaselineSourceManifestSha256: baseline.source.ManifestSha256,
    Blockers: blockers,
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  let mode = 'unknown'
  try {
    const args = parseArguments(process.argv.slice(2))
    mode = args.mode
    const ghost = await loadGhostManifest(
      args.manifestPath,
      args.manifestSha256,
      args.sourceRoot,
    )
    if (args.mode === 'probe') {
      const observation = await takeCombinedObservation(
        args.sourceRoot,
        args.pcloudDatabasePath,
        ghost,
      )
      emit(buildProbeResult(observation, ghost), 2)
      return
    }
    if (args.mode === 'verify-current') {
      const result = await verifyCurrent(args, ghost)
      emit(result, result.Status === 'pass' ? 0 : 2)
      return
    }

    const result = await runGate(args, ghost)
    emit(result, result.Status === 'pass' ? 0 : 2)
  } catch (error) {
    emit({
      SchemaVersion: 'pcloud-maintenance-window/1.0.0',
      Mode: mode,
      Status: 'error',
      ReadOnly: true,
      EligibleForD8: false,
      ErrorCode: typeof error?.safeCode === 'string'
        ? error.safeCode
        : 'MAINTENANCE_WINDOW_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
