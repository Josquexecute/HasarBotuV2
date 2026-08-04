import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// D9 B8 fix (HB-2026-145): read-only identity/version verification for the
// value-loss reference-data snapshot that services/api/src/traffic-value-loss/
// rule-source.ts loads via a repo-root-relative path invisible to
// package-lock.json (see resolve-runtime-dependency-closure.mjs's
// `ExtraDataReferences`). A generic file-hash manifest (see
// provision-extra-data-references.ps1) only proves "this file has not
// changed since we last looked at it" -- it does NOT prove "this is the
// EXACT snapshot version the running application code expects and will
// accept". This module proves the latter, using the SAME canonicalization
// algorithm and the SAME hardcoded identity/hash constants the application
// itself uses to accept or reject a snapshot at runtime:
//   - `VALUE_LOSS_SNAPSHOT_IDENTITY` (packages/domain/src/value-loss-rule-snapshot.ts)
//   - `REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256` (packages/domain/src/traffic-value-loss-real-market.ts)
//
// `canonicalizeValueLossJson` below is copied VERBATIM from
// `packages/domain/src/value-loss-rule-snapshot.ts`'s `canonicalize`/
// `canonicalValueLossJson` (sorted-key JSON serialization -- ordinary
// `JSON.stringify` does NOT sort keys, so this must match exactly or the
// computed hash will differ from the domain package's, even for
// byte-identical semantic content). This is a deliberate, tested copy
// rather than an import of the compiled `packages/domain` build: this
// module's job is fail-closed VERIFICATION, and importing the compiled
// dist would silently tie a verification result to whatever build state
// happens to be on disk (which could itself be stale) rather than to the
// known-correct, tested algorithm. `verify-value-loss-reference-data-
// identity.test.mjs` pins this implementation against the REAL on-disk
// snapshot.json and the REAL hardcoded constant, so any future drift
// between this copy and the domain package's own algorithm is caught
// immediately, loudly, by that test -- never silently.
//
// SHA-256 itself is computed via Node's own `node:crypto` (not a hand-rolled
// implementation like the domain package's own `sha256Text`, which exists
// there only for dependency-free/sandboxed-runtime portability): SHA-256 of
// the same UTF-8 byte sequence is standard and implementation-independent,
// so `node:crypto`'s result is provably identical for the same input --
// again cross-checked by the pinning test below.

const EXPECTED_SNAPSHOT_IDENTITY = 'real-market-analysis/2026-07-01/1.0.0'
const EXPECTED_SNAPSHOT_SHA256 =
  'e4fc8087ddbc1ff92e3255546e053c6956e20bd1dca269533113b727f728b940'

export function canonicalizeValueLossJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValueLossJson).join(',')}]`
  }
  const object = value
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalizeValueLossJson(object[key])}`).join(',')}}`
}

export function computeCanonicalSnapshotHash(snapshot) {
  return createHash('sha256').update(canonicalizeValueLossJson(snapshot), 'utf8').digest('hex')
}

/** Pure function: parses+verifies snapshot JSON text against the hardcoded
 * identity/hash the application itself requires. Never touches the
 * filesystem. */
export function verifySnapshotIdentity(snapshotJsonText) {
  let parsed
  try {
    parsed = JSON.parse(snapshotJsonText)
  } catch {
    return { ok: false, errorCode: 'SNAPSHOT_JSON_INVALID' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || typeof parsed.identity !== 'string') {
    return { ok: false, errorCode: 'SNAPSHOT_IDENTITY_FIELD_MISSING' }
  }
  if (parsed.identity !== EXPECTED_SNAPSHOT_IDENTITY) {
    return {
      ok: false,
      errorCode: 'SNAPSHOT_IDENTITY_MISMATCH',
      actualIdentity: parsed.identity,
      expectedIdentity: EXPECTED_SNAPSHOT_IDENTITY,
    }
  }
  const computedHash = computeCanonicalSnapshotHash(parsed)
  if (computedHash !== EXPECTED_SNAPSHOT_SHA256) {
    return {
      ok: false,
      errorCode: 'SNAPSHOT_HASH_MISMATCH',
      computedHash,
      expectedHash: EXPECTED_SNAPSHOT_SHA256,
    }
  }
  return { ok: true, identity: parsed.identity, hash: computedHash }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

function parseArguments(argv) {
  const allowed = new Set(['--snapshot-path'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key) || typeof value !== 'string' || value.length === 0) {
      throw new Error('ARGUMENT_INVALID')
    }
    if (values.has(key)) throw new Error('ARGUMENT_DUPLICATE')
    values.set(key, value)
  }
  if (!values.has('--snapshot-path')) throw new Error('ARGUMENT_MISSING')
  return { snapshotPath: values.get('--snapshot-path') }
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    let snapshotJsonText
    try {
      snapshotJsonText = await readFile(args.snapshotPath, 'utf8')
    } catch {
      emit({
        SchemaVersion: 'hasarbotu-value-loss-reference-data-identity/1.0.0',
        Status: 'error',
        ErrorCode: 'SNAPSHOT_FILE_NOT_FOUND',
      }, 1)
      return
    }
    const verification = verifySnapshotIdentity(snapshotJsonText)
    if (!verification.ok) {
      emit({
        SchemaVersion: 'hasarbotu-value-loss-reference-data-identity/1.0.0',
        Status: 'error',
        ErrorCode: verification.errorCode,
        ActualIdentity: verification.actualIdentity ?? null,
        ExpectedIdentity: verification.expectedIdentity ?? EXPECTED_SNAPSHOT_IDENTITY,
        ComputedHash: verification.computedHash ?? null,
        ExpectedHash: verification.expectedHash ?? EXPECTED_SNAPSHOT_SHA256,
      }, 1)
      return
    }
    emit({
      SchemaVersion: 'hasarbotu-value-loss-reference-data-identity/1.0.0',
      Status: 'ok',
      Identity: verification.identity,
      Hash: verification.hash,
    }, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-value-loss-reference-data-identity/1.0.0',
      Status: 'error',
      ErrorCode: typeof error?.message === 'string' ? error.message : 'VERIFY_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
