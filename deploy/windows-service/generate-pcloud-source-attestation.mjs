import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildAttestationRecords, writeAttestationRecord } from './pcloud-source-attestation.mjs'

// CLI orchestrator for pcloud-source-attestation.mjs (HB-2026-167, Karar
// 1) -- builds attestation records for one case (real source read
// required, see the library module's own header) and PERSISTS each one
// to the attestation store. The library module itself only builds
// records in memory; this is the thin layer that also writes them,
// mirroring pcloud-case-reconciliation.mjs's relationship to
// pcloud-maintenance-window-gate.mjs / pcloud-post-sync-diff-forensics.mjs.

function parseArguments(argv) {
  const allowed = new Set([
    '--source-case-root',
    '--pcloud-db',
    '--top-level-folder-name',
    '--case-relative-path',
    '--attestation-store',
    '--attested-by',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key) || typeof value !== 'string' || value.length === 0) {
      const error = new Error('ARGUMENT_INVALID')
      error.safeCode = 'ARGUMENT_INVALID'
      throw error
    }
    if (values.has(key)) {
      const error = new Error('ARGUMENT_DUPLICATE')
      error.safeCode = 'ARGUMENT_DUPLICATE'
      throw error
    }
    values.set(key, value)
  }
  for (const key of allowed) {
    if (!values.has(key)) {
      const error = new Error('ARGUMENT_MISSING')
      error.safeCode = 'ARGUMENT_MISSING'
      throw error
    }
  }
  return {
    sourceCaseRoot: values.get('--source-case-root'),
    databasePath: values.get('--pcloud-db'),
    topLevelFolderName: values.get('--top-level-folder-name'),
    caseRelativePath: values.get('--case-relative-path'),
    attestationStoreDirectory: values.get('--attestation-store'),
    attestedBy: values.get('--attested-by'),
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const records = await buildAttestationRecords(args)
    const written = []
    for (const record of records) {
      // eslint-disable-next-line no-await-in-loop -- sequential, fail-closed
      // writes (matches every other tool in this directory's throughput
      // choice); each record is independently hash-verified on write.
      const ref = await writeAttestationRecord(args.attestationStoreDirectory, record)
      written.push({ RelativePath: record.RelativePath, FileId: record.FileId, ...ref })
    }
    emit({
      SchemaVersion: 'hasarbotu-pcloud-source-attestation/1.0.0',
      CaseRelativePath: args.caseRelativePath,
      Records: written,
    }, 0)
  } catch (error) {
    emit({
      SchemaVersion: 'hasarbotu-pcloud-source-attestation/1.0.0',
      Status: 'error',
      ErrorCode: typeof error?.safeCode === 'string' ? error.safeCode : 'ATTESTATION_GENERATION_RUNTIME_ERROR',
    }, 1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
