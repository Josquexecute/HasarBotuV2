import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// D9 B7 fix (HB-2026-144): read-only, deterministic RUNTIME dependency
// closure resolver for a single npm-workspace service package (e.g.
// services/api, services/file-agent), computed EXCLUSIVELY from
// package-lock.json (lockfileVersion 3) -- never from live node_modules
// introspection, which is not deterministic (npm can hoist differently
// across installs) and never includes devDependencies transitively.
//
// This module is READ-ONLY: it never writes to package-lock.json,
// package.json, or node_modules. It only reads the lockfile, reads each
// resolved external package's OWN package.json on disk (once) to verify
// its installed version matches the lockfile record (lock-integrity
// check), and emits a JSON manifest describing exactly which packages
// must be copied into a self-contained deploy artifact.
//
// ALGORITHM (mirrors Node's own module resolution + npm's own install
// decisions, so the result is exactly what `npm ci --omit=dev` would
// produce for this one workspace):
//   1. Start from the workspace's own lockfile entry; seed the walk with
//      its "dependencies" keys ONLY (never "devDependencies").
//   2. For every (fromPackagePath, dependencyName) pair, resolve the
//      dependency's lockfile key by walking UP from fromPackagePath
//      exactly as Node's require() would walk up real node_modules
//      directories: try every ancestor prefix + "/node_modules/<name>",
//      longest (most-nested/most-specific) first, down to the repo-root
//      "node_modules/<name>". This is REQUIRED for correctness: this
//      repo's real lockfile has genuine nested overrides (fastify's own
//      ajv-compiler/fast-json-stringify/light-my-request/thread-stream
//      subtrees each pin a different transitive version than the
//      hoisted root one).
//   3. Recurse into the resolved package's own "dependencies" (never its
//      "devDependencies") AND its "optionalDependencies" -- but an
//      optional dependency is only followed if its own lockfile record's
//      "os"/"cpu" arrays (when present) are compatible with the CURRENT
//      platform/arch (this is exactly npm's own platform-compatibility
//      check; it is what keeps 10 of @napi-rs/canvas's 11 per-platform
//      binary packages OUT of a Windows closure).
//   4. Every visited path is classified as workspace-internal (no
//      "node_modules/" segment anywhere in the path, e.g. "packages/contracts")
//      or external (contains "node_modules/").

const CURRENT_PLATFORM = process.platform
const CURRENT_ARCH = process.arch

class SafeError extends Error {
  constructor(safeCode) {
    super(safeCode)
    this.name = 'SafeError'
    this.safeCode = safeCode
  }
}
function fail(safeCode) { throw new SafeError(safeCode) }
function assert(condition, safeCode) { if (!condition) fail(safeCode) }

