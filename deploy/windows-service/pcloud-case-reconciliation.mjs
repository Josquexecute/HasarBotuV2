import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildDiffForensicsReport } from './pcloud-post-sync-diff-forensics.mjs'

// Per-case pCloud reconciliation engine (HB-2026-162).
//
// This module is READ-ONLY: it never writes to pCloud's database, source,
// target, env or services, and it has no delete capability whatsoever.
//
// It replaces the GLOBAL 600-second whole-tree quiescence gate
// (pcloud-post-sync-rebaseline-gate.mjs) as the precondition for individual
// critical operations. The global gate answers "has EVERYTHING in the
// entire tenant tree finished syncing" — but no real critical operation
// (File Agent move/rename) ever needs that; each one only ever touches ONE
// case's folder (see case_file_operations_one_active_case in
// packages/database — at most one active file-operation saga per case at a
// time already). This module answers the narrower, actually-needed
// question: "has THIS ONE case's folder settled" — via a live per-file
// pCloud identity fence (fileId/revision/size/hash), not a whole-tree
// snapshot. See docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md for the
// full design and the invariants (INV-1..6) this rests on.
//
// It classifies every non-identical, non-metadata_only difference into
// exactly one PatternClassification:
//   - stale_target:     target does not reflect the current, live pCloud
//                        object for this exact file (either a genuine
//                        older-but-complete prior revision, or the
//                        zero-byte/incomplete-download-placeholder variant
//                        first observed in HB-2026-159..162's real
//                        22-difference classification pass) — a safe,
//                        provable repair-tool candidate.
//   - rename_artifact:   a `missing` entry and an `extra` entry in the SAME
//                        case share an identical SHA-256 — proof the file
//                        moved between two relative paths and only one side
//                        has caught up.
//   - unknown:           real difference that does not cleanly match either
//                        of the above with the evidence gathered. NEVER
//                        auto-resolved, NEVER auto-deleted.
// metadata_only entries are always ignored (content is provably identical).
//
// CaseStatus (the File-Agent-facing verdict) is one of:
//   - ready:    no missing/extra/content_mismatch entries and no
//               conflict-name artifacts under this case folder.
//   - syncing:  at least one affected file currently has a live pCloud
//               task/fstask reference (taskReferenceCount > 0) — pCloud is
//               actively working on it right now; expected to self-resolve.
//   - conflict: a real difference or conflict-name artifact exists with no
//               live task activity — needs resolution (repair/cleanup/
//               manual), not expected to self-resolve.
//   - unknown:  the case folder could not be read on one or both sides, or
//               the underlying diff step failed for a read-only-safe
//               reason (e.g. a fresh probe hit a genuinely ambiguous
//               state). Fail-closed: a File Agent freshness gate MUST
//               treat unknown exactly like conflict (never proceed).

class SafeError extends Error {
  constructor(safeCode, safeDetails = null) {
    super(safeCode)
    this.name = 'SafeError'
    this.safeCode = safeCode
    this.safeDetails = safeDetails
  }
}
function fail(safeCode, safeDetails = null) { throw new SafeError(safeCode, safeDetails) }
function assert(condition, safeCode) { if (!condition) fail(safeCode) }

async function directoryExists(fullPath) {
  try {
    const info = await lstat(fullPath, { bigint: true })
    return info.isDirectory() && !info.isSymbolicLink()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function normalizeCaseRelativePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'CASE_RELATIVE_PATH_INVALID')
  assert(!path.win32.isAbsolute(value), 'CASE_RELATIVE_PATH_ABSOLUTE')
  assert(!value.split(/[\\/]+/).some((segment) => segment.length === 0 || segment === '.' || segment === '..'), 'CASE_RELATIVE_PATH_UNSAFE')
  return value
}

function classifyContentMismatchPattern(entry) {
  if (entry.Target && entry.Target.Size === 0) {
    return { pattern: 'stale_target', note: 'Target is a 0-byte placeholder; treated as stale_target (incomplete/interrupted local download variant).' }
  }
  if (entry.Currency === 'source_current_target_superseded') {
    return { pattern: 'stale_target', note: 'pCloud currentRow matches source (current); a distinct older revision matches target — genuine content supersession.' }
  }
  return { pattern: 'unknown', note: `Currency=${entry.Currency} does not cleanly match the stale_target signature.` }
}

