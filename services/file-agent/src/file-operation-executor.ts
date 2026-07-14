import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, type Dirent, type Stats } from 'node:fs'
import { lstat, mkdir, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type {
  FileOperationResult,
  FileOperationStrategy,
  JobPayload,
} from '@hasarbotu/contracts'
import { parseRelativePath } from '@hasarbotu/domain'
import { isUnderRoot, PathSafetyError, resolveUnderRoot } from './path-resolver.js'
import { streamSha256 } from './verifier.js'

type ApplyPayload = Extract<JobPayload, { readonly kind: 'file_operation' }>
type CleanupPayload = Extract<JobPayload, { readonly kind: 'file_operation_cleanup' }>

export interface WorkspaceManifestEntry {
  readonly relativePath: string
  readonly type: 'file' | 'directory'
  readonly byteSize: number
  readonly sha256: string | null
}

export interface WorkspaceManifest {
  readonly manifestHash: string
  readonly fileCount: number
  readonly directoryCount: number
  readonly totalBytes: number
  readonly latestModifiedMs: number
  /** Yalnız Agent process belleğinde kullanılır; API/DB/audit'e gönderilmez. */
  readonly entries: readonly WorkspaceManifestEntry[]
}

export interface FileSystemAdapter {
  lstat(path: string): Promise<Stats>
  realpath(path: string): Promise<string>
  readdir(path: string): Promise<Dirent[]>
  mkdir(path: string): Promise<void>
  rename(source: string, destination: string): Promise<void>
  unlink(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  hashFile(path: string): Promise<{ hash: string; size: number }>
  copyFileStreaming(source: string, destination: string): Promise<void>
}

export const nodeFileSystemAdapter: FileSystemAdapter = {
  lstat,
  realpath,
  readdir: (path) => readdir(path, { withFileTypes: true }),
  mkdir,
  rename,
  unlink,
  rmdir,
  hashFile: streamSha256,
  async copyFileStreaming(source, destination) {
    await pipeline(createReadStream(source), createWriteStream(destination, { flags: 'wx' }))
  },
}

export interface FileOperationExecutionResult {
  readonly outcome: 'verified' | 'missing' | 'failed'
  readonly errorCode?: string
  readonly fileOperation?: FileOperationResult
  readonly observedHash?: undefined
  readonly observedSize?: undefined
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

function safeFailureCode(error: unknown, fallback: string): string {
  if (error instanceof PathSafetyError) return error.code
  switch (errno(error)) {
    case 'ENOENT': return 'source_missing'
    case 'EEXIST':
    case 'ENOTEMPTY': return 'destination_exists'
    case 'EACCES':
    case 'EPERM': return 'access_denied'
    case 'EBUSY': return 'file_locked'
    case 'ENOSPC': return 'disk_full'
    default: return fallback
  }
}

async function pathKind(fs: FileSystemAdapter, path: string): Promise<'missing' | 'directory' | 'unsafe'> {
  try {
    const metadata = await fs.lstat(path)
    if (metadata.isSymbolicLink()) return 'unsafe'
    return metadata.isDirectory() ? 'directory' : 'unsafe'
  } catch (error) {
    if (errno(error) === 'ENOENT') return 'missing'
    throw error
  }
}

async function assertOrdinaryDirectory(
  fs: FileSystemAdapter,
  rootReal: string,
  candidate: string,
): Promise<Stats> {
  const metadata = await fs.lstat(candidate)
  if (metadata.isSymbolicLink()) throw new PathSafetyError('reparse_point_rejected', 'reparse point is not allowed')
  if (!metadata.isDirectory()) throw new PathSafetyError('not_a_directory', 'directory expected')
  const resolved = await fs.realpath(candidate)
  if (!isUnderRoot(rootReal, resolved)) throw new PathSafetyError('root_escape', 'real path escapes root')
  return metadata
}

async function rootContext(fs: FileSystemAdapter, rootAbsolute: string): Promise<{ rootReal: string }> {
  const metadata = await fs.lstat(rootAbsolute)
  if (metadata.isSymbolicLink()) throw new PathSafetyError('root_reparse_point_rejected', 'root reparse point is not allowed')
  if (!metadata.isDirectory()) throw new PathSafetyError('root_not_a_directory', 'root directory expected')
  return { rootReal: await fs.realpath(rootAbsolute) }
}

function compareNames(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/**
 * Kaynak ağacın deterministik, içerik-özetli manifestini üretir. Dosyalar
 * streaming SHA-256 ile okunur. Tam entry listesi process belleğinde kalır;
 * yalnız hash ve sayaçlar dış protokole çıkar.
 */
export async function buildWorkspaceManifest(
  fs: FileSystemAdapter,
  rootAbsolute: string,
  relativePath: string,
): Promise<WorkspaceManifest> {
  const { rootReal } = await rootContext(fs, rootAbsolute)
  const workspaceAbsolute = resolveUnderRoot(rootAbsolute, relativePath)
  const entries: WorkspaceManifestEntry[] = []
  let latestModifiedMs = 0

  async function visit(absolutePath: string, entryPath: string): Promise<void> {
    const metadata = await fs.lstat(absolutePath)
    if (metadata.isSymbolicLink()) throw new PathSafetyError('reparse_point_rejected', 'manifest contains reparse point')
    const resolved = await fs.realpath(absolutePath)
    if (!isUnderRoot(rootReal, resolved)) throw new PathSafetyError('root_escape', 'manifest entry escapes root')
    latestModifiedMs = Math.max(latestModifiedMs, metadata.mtimeMs)

    if (metadata.isDirectory()) {
      entries.push({ relativePath: entryPath, type: 'directory', byteSize: 0, sha256: null })
      const children = (await fs.readdir(absolutePath)).sort(compareNames)
      for (const child of children) {
        const childPath = entryPath.length === 0 ? child.name : `${entryPath}/${child.name}`
        if (!parseRelativePath(childPath).ok) throw new PathSafetyError('unsafe_source_entry', 'unsafe manifest entry')
        await visit(join(absolutePath, child.name), childPath)
      }
      return
    }
    if (!metadata.isFile()) throw new PathSafetyError('unsupported_source_entry', 'unsupported filesystem entry')
    const observed = await fs.hashFile(absolutePath)
    entries.push({ relativePath: entryPath, type: 'file', byteSize: observed.size, sha256: observed.hash })
  }

  await visit(workspaceAbsolute, '')
  const canonical = entries.map((entry) => JSON.stringify(entry)).join('\n')
  return {
    manifestHash: createHash('sha256').update(canonical).digest('hex'),
    fileCount: entries.filter((entry) => entry.type === 'file').length,
    directoryCount: entries.filter((entry) => entry.type === 'directory').length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.byteSize, 0),
    latestModifiedMs,
    entries,
  }
}

function sameManifest(left: WorkspaceManifest, right: WorkspaceManifest): boolean {
  return left.manifestHash === right.manifestHash
    && left.fileCount === right.fileCount
    && left.directoryCount === right.directoryCount
    && left.totalBytes === right.totalBytes
}

function manifestResult(
  phase: 'destination_verified' | 'cleanup_completed',
  strategy: FileOperationStrategy,
  manifest: WorkspaceManifest,
  safeOutcomeCode?: string,
): FileOperationExecutionResult {
  return {
    outcome: 'verified',
    fileOperation: {
      phase,
      strategy,
      manifestHash: manifest.manifestHash,
      fileCount: manifest.fileCount,
      directoryCount: manifest.directoryCount,
      totalBytes: manifest.totalBytes,
      ...(safeOutcomeCode === undefined ? {} : { safeOutcomeCode }),
    },
  }
}

function manualRecovery(strategy: FileOperationStrategy, code: string): FileOperationExecutionResult {
  return {
    outcome: 'failed',
    errorCode: code,
    fileOperation: { phase: 'manual_recovery_required', strategy, safeOutcomeCode: code },
  }
}

async function ensureParentChain(
  fs: FileSystemAdapter,
  rootAbsolute: string,
  rootReal: string,
  relativePath: string,
): Promise<void> {
  const segments = relativePath.split('/')
  segments.pop()
  if (segments.length === 0) return
  let current = rootAbsolute
  for (const segment of segments) {
    current = join(current, segment)
    try {
      await assertOrdinaryDirectory(fs, rootReal, current)
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error
      await fs.mkdir(current)
      await assertOrdinaryDirectory(fs, rootReal, current)
    }
  }
}

async function copyManifestTree(
  fs: FileSystemAdapter,
  sourceAbsolute: string,
  stagingAbsolute: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  await fs.mkdir(stagingAbsolute)
  for (const entry of manifest.entries) {
    if (entry.relativePath.length === 0) continue
    const source = join(sourceAbsolute, ...entry.relativePath.split('/'))
    const destination = join(stagingAbsolute, ...entry.relativePath.split('/'))
    if (entry.type === 'directory') await fs.mkdir(destination)
    else await fs.copyFileStreaming(source, destination)
  }
}

async function stagedCopy(
  fs: FileSystemAdapter,
  sourceRoot: string,
  destinationRoot: string,
  payload: ApplyPayload,
  sourceManifest: WorkspaceManifest,
): Promise<FileOperationExecutionResult> {
  const destinationContext = await rootContext(fs, destinationRoot)
  const sourceAbsolute = resolveUnderRoot(sourceRoot, payload.source.relativePath)
  const destinationAbsolute = resolveUnderRoot(destinationRoot, payload.destination.relativePath)
  const stagingAbsolute = resolveUnderRoot(destinationRoot, payload.stagingRelativePath)
  await ensureParentChain(fs, destinationRoot, destinationContext.rootReal, payload.destination.relativePath)
  await ensureParentChain(fs, destinationRoot, destinationContext.rootReal, payload.stagingRelativePath)

  const destinationKind = await pathKind(fs, destinationAbsolute)
  const stagingKind = await pathKind(fs, stagingAbsolute)
  if (destinationKind === 'unsafe' || stagingKind === 'unsafe') return manualRecovery('staged_copy', 'unexpected_filesystem_entry')
  if (destinationKind === 'directory') {
    if (stagingKind !== 'missing') return manualRecovery('staged_copy', 'ambiguous_filesystem_state')
    const destinationManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
    return sameManifest(sourceManifest, destinationManifest)
      ? manifestResult('destination_verified', 'staged_copy', destinationManifest, 'recovered_existing_destination')
      : manualRecovery('staged_copy', 'destination_manifest_mismatch')
  }

  if (stagingKind === 'missing') {
    await copyManifestTree(fs, sourceAbsolute, stagingAbsolute, sourceManifest)
  }
  const stagingManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.stagingRelativePath)
  if (!sameManifest(sourceManifest, stagingManifest)) return manualRecovery('staged_copy', 'staging_manifest_mismatch')

  try {
    await fs.rename(stagingAbsolute, destinationAbsolute)
  } catch (error) {
    const destinationAfter = await pathKind(fs, destinationAbsolute)
    const stagingAfter = await pathKind(fs, stagingAbsolute)
    if (destinationAfter === 'directory' && stagingAfter === 'missing') {
      const recovered = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
      return sameManifest(sourceManifest, recovered)
        ? manifestResult('destination_verified', 'staged_copy', recovered, 'recovered_after_publish')
        : manualRecovery('staged_copy', 'destination_manifest_mismatch')
    }
    return manualRecovery('staged_copy', safeFailureCode(error, 'publish_failed'))
  }

  const destinationManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
  return sameManifest(sourceManifest, destinationManifest)
    ? manifestResult('destination_verified', 'staged_copy', destinationManifest)
    : manualRecovery('staged_copy', 'destination_manifest_mismatch')
}

async function applyOperation(
  roots: Readonly<Record<string, string>>,
  payload: ApplyPayload,
  fs: FileSystemAdapter,
): Promise<FileOperationExecutionResult> {
  const sourceRoot = roots[payload.source.storageRootKey]
  const destinationRoot = roots[payload.destination.storageRootKey]
  if (sourceRoot === undefined || destinationRoot === undefined) return { outcome: 'failed', errorCode: 'unknown_root_mapping' }
  try {
    await rootContext(fs, sourceRoot)
    await rootContext(fs, destinationRoot)
    const sourceAbsolute = resolveUnderRoot(sourceRoot, payload.source.relativePath)
    const destinationAbsolute = resolveUnderRoot(destinationRoot, payload.destination.relativePath)
    const caseOnlyLogicalRename = payload.source.storageRootKey === payload.destination.storageRootKey
      && payload.source.relativePath !== payload.destination.relativePath
      && payload.source.relativePath.toLocaleLowerCase('tr-TR') === payload.destination.relativePath.toLocaleLowerCase('tr-TR')
    const sourceKind = await pathKind(fs, sourceAbsolute)
    const destinationKind = await pathKind(fs, destinationAbsolute)
    if (sourceKind === 'unsafe' || destinationKind === 'unsafe') return manualRecovery(payload.strategy, 'unexpected_filesystem_entry')

    if (sourceKind === 'missing') {
      if (destinationKind === 'directory' && payload.strategy === 'atomic_rename') {
        const recovered = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
        return manifestResult('destination_verified', 'atomic_rename', recovered, 'recovered_after_rename')
      }
      return payload.strategy === 'staged_copy' && destinationKind === 'directory'
        ? manualRecovery('staged_copy', 'source_missing_after_copy')
        : { outcome: 'missing', errorCode: 'source_missing' }
    }
    if (destinationKind === 'directory' && !caseOnlyLogicalRename) {
      const sourceManifest = await buildWorkspaceManifest(fs, sourceRoot, payload.source.relativePath)
      if (payload.strategy === 'staged_copy') {
        const destinationManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
        return sameManifest(sourceManifest, destinationManifest)
          ? manifestResult('destination_verified', 'staged_copy', destinationManifest, 'recovered_existing_destination')
          : manualRecovery('staged_copy', 'destination_manifest_mismatch')
      }
      return { outcome: 'failed', errorCode: 'destination_exists' }
    }

    const sourceManifest = await buildWorkspaceManifest(fs, sourceRoot, payload.source.relativePath)
    const plannedAtMs = Date.parse(payload.plannedAt)
    if (Number.isFinite(plannedAtMs) && sourceManifest.latestModifiedMs > plannedAtMs + 2_000) {
      return { outcome: 'failed', errorCode: 'source_changed_since_plan' }
    }
    if (payload.strategy === 'staged_copy') {
      return await stagedCopy(fs, sourceRoot, destinationRoot, payload, sourceManifest)
    }

    await ensureParentChain(fs, destinationRoot, (await rootContext(fs, destinationRoot)).rootReal, payload.destination.relativePath)
    try {
      if (caseOnlyLogicalRename) {
        const temporaryAbsolute = resolveUnderRoot(sourceRoot, payload.temporaryRelativePath)
        if (await pathKind(fs, temporaryAbsolute) !== 'missing') return manualRecovery('atomic_rename', 'temporary_destination_exists')
        await fs.rename(sourceAbsolute, temporaryAbsolute)
        try {
          await fs.rename(temporaryAbsolute, destinationAbsolute)
        } catch (error) {
          return manualRecovery('atomic_rename', safeFailureCode(error, 'case_only_rename_interrupted'))
        }
      } else {
        await fs.rename(sourceAbsolute, destinationAbsolute)
      }
    } catch (error) {
      if (errno(error) === 'EXDEV') return await stagedCopy(fs, sourceRoot, destinationRoot, payload, sourceManifest)
      return { outcome: 'failed', errorCode: safeFailureCode(error, 'rename_failed') }
    }
    const destinationManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
    return sameManifest(sourceManifest, destinationManifest)
      ? manifestResult('destination_verified', 'atomic_rename', destinationManifest)
      : manualRecovery('atomic_rename', 'destination_manifest_mismatch')
  } catch (error) {
    return { outcome: 'failed', errorCode: safeFailureCode(error, 'file_operation_apply_failed') }
  }
}

async function cleanupOperation(
  roots: Readonly<Record<string, string>>,
  payload: CleanupPayload,
  fs: FileSystemAdapter,
): Promise<FileOperationExecutionResult> {
  const sourceRoot = roots[payload.source.storageRootKey]
  const destinationRoot = roots[payload.destination.storageRootKey]
  if (sourceRoot === undefined || destinationRoot === undefined) return { outcome: 'failed', errorCode: 'unknown_root_mapping' }
  try {
    const destinationManifest = await buildWorkspaceManifest(fs, destinationRoot, payload.destination.relativePath)
    if (destinationManifest.manifestHash !== payload.manifestHash
      || destinationManifest.fileCount !== payload.fileCount
      || destinationManifest.directoryCount !== payload.directoryCount
      || destinationManifest.totalBytes !== payload.totalBytes) {
      return manualRecovery('staged_copy', 'destination_manifest_mismatch')
    }

    const sourceAbsolute = resolveUnderRoot(sourceRoot, payload.source.relativePath)
    const sourceKind = await pathKind(fs, sourceAbsolute)
    if (sourceKind === 'missing') return manifestResult('cleanup_completed', 'staged_copy', destinationManifest, 'cleanup_already_complete')
    if (sourceKind === 'unsafe') return manualRecovery('staged_copy', 'unexpected_source_entry')
    const sourceManifest = await buildWorkspaceManifest(fs, sourceRoot, payload.source.relativePath)
    if (sourceManifest.manifestHash !== payload.manifestHash
      || sourceManifest.fileCount !== payload.fileCount
      || sourceManifest.directoryCount !== payload.directoryCount
      || sourceManifest.totalBytes !== payload.totalBytes) {
      return manualRecovery('staged_copy', 'source_changed_before_cleanup')
    }

    let removed = 0
    try {
      for (const entry of [...sourceManifest.entries].reverse()) {
        const absolute = entry.relativePath.length === 0
          ? sourceAbsolute
          : join(sourceAbsolute, ...entry.relativePath.split('/'))
        const metadata = await fs.lstat(absolute)
        if (metadata.isSymbolicLink()) return manualRecovery('staged_copy', 'reparse_point_rejected')
        if (entry.type === 'file') await fs.unlink(absolute)
        else await fs.rmdir(absolute)
        removed += 1
      }
    } catch (error) {
      return removed === 0
        ? { outcome: 'failed', errorCode: safeFailureCode(error, 'cleanup_failed') }
        : manualRecovery('staged_copy', 'partial_cleanup_detected')
    }
    return manifestResult('cleanup_completed', 'staged_copy', destinationManifest)
  } catch (error) {
    return { outcome: 'failed', errorCode: safeFailureCode(error, 'cleanup_failed') }
  }
}

export async function executeFileOperation(
  roots: Readonly<Record<string, string>>,
  payload: ApplyPayload | CleanupPayload,
  fs: FileSystemAdapter = nodeFileSystemAdapter,
): Promise<FileOperationExecutionResult> {
  return payload.kind === 'file_operation'
    ? applyOperation(roots, payload, fs)
    : cleanupOperation(roots, payload, fs)
}
