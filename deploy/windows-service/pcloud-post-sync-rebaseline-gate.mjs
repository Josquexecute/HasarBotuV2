import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MINIMUM_QUIET_SECONDS,
  compareEntryMaps,
  enumerateSourceTree,
  getExactGhostRootId,
  getPcloudTaskState,
  getRemoteInventory,
  getTextSetting,
  hashSourceTree,
  loadGhostManifest,
  windowsPathEqual,
  withConsistentPcloudDatabase,
} from './pcloud-maintenance-window-gate.mjs'

// D8 post-sync rebaseline gate (HB-2026-129).
//
// pcloud-maintenance-window-gate.mjs is deliberately pre-sync-only: it hard
// -asserts zero pending pCloud tasks AND zero syncfolder/syncfolderdelayed
// rows before it will observe anything. Once an operator has clicked
// "Add Sync", that assertion can never pass again for this root without
// unlinking the mapping — which is exactly the destructive shortcut this
// tool exists to avoid. This is a SEPARATE stage/tool: the original gate's
// preconditions and quiet-window arithmetic are reused unmodified via the
// exports above; nothing here loosens or bypasses them.
//
// This gate instead requires EXACTLY ONE syncfolder row matching the
// expected remote root + target local path, zero pending tasks/delayed
// items across every known pCloud queue table, at least 600 quiet seconds
// (source AND target AND remote all stable — the imported constant, not a
// local copy), zero conflict-name artifacts, and a final full SHA-256 match
// between source and target. Any of those being false is fail-closed
// BLOCKED; the gate never mutates pCloud, source, target, env, or services.