function applyRenameArtifactPairing(entries) {
  const missingBySha = new Map()
  const extraBySha = new Map()
  for (const entry of entries) {
    if (entry.Classification === 'missing' && entry.Source?.Sha256) {
      if (!missingBySha.has(entry.Source.Sha256)) missingBySha.set(entry.Source.Sha256, [])
      missingBySha.get(entry.Source.Sha256).push(entry)
    }
    if (entry.Classification === 'extra' && entry.Target?.Sha256) {
      if (!extraBySha.has(entry.Target.Sha256)) extraBySha.set(entry.Target.Sha256, [])
      extraBySha.get(entry.Target.Sha256).push(entry)
    }
  }
  const paired = new Set()
  for (const [sha256, missingEntries] of missingBySha) {
    const extraEntries = extraBySha.get(sha256)
    if (!extraEntries) continue
    for (const entry of missingEntries) paired.add(entry)
    for (const entry of extraEntries) paired.add(entry)
  }
  return paired
}

export async function reconcileCase(args) {
  const caseRelativePath = normalizeCaseRelativePath(args.caseRelativePath)
  const sourceCasePath = path.join(path.win32.normalize(path.win32.resolve(args.sourceRoot)), caseRelativePath)
  const targetCasePath = path.join(path.win32.normalize(path.win32.resolve(args.targetRoot)), caseRelativePath)
  const [sourceExists, targetExists] = await Promise.all([directoryExists(sourceCasePath), directoryExists(targetCasePath)])

  if (!sourceExists && !targetExists) {
    return {
      SchemaVersion: 'hasarbotu-pcloud-case-reconciliation/1.0.0',
      Status: 'ok',
      ReadOnly: true,
      GeneratedAtUtc: new Date().toISOString(),
      CaseRelativePath: caseRelativePath,
      CaseStatus: 'unknown',
      CaseStatusReason: 'CASE_FOLDER_NOT_FOUND_ON_EITHER_SIDE',
      PCloudQueueState: null,
      ConflictNamesFound: [],
      Summary: null,
      Entries: [],
      PatternCounts: {},
    }
  }
  if (!sourceExists || !targetExists) {
    return {
      SchemaVersion: 'hasarbotu-pcloud-case-reconciliation/1.0.0',
      Status: 'ok',
      ReadOnly: true,
      GeneratedAtUtc: new Date().toISOString(),
      CaseRelativePath: caseRelativePath,
      CaseStatus: 'conflict',
      CaseStatusReason: sourceExists ? 'CASE_FOLDER_MISSING_ON_TARGET' : 'CASE_FOLDER_MISSING_ON_SOURCE',
      PCloudQueueState: null,
      ConflictNamesFound: [],
      Summary: null,
      Entries: [],
      PatternCounts: {},
    }
  }

  let diffReport
  try {
    diffReport = await buildDiffForensicsReport({
      sourceRoot: args.sourceRoot,
      targetRoot: args.targetRoot,
      manifestPath: args.manifestPath,
      manifestSha256: args.manifestSha256,
      pcloudDatabasePath: args.pcloudDatabasePath,
      progressInterval: args.progressInterval ?? 0,
      caseRelativePath,
    })
  } catch (error) {
    return {
      SchemaVersion: 'hasarbotu-pcloud-case-reconciliation/1.0.0',
      Status: 'ok',
      ReadOnly: true,
      GeneratedAtUtc: new Date().toISOString(),
      CaseRelativePath: caseRelativePath,
      CaseStatus: 'unknown',
      CaseStatusReason: typeof error?.safeCode === 'string' ? error.safeCode : 'CASE_DIFF_RUNTIME_ERROR',
      PCloudQueueState: null,
      ConflictNamesFound: [],
      Summary: null,
      Entries: [],
      PatternCounts: {},
    }
  }

  const realEntries = diffReport.Entries.filter((entry) => entry.Classification !== 'metadata_only')
  const renamePaired = applyRenameArtifactPairing(realEntries)

  const classifiedEntries = realEntries.map((entry) => {
    if (renamePaired.has(entry)) {
      return { ...entry, PatternClassification: 'rename_artifact', PatternNote: 'Paired with a same-case, same-SHA-256 missing/extra counterpart.' }
    }
    if (entry.Classification === 'content_mismatch') {
      const { pattern, note } = classifyContentMismatchPattern(entry)
      return { ...entry, PatternClassification: pattern, PatternNote: note }
    }
    if (entry.Classification === 'missing') {
      return { ...entry, PatternClassification: 'unknown', PatternNote: 'Present in source, absent from target, and no rename pairing proven within this case. Could be a not-yet-downloaded upload (pCloud has it) or a genuine gap -- not distinguished further here; see PCloud.found on this entry.' }
    }
    return { ...entry, PatternClassification: 'unknown', PatternNote: 'Present in target, absent from source, and no rename pairing proven within this case.' }
  })

  const patternCounts = {}
  for (const entry of classifiedEntries) patternCounts[entry.PatternClassification] = (patternCounts[entry.PatternClassification] ?? 0) + 1

  const hasConflictNames = diffReport.ConflictNamesFound.length > 0
  const hasRealDifference = classifiedEntries.length > 0 || hasConflictNames
  // "syncing" is intentionally narrow (fail-closed, INV-4): it only applies
  // when EVERY outstanding difference has live pCloud task evidence right
  // now AND there are no unexplained conflict-name artifacts. A single
  // stuck/unexplained file — even alongside genuinely syncing ones —
  // downgrades the whole case to "conflict", never masked by the others.
  const allAffectedFilesSyncing = classifiedEntries.length > 0
    && classifiedEntries.every((entry) => (entry.PCloud?.TaskReferenceCount ?? 0) > 0)
    && !hasConflictNames

  let caseStatus
  let caseStatusReason
  if (!hasRealDifference) {
    caseStatus = 'ready'
    caseStatusReason = 'NO_REAL_DIFFERENCE_OR_CONFLICT_NAME'
  } else if (allAffectedFilesSyncing) {
    caseStatus = 'syncing'
    caseStatusReason = 'ALL_AFFECTED_FILES_HAVE_LIVE_PCLOUD_TASK_REFERENCE'
  } else {
    caseStatus = 'conflict'
    caseStatusReason = classifiedEntries.length === 0 ? 'CONFLICT_NAME_ARTIFACT_FOUND' : 'UNRESOLVED_DIFFERENCE_OR_CONFLICT_NAME_PRESENT'
  }

  return {
    SchemaVersion: 'hasarbotu-pcloud-case-reconciliation/1.0.0',
    Status: 'ok',
    ReadOnly: true,
    GeneratedAtUtc: new Date().toISOString(),
    CaseRelativePath: caseRelativePath,
    CaseStatus: caseStatus,
    CaseStatusReason: caseStatusReason,
    PCloudQueueState: diffReport.PCloudQueueState,
    ConflictNamesFound: diffReport.ConflictNamesFound,
    Summary: diffReport.Summary,
    PatternCounts: patternCounts,
    Entries: classifiedEntries,
  }
}