function parseArguments(argv) {
  const allowed = new Set(['--repo-root', '--workspace', '--lockfile'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'ARGUMENT_INVALID')
    assert(!values.has(key), 'ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  for (const key of ['--repo-root', '--workspace']) {
    assert(values.has(key), 'ARGUMENT_MISSING')
  }
  return {
    repoRoot: values.get('--repo-root'),
    workspace: values.get('--workspace').replace(/\\/g, '/').replace(/\/+$/, ''),
    lockfilePath: values.get('--lockfile') ?? null,
  }
}

/** Is `candidateOsOrCpuList` (npm lockfile "os"/"cpu" array, possibly
 * absent) compatible with the given current value? Absent/empty means
 * "no restriction" (npm convention). Supports npm's negation prefix
 * ("!win32") for completeness even though this repo's lockfile does not
 * currently use it. */
function matchesPlatformConstraint(list, current) {
  if (list === undefined || list === null || list.length === 0) return true
  const negations = list.filter((entry) => entry.startsWith('!'))
  const positives = list.filter((entry) => !entry.startsWith('!'))
  if (negations.some((entry) => entry.slice(1) === current)) return false
  if (positives.length > 0) return positives.includes(current)
  return true
}

export function isOptionalDependencyCompatible(lockEntry, platform = CURRENT_PLATFORM, arch = CURRENT_ARCH) {
  if (!lockEntry) return false
  return matchesPlatformConstraint(lockEntry.os, platform) && matchesPlatformConstraint(lockEntry.cpu, arch)
}

/** Node/npm-style upward directory walk to resolve `depName` from
 * `fromPackagePath` against the lockfile's flat `packages` map. Returns
 * the matching key or null. `fromPackagePath` uses forward slashes and
 * is either '' (repo root) or a lockfile package key. */
export function resolveDependencyLockKey(lockPackages, fromPackagePath, depName) {
  const segments = fromPackagePath === '' ? [] : fromPackagePath.split('/')
  for (let i = segments.length; i >= 0; i -= 1) {
    const prefix = segments.slice(0, i).join('/')
    const candidate = prefix.length > 0 ? `${prefix}/node_modules/${depName}` : `node_modules/${depName}`
    if (Object.prototype.hasOwnProperty.call(lockPackages, candidate)) return candidate
  }
  return null
}

function isWorkspaceInternalKey(key) {
  return !key.split('/').includes('node_modules')
}

/**
 * Pure function (no filesystem access) so it is fully unit-testable
 * against a small synthetic lockfile fixture. `lockPackages` is the
 * lockfile's `packages` object (lockfileVersion 3 shape); `workspaceKey`
 * is the workspace's own key (e.g. "services/api").
 */
export function computeClosure(lockPackages, workspaceKey, platform = CURRENT_PLATFORM, arch = CURRENT_ARCH) {
  assert(Object.prototype.hasOwnProperty.call(lockPackages, workspaceKey), 'WORKSPACE_NOT_IN_LOCKFILE')
  const workspaceEntry = lockPackages[workspaceKey]

  const visitedExternal = new Map() // lockKey -> { name, version, resolved, integrity, os, cpu }
  const visitedWorkspaceInternal = new Set() // lockKey (e.g. "packages/contracts")
  const skippedIncompatibleOptional = []
  const queue = []

  function enqueueDependenciesOf(fromKey, deps, optionalDeps) {
    for (const depName of Object.keys(deps ?? {})) {
      const resolvedKey = resolveDependencyLockKey(lockPackages, fromKey, depName)
      if (resolvedKey === null) fail(`DEPENDENCY_NOT_IN_LOCKFILE_${depName}`)
      queue.push(resolvedKey)
    }
    for (const depName of Object.keys(optionalDeps ?? {})) {
      const resolvedKey = resolveDependencyLockKey(lockPackages, fromKey, depName)
      if (resolvedKey === null) continue // optional: absence is not an error
      const entry = lockPackages[resolvedKey]
      if (!isOptionalDependencyCompatible(entry, platform, arch)) {
        skippedIncompatibleOptional.push({ name: depName, lockKey: resolvedKey, os: entry.os ?? null, cpu: entry.cpu ?? null })
        continue
      }
      queue.push(resolvedKey)
    }
  }

  enqueueDependenciesOf(workspaceKey, workspaceEntry.dependencies, workspaceEntry.optionalDependencies)

  while (queue.length > 0) {
    let key = queue.shift()
    let entry = lockPackages[key]
    if (!entry) fail(`LOCKFILE_KEY_MISSING_${key}`)

    // npm workspaces record a "link": true stub under node_modules/<scope>/<name>
    // pointing at the REAL workspace-internal path (e.g.
    // node_modules/@hasarbotu/contracts -> packages/contracts). The stub
    // itself carries no version/dependencies -- it must never be treated
    // as an external package; redirect to its real target.
    if (entry.link === true) {
      const realKey = entry.resolved
      if (typeof realKey !== 'string' || !Object.prototype.hasOwnProperty.call(lockPackages, realKey)) {
        fail(`LOCKFILE_LINK_TARGET_MISSING_${key}`)
      }
      key = realKey
      entry = lockPackages[key]
    }

    if (visitedExternal.has(key) || visitedWorkspaceInternal.has(key)) continue

    if (isWorkspaceInternalKey(key)) {
      visitedWorkspaceInternal.add(key)
    } else {
      const nameFromKey = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      visitedExternal.set(key, {
        name: entry.name ?? nameFromKey,
        version: entry.version ?? null,
        resolved: entry.resolved ?? null,
        integrity: entry.integrity ?? null,
      })
    }
    enqueueDependenciesOf(key, entry.dependencies, entry.optionalDependencies)
  }

  return {
    workspaceKey,
    platform,
    arch,
    workspaceInternal: [...visitedWorkspaceInternal].sort(),
    external: [...visitedExternal.entries()]
      .map(([lockKey, info]) => ({ lockKey, ...info }))
      .sort((a, b) => (a.lockKey < b.lockKey ? -1 : a.lockKey > b.lockKey ? 1 : 0)),
    skippedIncompatibleOptional: skippedIncompatibleOptional.sort((a, b) => (a.lockKey < b.lockKey ? -1 : 1)),
  }
}

/** Adds a filesystem-verified `lockIntegrityOk` + `onDiskVersion` field to
 * each external entry by reading its OWN package.json from disk (once).
 * This is the "lock integrity" check: confirms the real, currently
 * installed node_modules has not drifted from what the lockfile records
 * -- it does NOT re-verify the npm registry tarball hash (that would
 * require re-downloading/re-hashing the original tarball, which is not
 * practical or necessary for a same-machine deploy; the on-disk-vs-lock
 * version comparison is the practical, achievable integrity gate). */
export async function verifyOnDiskVersions(repoRoot, closure) {
  const verified = []
  let allOk = true
  for (const entry of closure.external) {
    const packageJsonPath = path.join(repoRoot, ...entry.lockKey.split('/'), 'package.json')
    let onDiskVersion = null
    let exists = false
    try {
      const raw = await readFile(packageJsonPath, 'utf8')
      onDiskVersion = JSON.parse(raw).version ?? null
      exists = true
    } catch {
      exists = false
    }
    const ok = exists && onDiskVersion === entry.version
    if (!ok) allOk = false
    verified.push({ ...entry, onDiskVersion, existsOnDisk: exists, lockIntegrityOk: ok })
  }
  return { allOk, external: verified }
}

const EXTERNAL_URL_REFERENCE_PATTERN = /new URL\(\s*(['"])((?:\.\.\/)+[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/gs

/**
 * D9 B7 fix, veri dosyası genişletmesi (HB-2026-144): kilit dosyasında hiç
 * görünmeyen, ama derlenmiş çıktının `new URL('../...', import.meta.url)`
 * ile REPO KÖKÜNE göre sabit kodlanmış göreli yolla okuduğu veri dosyalarını
 * (ör. hash doğrulamalı bir referans-veri snapshot'ı) statik olarak
 * tarayarak bulur -- bunlar paketin KENDİ `dist/`inin dışında kaldığı için
 * normal dist+package.json kopyalamasıyla dağıtılmaz ve deploy sonrası
 * `ENOENT` ile çöker (gerçek izole smoke testte bulundu). Yalnız paketin
 * KENDİ kökünün DIŞINA çıkan referanslar raporlanır (kendi içindekiler zaten
 * dist kopyasıyla gelir). Bulunan her referansın kaynak dosyası GERÇEKTEN
 * var mı diye doğrulanır (fail-closed). Bu fonksiyon KOPYALAMAZ -- yalnız
 * neyin, nereden, hangi paketten referans edildiğini raporlar;
 * `deploy-service-artifacts.ps1` bunu gerçek `-TargetDir`e göre TAZE olarak
 * yeniden çözüp ya doğrular ya da net bir mesajla fail-closed BLOCKED döner.
 */
export async function findExtraDataReferences(repoRoot, workspaceKey) {
  const workspaceRoot = path.join(repoRoot, ...workspaceKey.split('/'))
  const distRoot = path.join(workspaceRoot, 'dist')
  const references = []
  let jsFiles
  try {
    const entries = await readdir(distRoot, { recursive: true, withFileTypes: true })
    jsFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  } catch {
    return references
  }
  for (const entry of jsFiles) {
    const absoluteFilePath = path.join(entry.parentPath ?? entry.path, entry.name)
    const content = await readFile(absoluteFilePath, 'utf8')
    for (const match of content.matchAll(EXTERNAL_URL_REFERENCE_PATTERN)) {
      const literal = match[2]
      const resolvedAbsolutePath = path.resolve(path.dirname(absoluteFilePath), literal)
      const relativeToWorkspace = path.relative(workspaceRoot, resolvedAbsolutePath)
      if (!relativeToWorkspace.startsWith('..')) continue // kendi kokunun icinde -- zaten dist kopyasiyla gelir
      let exists = false
      try {
        await stat(resolvedAbsolutePath)
        exists = true
      } catch {
        exists = false
      }
      if (!exists) fail(`EXTRA_DATA_REFERENCE_NOT_FOUND_${path.relative(repoRoot, resolvedAbsolutePath).replace(/\\/g, '/')}`)
      references.push({
        distRelativePath: path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, '/'),
        literal,
        resolvedRepoRelativePath: path.relative(repoRoot, resolvedAbsolutePath).replace(/\\/g, '/'),
      })
    }
  }
  return references
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const lockfilePath = args.lockfilePath ?? path.join(args.repoRoot, 'package-lock.json')
    const lockRaw = JSON.parse(await readFile(lockfilePath, 'utf8'))
    assert(lockRaw.lockfileVersion === 3, 'LOCKFILE_VERSION_UNSUPPORTED')
    assert(typeof lockRaw.packages === 'object' && lockRaw.packages !== null, 'LOCKFILE_PACKAGES_MISSING')

    const closure = computeClosure(lockRaw.packages, args.workspace)
    const verification = await verifyOnDiskVersions(args.repoRoot, closure)
    if (!verification.allOk) {
      emit({
        SchemaVersion: 'hasarbotu-runtime-dependency-closure/1.0.0',
        Status: 'error',
        ErrorCode: 'LOCK_INTEGRITY_MISMATCH',
        Mismatches: verification.external.filter((e) => !e.lockIntegrityOk).map((e) => e.lockKey),
      }, 1)
      return
    }
    const extraDataReferences = await findExtraDataReferences(args.repoRoot, args.workspace)

    emit({
      SchemaVersion: 'hasarbotu-runtime-dependency-closure/1.0.0',
      Status: 'ok',
      Workspace: closure.workspaceKey,
      Platform: closure.platform,
      Arch: closure.arch,
      WorkspaceInternal: closure.workspaceInternal,
      External: verification.external,
      SkippedIncompatibleOptional: closure.skippedIncompatibleOptional,
      ExtraDataReferences: extraDataReferences,
    }, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-runtime-dependency-closure/1.0.0',
      Status: 'error',
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'RESOLVE_CLOSURE_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