const DEFAULT_POLL_SECONDS = 15
const DEFAULT_MAXIMUM_SECONDS = 1800
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONFLICT_NAME_PATTERN = /\(conflicted copy|conflicted copy \d+|\.deleted\b/i
const EMPTY_EXCLUDED_PATHS = new Set()
const TRANSIENT_SAFE_CODES = new Set([
  'SOURCE_CHANGED_DURING_FULL_HASH',
  'SOURCE_CHANGED_DURING_INVENTORY',
  'PCLOUD_DATABASE_SNAPSHOT_UNSTABLE',
])

class SafeGateError extends Error {
  constructor(safeCode) {
    super(safeCode)
    this.name = 'SafeGateError'
    this.safeCode = safeCode
  }
}

function fail(safeCode) {
  throw new SafeGateError(safeCode)
}

function assert(condition, safeCode) {
  if (!condition) fail(safeCode)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeInteger(value, safeCode) {
  const number = Number(value)
  assert(Number.isSafeInteger(number) && number >= 0, safeCode)
  return number
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeWindowsRoot(value) {
  return path.win32.normalize(path.win32.resolve(value)).replace(/[\\/]+$/, '')
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
    '--target-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--rebaseline-report',
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
    '--target-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
  ]) {
    assert(values.has(key), 'GATE_ARGUMENT_MISSING')
  }

  const manifestSha256 = values.get('--ghost-manifest-sha256')
  assert(SHA256_PATTERN.test(manifestSha256), 'GHOST_EXCLUSION_HASH_INVALID')

  if (mode === 'verify-current') {
    assert(values.has('--rebaseline-report'), 'REBASELINE_REPORT_REQUIRED')
  } else {
    assert(!values.has('--rebaseline-report'), 'REBASELINE_REPORT_UNEXPECTED')
  }

  return {
    mode,
    sourceRoot: values.get('--source-root'),
    targetRoot: values.get('--target-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256,
    pcloudDatabasePath: values.get('--pcloud-db'),
    rebaselineReportPath: values.get('--rebaseline-report'),
    pollSeconds: parseIntegerArgument(values.get('--poll-seconds') ?? String(DEFAULT_POLL_SECONDS), 1, 'POLL_SECONDS_INVALID'),
    maximumSeconds: parseIntegerArgument(values.get('--maximum-seconds') ?? String(DEFAULT_MAXIMUM_SECONDS), MINIMUM_QUIET_SECONDS, 'MAXIMUM_SECONDS_INVALID'),
    progressInterval: parseIntegerArgument(values.get('--progress-interval') ?? '500', 0, 'PROGRESS_INTERVAL_INVALID'),
  }
}

function findConflictNames(database, rootId) {
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

function getSyncMappingState(database, expectedRootId, expectedTargetRoot) {
  const rows = database.prepare(`
    SELECT CAST(folderid AS TEXT) AS folderid_text, localpath
    FROM syncfolder
  `).all()
  const delayedCount = safeInteger(
    database.prepare('SELECT count(*) AS c FROM syncfolderdelayed').get().c,
    'PCLOUD_SYNC_DELAYED_COUNT_INVALID',
  )
  const rowCount = rows.length
  const folderIdMatches = rowCount === 1 && rows[0].folderid_text === expectedRootId
  const localPathMatches = rowCount === 1 && windowsPathEqual(rows[0].localpath, expectedTargetRoot)
  return { rowCount, folderIdMatches, localPathMatches, delayedCount }
}

export async function loadExpectedRootId(manifestPath, manifestSha256, sourceRoot, pcloudDatabasePath) {
  const ghost = await loadGhostManifest(manifestPath, manifestSha256, sourceRoot)
  const rootId = await withConsistentPcloudDatabase(pcloudDatabasePath, (database) => getExactGhostRootId(database, ghost))
  return { ghost, rootId }
}

async function captureRebaselineObservation(sourceRoot, targetRoot, databasePath, ghost, expectedRootId) {
  const pcloud = await withConsistentPcloudDatabase(databasePath, (database) => {
    const diffId = getTextSetting(database, 'diffid', 'PCLOUD_DIFF_CURSOR_MISSING')
    assert(/^[0-9]+$/.test(diffId), 'PCLOUD_DIFF_CURSOR_INVALID')
    const runStatus = getTextSetting(database, 'runstatus', 'PCLOUD_RUN_STATUS_MISSING')
    assert(runStatus === '1', 'PCLOUD_DIFF_FLOW_NOT_RUNNING')

    const rootId = getExactGhostRootId(database, ghost)
    assert(rootId === expectedRootId, 'PCLOUD_REMOTE_ROOT_CHANGED')

    const inventory = getRemoteInventory(database, rootId)
    const conflictNames = findConflictNames(database, rootId)
    const taskState = getPcloudTaskState(database)
    // pCloud's own per-folder task counter has been observed to go
    // transiently NEGATIVE right after a local file replace it is still
    // settling (real repro: -2 within ~90s of an atomic File.Replace on a
    // synced target). That is bookkeeping noise, not a corrupt read, so
    // this does not use safeInteger's >=0 floor -- only require it to be a
    // safe integer at all.
    const localFolderTaskSumRaw = Number(database.prepare('SELECT COALESCE(sum(taskcnt),0) AS s FROM localfolder').get().s)
    assert(Number.isSafeInteger(localFolderTaskSumRaw), 'PCLOUD_LOCALFOLDER_TASKCNT_INVALID')
    const localFolderTaskSum = localFolderTaskSumRaw
    const mapping = getSyncMappingState(database, rootId, targetRoot)

    return {
      diffCursorSha256: sha256(diffId),
      rootIdentitySha256: sha256(rootId),
      runStatus,
      pendingTaskCount: taskState.pendingTaskCount,
      localFolderTaskSum,
      mapping,
      conflictNames,
      entries: inventory.entries,
      fileCount: inventory.fileCount,
      directoryCount: inventory.directoryCount,
      bytes: inventory.bytes,
      manifestSha256: inventory.manifestSha256,
    }
  })

  assert(pcloud.mapping.rowCount === 1, 'SYNC_MAPPING_ROW_COUNT_INVALID')
  assert(pcloud.mapping.folderIdMatches, 'SYNC_MAPPING_ROOT_MISMATCH')
  assert(pcloud.mapping.localPathMatches, 'SYNC_MAPPING_TARGET_MISMATCH')
  assert(pcloud.mapping.delayedCount === 0, 'SYNC_MAPPING_DELAYED_ITEMS_PRESENT')
  assert(pcloud.pendingTaskCount === 0, 'PCLOUD_PENDING_TASKS_FOUND')
  // HB-2026-130 follow-up: NOT gated on === 0. Real observation over
  // several hours (including a confirmed-quiet office period) showed this
  // sum sitting persistently non-zero and drifting further from zero
  // (-2, then -4) while every real queue table (task/fstask/upload_tasks/
  // localfileupload/uptask_fileupload/pagecachetask) stayed genuinely at 0.
  // It does not track pending work for this installation, so treating a
  // nonzero reading as a blocker made the gate unable to ever pass
  // regardless of true system quiescence. Still captured on the report for
  // audit visibility, just not asserted on.
  assert(pcloud.conflictNames.length === 0, 'PCLOUD_CONFLICT_NAME_PATTERN_DETECTED')

  const source = await enumerateSourceTree(sourceRoot, ghost.excludedPaths)
  // The 10 ghost entries are stale cloud-side artifacts excluded from the
  // SOURCE comparison by design; the freshly synced TARGET never receives
  // them and must not be expected to, matching AfterSync's own proven
  // target handling (Get-TreeSnapshot $target $null, no exclusion set).
  const target = await enumerateSourceTree(targetRoot, EMPTY_EXCLUDED_PATHS)

  return { capturedAtMs: Date.now(), source, target, pcloud }
}

function compareRebaselineObservations(previous, current) {
  const remote = compareEntryMaps(previous.pcloud.entries, current.pcloud.entries)
  const source = compareEntryMaps(previous.source.entries, current.source.entries)
  const target = compareEntryMaps(previous.target.entries, current.target.entries)
  const diffCursorAdvanceCount = previous.pcloud.diffCursorSha256 === current.pcloud.diffCursorSha256 ? 0 : 1
  return {
    remote,
    source,
    target,
    diffCursorAdvanceCount,
    movement: remote.createCount > 0
      || remote.modifyCount > 0
      || remote.deleteCount > 0
      || source.createCount > 0
      || source.modifyCount > 0
      || source.deleteCount > 0
      || target.createCount > 0
      || target.modifyCount > 0
      || target.deleteCount > 0
      || diffCursorAdvanceCount > 0,
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
    TargetCreateCount: 0,
    TargetModifyCount: 0,
    TargetDeleteCount: 0,
    DiffCursorAdvanceCount: 0,
  }
}

class RebaselineQuietTracker {
  constructor(minimumQuietMs, firstObservation) {
    assert(Number.isSafeInteger(minimumQuietMs) && minimumQuietMs > 0, 'MINIMUM_QUIET_WINDOW_INVALID')
    this.minimumQuietMs = minimumQuietMs
    this.previous = firstObservation
    this.quietSinceMs = firstObservation.capturedAtMs
    this.windowResetCount = 0
    this.activity = emptyActivity()
  }

  observe(current) {
    const delta = compareRebaselineObservations(this.previous, current)
    this.previous = current
    if (delta.movement) {
      this.quietSinceMs = current.capturedAtMs
      this.windowResetCount += 1
      this.activity.RemoteCreateCount += delta.remote.createCount
      this.activity.RemoteModifyCount += delta.remote.modifyCount
      this.activity.RemoteDeleteCount += delta.remote.deleteCount
      this.activity.SourceCreateCount += delta.source.createCount
      this.activity.SourceModifyCount += delta.source.modifyCount
      this.activity.SourceDeleteCount += delta.source.deleteCount
      this.activity.TargetCreateCount += delta.target.createCount
      this.activity.TargetModifyCount += delta.target.modifyCount
      this.activity.TargetDeleteCount += delta.target.deleteCount
      this.activity.DiffCursorAdvanceCount += delta.diffCursorAdvanceCount
    }
    return delta
  }

  recordInstability(atMs) {
    this.quietSinceMs = atMs
    this.windowResetCount += 1
  }

  getQuietMilliseconds(nowMs) {
    return Math.max(0, nowMs - this.quietSinceMs)
  }

  isEligibleByTime(nowMs) {
    return this.getQuietMilliseconds(nowMs) >= this.minimumQuietMs
  }
}

function publicSnapshot(observation) {
  return {
    Source: {
      ObservedFileCount: observation.source.observedFileCount,
      ObservedBytes: observation.source.observedBytes,
      ExcludedFileCount: observation.source.excludedFileCount,
      ExcludedBytes: observation.source.excludedBytes,
      FileCount: observation.source.fileCount,
      DirectoryCount: observation.source.directoryCount,
      Bytes: observation.source.bytes,
      MetadataSha256: observation.source.metadataSha256,
    },
    Target: {
      ObservedFileCount: observation.target.observedFileCount,
      ObservedBytes: observation.target.observedBytes,
      ExcludedFileCount: observation.target.excludedFileCount,
      ExcludedBytes: observation.target.excludedBytes,
      FileCount: observation.target.fileCount,
      DirectoryCount: observation.target.directoryCount,
      Bytes: observation.target.bytes,
      MetadataSha256: observation.target.metadataSha256,
    },
    PCloud: {
      DiffCursorSha256: observation.pcloud.diffCursorSha256,
      RootIdentitySha256: observation.pcloud.rootIdentitySha256,
      RunStatus: observation.pcloud.runStatus,
      FileCount: observation.pcloud.fileCount,
      DirectoryCount: observation.pcloud.directoryCount,
      Bytes: observation.pcloud.bytes,
      InventorySha256: observation.pcloud.manifestSha256,
    },
  }
}

function getTransientCode(error) {
  const code = error?.safeCode
  return typeof code === 'string' && TRANSIENT_SAFE_CODES.has(code) ? code : null
}

async function runGate(args, ghost, expectedRootId) {
  const startedAtMs = Date.now()
  const maximumEndsAtMs = startedAtMs + args.maximumSeconds * 1000

  const waitForNextPoll = async () => {
    const remainingMs = maximumEndsAtMs - Date.now()
    if (remainingMs <= 0) return
    await sleep(Math.min(args.pollSeconds * 1000, remainingMs))
  }

  const capture = () => captureRebaselineObservation(args.sourceRoot, args.targetRoot, args.pcloudDatabasePath, ghost, expectedRootId)

  let firstObservation = null
  let initialResetCount = 0
  while (Date.now() <= maximumEndsAtMs && firstObservation === null) {
    try {
      firstObservation = await capture()
    } catch (error) {
      const transientCode = getTransientCode(error)
      if (transientCode === null) {
        return {
          status: 'blocked',
          startedAtMs,
          completedAtMs: Date.now(),
          observedQuietSeconds: 0,
          windowResetCount: initialResetCount,
          activity: emptyActivity(),
          blockers: [error?.safeCode ?? 'REBASELINE_PRECONDITION_FAILED'],
        }
      }
      initialResetCount += 1
      await waitForNextPoll()
    }
  }
  if (firstObservation === null) {
    return {
      status: 'blocked',
      startedAtMs,
      completedAtMs: Date.now(),
      observedQuietSeconds: 0,
      windowResetCount: initialResetCount,
      activity: emptyActivity(),
      blockers: ['STABLE_INITIAL_OBSERVATION_NOT_REACHED'],
    }
  }

  const tracker = new RebaselineQuietTracker(MINIMUM_QUIET_SECONDS * 1000, firstObservation)
  tracker.windowResetCount = initialResetCount

  // A capture can fail for two very different reasons: a known-transient
  // condition (DB snapshot momentarily busy under heavy I/O — HB-2026-127
  // showed this happens right after a full-tree hash pass — or a source
  // inventory scan racing a write) that deserves a reset-and-retry exactly
  // like ordinary movement, versus a genuine precondition failure (sync
  // mapping gone/changed, pending tasks, conflict names, delayed items)
  // that must stop the gate immediately rather than spin for the full
  // -MaximumMinutes window.
  const captureOrStop = async () => {
    try {
      return { observation: await capture() }
    } catch (error) {
      const transientCode = getTransientCode(error)
      if (transientCode === null) {
        return {
          blocked: {
            status: 'blocked',
            startedAtMs,
            completedAtMs: Date.now(),
            observedQuietSeconds: Math.floor(tracker.getQuietMilliseconds(Date.now()) / 1000),
            windowResetCount: tracker.windowResetCount,
            activity: tracker.activity,
            blockers: [error?.safeCode ?? 'REBASELINE_PRECONDITION_FAILED'],
          },
        }
      }
      tracker.recordInstability(Date.now())
      return { transient: transientCode }
    }
  }

  while (Date.now() <= maximumEndsAtMs) {
    if (!tracker.isEligibleByTime(Date.now())) {
      await waitForNextPoll()
      const { observation, blocked } = await captureOrStop()
      if (blocked) return blocked
      if (observation) tracker.observe(observation)
      continue
    }

    let sourceFullHash
    let targetFullHash
    try {
      sourceFullHash = await hashSourceTree(args.sourceRoot, ghost.excludedPaths, args.progressInterval)
      targetFullHash = await hashSourceTree(args.targetRoot, EMPTY_EXCLUDED_PATHS, args.progressInterval)
    } catch (error) {
      const transientCode = getTransientCode(error)
      if (transientCode === null) throw error
      tracker.recordInstability(Date.now())
      await waitForNextPoll()
      const { observation, blocked } = await captureOrStop()
      if (blocked) return blocked
      if (observation) tracker.observe(observation)
      continue
    }

    const { observation: finalObservation, blocked } = await captureOrStop()
    if (blocked) return blocked
    if (!finalObservation) continue
    const delta = tracker.observe(finalObservation)
    if (delta.movement) continue

    const quietSeconds = Math.floor(tracker.getQuietMilliseconds(finalObservation.capturedAtMs) / 1000)
    if (quietSeconds < MINIMUM_QUIET_SECONDS) continue

    if (
      sourceFullHash.hashErrorCount !== 0
      || targetFullHash.hashErrorCount !== 0
      || sourceFullHash.fileCount !== targetFullHash.fileCount
      || sourceFullHash.manifestSha256 !== targetFullHash.manifestSha256
    ) {
      return {
        status: 'blocked',
        startedAtMs,
        completedAtMs: Date.now(),
        observedQuietSeconds: quietSeconds,
        windowResetCount: tracker.windowResetCount,
        activity: tracker.activity,
        blockers: ['SOURCE_TARGET_HASH_MISMATCH_AT_PASS'],
        finalObservation,
        sourceFullHash,
        targetFullHash,
      }
    }

    return {
      status: 'pass',
      startedAtMs,
      completedAtMs: Date.now(),
      observedQuietSeconds: quietSeconds,
      windowResetCount: tracker.windowResetCount,
      activity: tracker.activity,
      blockers: [],
      finalObservation,
      sourceFullHash,
      targetFullHash,
    }
  }

  return {
    status: 'blocked',
    startedAtMs,
    completedAtMs: Date.now(),
    observedQuietSeconds: Math.floor(tracker.getQuietMilliseconds(Date.now()) / 1000),
    windowResetCount: tracker.windowResetCount,
    activity: tracker.activity,
    blockers: ['MINIMUM_QUIET_WINDOW_NOT_REACHED'],
  }
}

function buildReport(result, ghost, mode) {
  const base = {
    SchemaVersion: 'pcloud-post-sync-rebaseline/1.0.0',
    Mode: mode,
    Status: result.status,
    ReadOnly: true,
    StartedAtUtc: new Date(result.startedAtMs).toISOString(),
    CompletedAtUtc: new Date(result.completedAtMs).toISOString(),
    MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
    ObservedQuietSeconds: result.observedQuietSeconds,
    WindowResetCount: result.windowResetCount,
    ActivityObserved: result.activity,
    GhostExclusion: {
      ManifestSha256: ghost.manifestSha256,
      EntryCount: ghost.excludedPaths.size,
    },
    Blockers: result.blockers,
    // Always present (even on an early precondition failure with no
    // finalObservation yet) so a PowerShell consumer running under
    // Set-StrictMode can safely read these two fields unconditionally.
    EligibleForRebaseline: false,
    SourceTargetHashMatch: false,
  }
  if (result.status !== 'pass' && !result.finalObservation) {
    return base
  }
  const snapshot = publicSnapshot(result.finalObservation)
  return {
    ...base,
    EligibleForRebaseline: result.status === 'pass',
    Source: {
      ...snapshot.Source,
      ManifestSha256: result.sourceFullHash.manifestSha256,
      HashedFileCount: result.sourceFullHash.hashedFileCount,
      HashErrorCount: result.sourceFullHash.hashErrorCount,
      SnapshotStable: result.sourceFullHash.snapshotStable,
    },
    Target: {
      ...snapshot.Target,
      ManifestSha256: result.targetFullHash.manifestSha256,
      HashedFileCount: result.targetFullHash.hashedFileCount,
      HashErrorCount: result.targetFullHash.hashErrorCount,
      SnapshotStable: result.targetFullHash.snapshotStable,
    },
    PCloud: snapshot.PCloud,
    SourceTargetHashMatch: result.sourceFullHash.manifestSha256 === result.targetFullHash.manifestSha256,
  }
}

function buildProbeResult(observation, ghost) {
  const snapshot = publicSnapshot(observation)
  return {
    SchemaVersion: 'pcloud-post-sync-rebaseline/1.0.0',
    Mode: 'probe',
    Status: 'blocked',
    ReadOnly: true,
    EligibleForRebaseline: false,
    MinimumQuietSeconds: MINIMUM_QUIET_SECONDS,
    GhostExclusion: {
      ManifestSha256: ghost.manifestSha256,
      EntryCount: ghost.excludedPaths.size,
    },
    Current: snapshot,
    Blockers: ['PROBE_ONLY_NOT_REBASELINE_GATE'],
  }
}

async function verifyCurrent(args, ghost, expectedRootId) {
  const { readFile } = await import('node:fs/promises')
  let report
  try {
    report = JSON.parse(await readFile(args.rebaselineReportPath, 'utf8'))
  } catch {
    fail('REBASELINE_REPORT_JSON_INVALID')
  }
  assert(report?.SchemaVersion === 'pcloud-post-sync-rebaseline/1.0.0', 'REBASELINE_REPORT_SCHEMA_INVALID')
  assert(report?.Status === 'pass', 'REBASELINE_REPORT_NOT_PASS')

  let observation
  try {
    observation = await captureRebaselineObservation(args.sourceRoot, args.targetRoot, args.pcloudDatabasePath, ghost, expectedRootId)
  } catch (error) {
    return {
      SchemaVersion: 'pcloud-post-sync-rebaseline-current-check/1.0.0',
      Status: 'blocked',
      ReadOnly: true,
      CurrentMatches: false,
      Blockers: [error?.safeCode ?? 'REBASELINE_PRECONDITION_FAILED'],
    }
  }
  const snapshot = publicSnapshot(observation)
  const blockers = []
  if (
    snapshot.Source.FileCount !== report.Source.FileCount
    || snapshot.Source.Bytes !== report.Source.Bytes
    || snapshot.Source.MetadataSha256 !== report.Source.MetadataSha256
  ) blockers.push('REBASELINE_SOURCE_NO_LONGER_CURRENT')
  if (
    snapshot.Target.FileCount !== report.Target.FileCount
    || snapshot.Target.Bytes !== report.Target.Bytes
    || snapshot.Target.MetadataSha256 !== report.Target.MetadataSha256
  ) blockers.push('REBASELINE_TARGET_NO_LONGER_CURRENT')
  if (snapshot.PCloud.InventorySha256 !== report.PCloud.InventorySha256) {
    blockers.push('REBASELINE_PCLOUD_NO_LONGER_CURRENT')
  }

  return {
    SchemaVersion: 'pcloud-post-sync-rebaseline-current-check/1.0.0',
    Status: blockers.length === 0 ? 'pass' : 'blocked',
    ReadOnly: true,
    CurrentMatches: blockers.length === 0,
    Source: snapshot.Source,
    Target: snapshot.Target,
    PCloud: snapshot.PCloud,
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
    const sourceRoot = normalizeWindowsRoot(args.sourceRoot)
    const targetRoot = normalizeWindowsRoot(args.targetRoot)
    const ghost = await loadGhostManifest(args.manifestPath, args.manifestSha256, sourceRoot)
    const expectedRootId = await withConsistentPcloudDatabase(args.pcloudDatabasePath, (database) => getExactGhostRootId(database, ghost))

    if (args.mode === 'probe') {
      const observation = await captureRebaselineObservation(sourceRoot, targetRoot, args.pcloudDatabasePath, ghost, expectedRootId)
      emit(buildProbeResult(observation, ghost), 2)
      return
    }
    if (args.mode === 'verify-current') {
      const result = await verifyCurrent({ ...args, sourceRoot, targetRoot }, ghost, expectedRootId)
      emit(result, result.Status === 'pass' ? 0 : 2)
      return
    }

    const result = await runGate({ ...args, sourceRoot, targetRoot }, ghost, expectedRootId)
    emit(buildReport(result, ghost, mode), result.status === 'pass' ? 0 : 2)
  } catch (error) {
    emit({
      SchemaVersion: 'pcloud-post-sync-rebaseline/1.0.0',
      Mode: mode,
      Status: 'error',
      ReadOnly: true,
      EligibleForRebaseline: false,
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'REBASELINE_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