function parseArguments(argv) {
  const allowed = new Set([
    '--source-root',
    '--target-root',
    '--ghost-manifest',
    '--ghost-manifest-sha256',
    '--pcloud-db',
    '--case-relative-path',
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
  for (const key of ['--source-root', '--target-root', '--ghost-manifest', '--ghost-manifest-sha256', '--pcloud-db', '--case-relative-path']) {
    assert(values.has(key), 'ARGUMENT_MISSING')
  }
  const progressIntervalRaw = values.get('--progress-interval') ?? '0'
  assert(/^[0-9]+$/.test(progressIntervalRaw), 'PROGRESS_INTERVAL_INVALID')
  return {
    sourceRoot: values.get('--source-root'),
    targetRoot: values.get('--target-root'),
    manifestPath: values.get('--ghost-manifest'),
    manifestSha256: values.get('--ghost-manifest-sha256'),
    pcloudDatabasePath: values.get('--pcloud-db'),
    caseRelativePath: values.get('--case-relative-path'),
    progressInterval: Number(progressIntervalRaw),
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const report = await reconcileCase(args)
    emit(report, report.CaseStatus === 'ready' ? 0 : 2)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-pcloud-case-reconciliation/1.0.0',
      Status: 'error',
      ReadOnly: true,
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'CASE_RECONCILIATION_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
