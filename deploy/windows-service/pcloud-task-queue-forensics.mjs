import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  compareEntryMaps,
  enumerateSourceTree,
  getExactGhostRootId,
  getRemoteInventory,
  getTextSetting,
  loadGhostManifest,
  withConsistentPcloudDatabase,
} from './pcloud-maintenance-window-gate.mjs'

// PCLOUD_PENDING_TASKS_FOUND read-only diagnostic (HB-2026-134 follow-up).
//
// This module is READ-ONLY: it never writes to pCloud's database, source,
// target, env or services, and never runs the D8 gate/PostSyncRebaseline/
// AfterSync stages. It repeatedly takes safe, consistent read-only
// snapshots of pCloud's local queue tables (task/fstask/upload_tasks/
// localfileupload/uptask_fileupload/pagecachetask) over a bounded window,
// tracks each row's identity (table+id) across samples, resolves
// itemid/fileid/folderid references to a relative path where the file or
// folder still resolves under the known ghost-manifest root, and reports a
// BEST-EFFORT classification.
//
// IMPORTANT HONESTY NOTE: pCloud's internal `type`/`status` integer codes
// are undocumented and this repository has never previously reverse-
// engineered their exact enum meanings (confirmed by searching the
// decision log before writing this tool). This tool does NOT claim to
// know what task.type=N or fstask.type=N means. It reports the raw values
// verbatim for audit visibility and infers direction/classification only
// from OBSERVABLE, VERIFIABLE structural signals: which table a row is in
// (upload_tasks is unambiguously an outbound/local->remote queue by its own
// name and columns), whether the same identity persists across many
// samples without resolving (recurring), whether upload_tasks.error_code
// is ever non-zero, and whether the REMOTE inventory or the LOCAL source
// tree actually changed content during the window (compared once at the
// start and once at the end, via the same tested compareEntryMaps/
// enumerateSourceTree/getRemoteInventory primitives the D8 gates already
// use). Where the evidence is ambiguous, this tool reports 'unknown'
// rather than guessing.

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_ANCESTOR_DEPTH = 128

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
  assert(Number.isSafeInteger(number), safeCode)
  return number
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArguments(argv) {
  const allowed = new Set([
    '--source-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--duration-seconds',
    '--sample-interval-seconds',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'ARGUMENT_INVALID')
    assert(!values.has(key), 'ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  for (const key of ['--source-root', '--ghost-manifest', '--ghost-manifest-sha256', '--pcloud-db']) {
    assert(values.has(key), 'ARGUMENT_MISSING')
  }
  const manifestSha256 = values.get('--ghost-manifest-sha256')
  assert(SHA256_PATTERN.test(manifestSha256), 'GHOST_EXCLUSION_HASH_INVALID')
  const durationSecondsRaw = values.get('--duration-seconds') ?? '900'
  const sampleIntervalSecondsRaw = values.get('--sample-interval-seconds') ?? '20'
  assert(/^[0-9]+$/.test(durationSecondsRaw), 'DURATION_SECONDS_INVALID')
  assert(/^[0-9]+$/.test(sampleIntervalSecondsRaw), 'SAMPLE_INTERVAL_SECONDS_INVALID')
  const durationSeconds = Number(durationSecondsRaw)
  const sampleIntervalSeconds = Number(sampleIntervalSecondsRaw)
  assert(durationSeconds >= 60 && durationSeconds <= 3600, 'DURATION_SECONDS_OUT_OF_RANGE')
  assert(sampleIntervalSeconds >= 5 && sampleIntervalSeconds <= durationSeconds, 'SAMPLE_INTERVAL_SECONDS_OUT_OF_RANGE')
  return {
    sourceRoot: values.get('--source-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256,
    pcloudDatabasePath: values.get('--pcloud-db'),
    durationSeconds,
    sampleIntervalSeconds,
  }
}

function normalizeWindowsRoot(value) {
  return path.win32.normalize(path.win32.resolve(value)).replace(/[\\/]+$/, '')
}

function resolveAncestorNames(database, ghostRootId, startFolderId) {
  const names = []
  let currentId = startFolderId
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (currentId === ghostRootId) return names.reverse()
    const row = database.prepare(
      'SELECT CAST(parentfolderid AS TEXT) AS parent_id_text, name FROM folder WHERE id = ?',
    ).get(BigInt(currentId))
    if (!row) return null
    names.push(row.name)
    currentId = row.parent_id_text
  }
  return null
}

function resolveFolderRelativePath(database, ghostRootId, folderId) {
  if (folderId === null || folderId === undefined) return null
  const folderIdText = String(folderId)
  if (folderIdText === ghostRootId) return ''
  const row = database.prepare('SELECT name FROM folder WHERE id = ?').get(BigInt(folderIdText))
  if (!row) return null
  const ancestors = resolveAncestorNames(database, ghostRootId, folderIdText)
  if (ancestors === null) return null
  return [...ancestors].join('\\')
}

function resolveFileRelativePath(database, ghostRootId, fileId) {
  if (fileId === null || fileId === undefined) return null
  const row = database.prepare(
    'SELECT CAST(parentfolderid AS TEXT) AS parent_id_text, name FROM file WHERE id = ?',
  ).get(BigInt(fileId))
  if (!row) return null
  const ancestors = resolveAncestorNames(database, ghostRootId, row.parent_id_text)
  if (ancestors === null) return null
  return [...ancestors, row.name].join('\\')
}

/** Tries file table first, then folder table -- an itemid's kind is not
 * knowable from the task row alone without documented type semantics. */
function resolveItemRelativePath(database, ghostRootId, itemId) {
  if (itemId === null || itemId === undefined) return null
  const filePath = resolveFileRelativePath(database, ghostRootId, itemId)
  if (filePath !== null) return { kind: 'file', relativePath: filePath }
  const folderPath = resolveFolderRelativePath(database, ghostRootId, itemId)
  if (folderPath !== null) return { kind: 'folder', relativePath: folderPath }
  return null
}

export function captureQueueRows(database, ghostRootId) {
  const taskRows = database.prepare(`
    SELECT CAST(id AS TEXT) AS id_text, type, syncid, newsyncid,
      CAST(itemid AS TEXT) AS itemid_text, CAST(localitemid AS TEXT) AS localitemid_text,
      CAST(newitemid AS TEXT) AS newitemid_text, inprogress, name
    FROM task
  `).all()
  const fstaskRows = database.prepare(`
    SELECT CAST(id AS TEXT) AS id_text, type, status,
      CAST(folderid AS TEXT) AS folderid_text, CAST(sfolderid AS TEXT) AS sfolderid_text,
      CAST(fileid AS TEXT) AS fileid_text, text1, text2, int1, int2
    FROM fstask
  `).all()
  const uploadTaskRows = database.prepare(`
    SELECT CAST(id AS TEXT) AS id_text, type, status, level,
      CAST(parentfid AS TEXT) AS parentfid_text, fname, fpath, size, checksum, error_code
    FROM upload_tasks
  `).all()

  const entries = []
  for (const row of taskRows) {
    const primaryRef = row.itemid_text ?? row.localitemid_text ?? row.newitemid_text ?? null
    const resolved = resolveItemRelativePath(database, ghostRootId, primaryRef)
    entries.push({
      table: 'task',
      id: row.id_text,
      type: row.type,
      status: row.inprogress,
      errorCode: null,
      refs: { itemid: row.itemid_text, localitemid: row.localitemid_text, newitemid: row.newitemid_text, syncid: row.syncid, newsyncid: row.newsyncid },
      resolvedPath: resolved?.relativePath ?? null,
      resolvedKind: resolved?.kind ?? null,
      literalName: row.name ?? null,
    })
  }
  for (const row of fstaskRows) {
    const primaryRef = row.fileid_text ?? row.folderid_text ?? null
    const resolved = resolveItemRelativePath(database, ghostRootId, primaryRef)
    entries.push({
      table: 'fstask',
      id: row.id_text,
      type: row.type,
      status: row.status,
      errorCode: null,
      refs: { folderid: row.folderid_text, sfolderid: row.sfolderid_text, fileid: row.fileid_text, int1: row.int1, int2: row.int2 },
      resolvedPath: resolved?.relativePath ?? null,
      resolvedKind: resolved?.kind ?? null,
      literalText1: row.text1 ?? null,
      literalText2: row.text2 ?? null,
    })
  }
  for (const row of uploadTaskRows) {
    const resolved = resolveItemRelativePath(database, ghostRootId, row.parentfid_text)
    entries.push({
      table: 'upload_tasks',
      id: row.id_text,
      type: row.type,
      status: row.status,
      errorCode: safeInteger(row.error_code ?? 0, 'UPLOAD_TASK_ERROR_CODE_INVALID'),
      refs: { parentfid: row.parentfid_text, level: row.level, size: row.size },
      resolvedPath: resolved?.relativePath ?? null,
      resolvedKind: resolved?.kind ?? null,
      literalFname: row.fname ?? null,
      literalFpath: row.fpath ?? null,
      checksum: row.checksum ?? null,
    })
  }
  return entries
}

async function captureSample(pcloudDatabasePath, ghost, ghostRootId, sampleIndex, capturedAtMs) {
  return withConsistentPcloudDatabase(pcloudDatabasePath, (database) => {
    const diffId = getTextSetting(database, 'diffid', 'PCLOUD_DIFF_CURSOR_MISSING')
    const runStatus = getTextSetting(database, 'runstatus', 'PCLOUD_RUN_STATUS_MISSING')
    const rootId = getExactGhostRootId(database, ghost)
    assert(rootId === ghostRootId, 'PCLOUD_REMOTE_ROOT_CHANGED')
    const remoteInventory = getRemoteInventory(database, rootId)
    const entries = captureQueueRows(database, ghostRootId)
    return {
      sampleIndex,
      capturedAtMs,
      diffId,
      runStatus,
      remoteEntries: remoteInventory.entries,
      remoteManifestSha256: remoteInventory.manifestSha256,
      queueEntries: entries,
    }
  })
}

function entryKey(entry) {
  return `${entry.table}:${entry.id}`
}

function updateTracker(tracker, sample) {
  for (const entry of sample.queueEntries) {
    const key = entryKey(entry)
    const existing = tracker.get(key)
    if (!existing) {
      tracker.set(key, {
        table: entry.table,
        id: entry.id,
        firstSeenSampleIndex: sample.sampleIndex,
        firstSeenAtMs: sample.capturedAtMs,
        lastSeenSampleIndex: sample.sampleIndex,
        lastSeenAtMs: sample.capturedAtMs,
        appearanceCount: 1,
        typesSeen: [entry.type],
        statusesSeen: [entry.status],
        errorCodesSeen: entry.errorCode === null ? [] : [entry.errorCode],
        refs: entry.refs,
        resolvedPath: entry.resolvedPath,
        resolvedKind: entry.resolvedKind,
        literal: {
          name: entry.literalName ?? null,
          text1: entry.literalText1 ?? null,
          text2: entry.literalText2 ?? null,
          fname: entry.literalFname ?? null,
          fpath: entry.literalFpath ?? null,
        },
      })
      continue
    }
    existing.lastSeenSampleIndex = sample.sampleIndex
    existing.lastSeenAtMs = sample.capturedAtMs
    existing.appearanceCount += 1
    if (!existing.typesSeen.includes(entry.type)) existing.typesSeen.push(entry.type)
    if (!existing.statusesSeen.includes(entry.status)) existing.statusesSeen.push(entry.status)
    if (entry.errorCode !== null && !existing.errorCodesSeen.includes(entry.errorCode)) {
      existing.errorCodesSeen.push(entry.errorCode)
    }
    if (existing.resolvedPath === null && entry.resolvedPath !== null) {
      existing.resolvedPath = entry.resolvedPath
      existing.resolvedKind = entry.resolvedKind
    }
  }
}

function classifyWindow({ tracker, totalSamples, remoteChanged, sourceChanged, sourceStable }) {
  const entries = [...tracker.values()]
  if (entries.length === 0) {
    return { classification: 'unknown', reason: 'NO_QUEUE_ACTIVITY_OBSERVED' }
  }
  if (!sourceStable) {
    // Local source itself changed shape/hash during the window (a real
    // operator edit/delete on this machine), which alone can explain queue
    // churn without needing a remote-writer or stuck-retry explanation.
  }

  const persistentSpanThreshold = Math.max(2, Math.floor(totalSamples * 0.6))
  const recurring = entries.filter((entry) => (
    entry.appearanceCount >= 3
    && (entry.lastSeenSampleIndex - entry.firstSeenSampleIndex) >= persistentSpanThreshold
  ))
  const anyUploadErrors = entries.some((entry) => entry.table === 'upload_tasks' && entry.errorCodesSeen.some((code) => code !== 0))
  if (recurring.length > 0 || anyUploadErrors) {
    return {
      classification: 'recurring_retry',
      reason: anyUploadErrors
        ? 'UPLOAD_TASK_ERROR_CODE_NONZERO_OBSERVED'
        : 'SAME_QUEUE_ENTRY_PERSISTED_ACROSS_MAJORITY_OF_SAMPLES',
    }
  }

  const transient = entries.filter((entry) => entry.lastSeenSampleIndex < totalSamples - 1)
  if (remoteChanged && !sourceChanged) {
    return { classification: 'remote_writer', reason: 'REMOTE_INVENTORY_CHANGED_WHILE_LOCAL_SOURCE_TREE_DID_NOT' }
  }
  if (transient.length > 0 && (remoteChanged || sourceChanged)) {
    return { classification: 'genuine_transfer', reason: 'QUEUE_ENTRIES_APPEARED_AND_DRAINED_WITH_REAL_CONTENT_CHANGE' }
  }
  if (transient.length > 0 && !remoteChanged && !sourceChanged) {
    return { classification: 'metadata_churn', reason: 'QUEUE_ENTRIES_APPEARED_AND_DRAINED_WITHOUT_OBSERVABLE_CONTENT_CHANGE' }
  }
  return { classification: 'unknown', reason: 'AMBIGUOUS_SIGNALS' }
}

export async function runTaskQueueForensics(args) {
  const sourceRoot = normalizeWindowsRoot(args.sourceRoot)
  const ghost = await loadGhostManifest(args.manifestPath, args.manifestSha256, sourceRoot)
  const ghostRootId = await withConsistentPcloudDatabase(args.pcloudDatabasePath, (database) => getExactGhostRootId(database, ghost))

  const startedAtMs = Date.now()
  const endsAtMs = startedAtMs + args.durationSeconds * 1000
  const sourceAtStart = await enumerateSourceTree(sourceRoot, ghost.excludedPaths)

  const tracker = new Map()
  const samples = []
  let sampleIndex = 0
  while (true) {
    const capturedAtMs = Date.now()
    // eslint-disable-next-line no-await-in-loop
    const sample = await captureSample(args.pcloudDatabasePath, ghost, ghostRootId, sampleIndex, capturedAtMs)
    samples.push(sample)
    updateTracker(tracker, sample)
    sampleIndex += 1
    process.stderr.write(`QUEUE_SAMPLE_PROGRESS index=${sampleIndex} at=${new Date(capturedAtMs).toISOString()} distinctEntries=${tracker.size}\n`)
    const remainingMs = endsAtMs - Date.now()
    if (remainingMs <= 0) break
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.min(args.sampleIntervalSeconds * 1000, remainingMs))
  }

  const sourceAtEnd = await enumerateSourceTree(sourceRoot, ghost.excludedPaths)
  const sourceStable = sourceAtStart.metadataSha256 === sourceAtEnd.metadataSha256
    && sourceAtStart.fileCount === sourceAtEnd.fileCount
    && sourceAtStart.bytes === sourceAtEnd.bytes
  const sourceDelta = compareEntryMaps(sourceAtStart.entries, sourceAtEnd.entries)
  const sourceChanged = sourceDelta.createCount > 0 || sourceDelta.modifyCount > 0 || sourceDelta.deleteCount > 0

  const firstSample = samples[0]
  const lastSample = samples[samples.length - 1]
  const remoteDelta = compareEntryMaps(firstSample.remoteEntries, lastSample.remoteEntries)
  const remoteChanged = remoteDelta.createCount > 0 || remoteDelta.modifyCount > 0 || remoteDelta.deleteCount > 0
  const diffCursorAdvanced = firstSample.diffId !== lastSample.diffId

  const { classification, reason } = classifyWindow({
    tracker,
    totalSamples: samples.length,
    remoteChanged: remoteChanged || diffCursorAdvanced,
    sourceChanged,
    sourceStable,
  })

  const entries = [...tracker.values()].map((entry) => ({
    Table: entry.table,
    Id: entry.id,
    TypesSeenRaw: entry.typesSeen,
    StatusesSeenRaw: entry.statusesSeen,
    ErrorCodesSeen: entry.errorCodesSeen,
    Refs: entry.refs,
    ResolvedRelativePath: entry.resolvedPath,
    ResolvedKind: entry.resolvedKind,
    LiteralFields: entry.literal,
    FirstSeenSampleIndex: entry.firstSeenSampleIndex,
    LastSeenSampleIndex: entry.lastSeenSampleIndex,
    AppearanceCount: entry.appearanceCount,
    DrainedBeforeWindowEnd: entry.lastSeenSampleIndex < samples.length - 1,
  }))
  entries.sort((left, right) => (left.Table === right.Table ? left.Id.localeCompare(right.Id) : left.Table.localeCompare(right.Table)))

  return {
    SchemaVersion: 'pcloud-task-queue-forensics/1.0.0',
    Status: 'ok',
    ReadOnly: true,
    StartedAtUtc: new Date(startedAtMs).toISOString(),
    CompletedAtUtc: new Date().toISOString(),
    RequestedDurationSeconds: args.durationSeconds,
    SampleIntervalSeconds: args.sampleIntervalSeconds,
    SampleCount: samples.length,
    GhostExclusion: { ManifestSha256: ghost.manifestSha256, EntryCount: ghost.excludedPaths.size },
    SourceStableAcrossWindow: sourceStable,
    SourceChanged: sourceChanged,
    SourceDelta: sourceDelta,
    RemoteChanged: remoteChanged,
    DiffCursorAdvanced: diffCursorAdvanced,
    RemoteDelta: remoteDelta,
    DistinctQueueEntryCount: entries.length,
    Classification: classification,
    ClassificationReason: reason,
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
    const report = await runTaskQueueForensics(args)
    emit(report, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'pcloud-task-queue-forensics/1.0.0',
      Status: 'error',
      ReadOnly: true,
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'TASK_QUEUE_FORENSICS_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()

export { classifyWindow, resolveFileRelativePath, resolveFolderRelativePath, resolveItemRelativePath }
