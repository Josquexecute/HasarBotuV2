import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const EXPECTED_ITEM_IDS = Array.from({ length: 10 }, (_, index) =>
  `F${String(index + 1).padStart(2, '0')}`,
)
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const DECIMAL_ID_PATTERN = /^[1-9][0-9]*$/

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = exitCode
}

function blocked(errorCode) {
  emit(
    {
      schemaVersion: 'storage-ghost-exclusion-validation/1.0.0',
      status: 'blocked',
      errorCode,
    },
    2,
  )
}

function assert(condition, errorCode) {
  if (!condition) {
    const error = new Error(errorCode)
    error.safeCode = errorCode
    throw error
  }
}

function assertExactKeys(value, expectedKeys, errorCode) {
  assert(value && typeof value === 'object' && !Array.isArray(value), errorCode)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  assert(JSON.stringify(actual) === JSON.stringify(expected), errorCode)
}

function parseArguments(argv) {
  const allowed = new Set(['--manifest', '--source-root', '--pcloud-db'])
  const values = new Map()

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    assert(allowed.has(key) && typeof value === 'string' && value.length > 0, 'VALIDATOR_ARGUMENT_INVALID')
    assert(!values.has(key), 'VALIDATOR_ARGUMENT_DUPLICATE')
    values.set(key, value)
  }

  assert(values.size === allowed.size, 'VALIDATOR_ARGUMENT_MISSING')
  return {
    manifestPath: values.get('--manifest'),
    sourceRoot: values.get('--source-root'),
    pcloudDatabasePath: values.get('--pcloud-db'),
  }
}

function normalizeWindowsPath(value) {
  return path.win32.normalize(path.win32.resolve(value)).replace(/[\\/]+$/, '')
}

function windowsPathEqual(left, right) {
  return normalizeWindowsPath(left).toUpperCase() === normalizeWindowsPath(right).toUpperCase()
}

function validateManifestShape(manifest, sourceRoot) {
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'createdAtUtc',
      'sensitivity',
      'readOnly',
      'sourceRoot',
      'entryCount',
      'policy',
      'sourceEvidence',
      'entries',
      'decision',
    ],
    'GHOST_EXCLUSION_MANIFEST_SHAPE_INVALID',
  )
  assert(manifest.schemaVersion === 'storage-ghost-exclusion/1.0.0', 'GHOST_EXCLUSION_SCHEMA_UNSUPPORTED')
  assert(manifest.sensitivity === 'Administrators-only', 'GHOST_EXCLUSION_SENSITIVITY_INVALID')
  assert(manifest.readOnly === true, 'GHOST_EXCLUSION_READ_ONLY_FLAG_REQUIRED')
  assert(typeof manifest.createdAtUtc === 'string' && Number.isFinite(Date.parse(manifest.createdAtUtc)), 'GHOST_EXCLUSION_TIMESTAMP_INVALID')
  assert(typeof manifest.sourceRoot === 'string' && windowsPathEqual(manifest.sourceRoot, sourceRoot), 'GHOST_EXCLUSION_SOURCE_ROOT_MISMATCH')
  assert(manifest.entryCount === 10 && Array.isArray(manifest.entries) && manifest.entries.length === 10, 'GHOST_EXCLUSION_ENTRY_COUNT_INVALID')

  assertExactKeys(
    manifest.policy,
    [
      'matchMode',
      'wildcardsAllowed',
      'extensionRulesAllowed',
      'folderRulesAllowed',
      'localPcloudDatabaseBindingRequired',
      'missingEntryBehavior',
    ],
    'GHOST_EXCLUSION_POLICY_SHAPE_INVALID',
  )
  assert(manifest.policy.matchMode === 'exact_windows_path_and_pcloud_file_id', 'GHOST_EXCLUSION_MATCH_MODE_INVALID')
  assert(manifest.policy.wildcardsAllowed === false, 'GHOST_EXCLUSION_WILDCARD_POLICY_INVALID')
  assert(manifest.policy.extensionRulesAllowed === false, 'GHOST_EXCLUSION_EXTENSION_POLICY_INVALID')
  assert(manifest.policy.folderRulesAllowed === false, 'GHOST_EXCLUSION_FOLDER_POLICY_INVALID')
  assert(manifest.policy.localPcloudDatabaseBindingRequired === true, 'GHOST_EXCLUSION_DB_BINDING_REQUIRED')
  assert(manifest.policy.missingEntryBehavior === 'fail_closed', 'GHOST_EXCLUSION_MISSING_BEHAVIOR_INVALID')

  assertExactKeys(
    manifest.sourceEvidence,
    ['adminPackage', 'diagnosticReport', 'verificationManifest', 'serverVerificationReport', 'f01RevisionReport'],
    'GHOST_EXCLUSION_EVIDENCE_SHAPE_INVALID',
  )
  for (const key of ['diagnosticReport', 'verificationManifest', 'serverVerificationReport', 'f01RevisionReport']) {
    const evidence = manifest.sourceEvidence[key]
    assertExactKeys(evidence, ['fileName', 'sha256'], 'GHOST_EXCLUSION_EVIDENCE_RECORD_INVALID')
    assert(typeof evidence.fileName === 'string' && evidence.fileName.length > 0 && path.win32.basename(evidence.fileName) === evidence.fileName, 'GHOST_EXCLUSION_EVIDENCE_FILENAME_INVALID')
    assert(typeof evidence.sha256 === 'string' && SHA256_PATTERN.test(evidence.sha256), 'GHOST_EXCLUSION_EVIDENCE_HASH_INVALID')
  }
  assert(typeof manifest.sourceEvidence.adminPackage === 'string' && manifest.sourceEvidence.adminPackage.length > 0, 'GHOST_EXCLUSION_PACKAGE_INVALID')

  assertExactKeys(
    manifest.decision,
    ['d7', 'classification', 'recoveryRequired', 'mutationAuthorized'],
    'GHOST_EXCLUSION_DECISION_SHAPE_INVALID',
  )
  assert(manifest.decision.d7 === 'exact_ghost_entries_excluded_for_read_only_preflight', 'GHOST_EXCLUSION_D7_DECISION_INVALID')
  assert(manifest.decision.classification === 'stale_temp_candidate', 'GHOST_EXCLUSION_CLASSIFICATION_INVALID')
  assert(manifest.decision.recoveryRequired === false, 'GHOST_EXCLUSION_RECOVERY_DECISION_INVALID')
  assert(manifest.decision.mutationAuthorized === false, 'GHOST_EXCLUSION_MUTATION_POLICY_INVALID')
}

function validateEntries(manifest) {
  const seenPaths = new Set()
  const seenFileIds = new Set()

  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index]
    assertExactKeys(
      entry,
      [
        'itemId',
        'absolutePath',
        'relativePath',
        'fileId',
        'parentFolderId',
        'expectedMetadata',
        'localClassification',
        'serverStatus',
      ],
      'GHOST_EXCLUSION_ENTRY_SHAPE_INVALID',
    )
    assert(entry.itemId === EXPECTED_ITEM_IDS[index], 'GHOST_EXCLUSION_ITEM_SEQUENCE_INVALID')
    assert(typeof entry.absolutePath === 'string' && entry.absolutePath.length > 0, 'GHOST_EXCLUSION_ABSOLUTE_PATH_INVALID')
    assert(typeof entry.relativePath === 'string' && entry.relativePath.length > 0, 'GHOST_EXCLUSION_RELATIVE_PATH_INVALID')
    assert(!/[\*\?\[\]]/.test(entry.absolutePath) && !/[\*\?\[\]]/.test(entry.relativePath), 'GHOST_EXCLUSION_WILDCARD_FOUND')
    assert(!path.win32.isAbsolute(entry.relativePath), 'GHOST_EXCLUSION_RELATIVE_PATH_ABSOLUTE')
    assert(!entry.relativePath.split(/[\\/]+/).some((segment) => segment === '..' || segment === '.' || segment.length === 0), 'GHOST_EXCLUSION_RELATIVE_PATH_UNSAFE')
    const expectedAbsolutePath = path.win32.join(manifest.sourceRoot, entry.relativePath)
    assert(windowsPathEqual(entry.absolutePath, expectedAbsolutePath), 'GHOST_EXCLUSION_ABSOLUTE_PATH_MISMATCH')
    assert(DECIMAL_ID_PATTERN.test(entry.fileId), 'GHOST_EXCLUSION_FILE_ID_INVALID')
    assert(DECIMAL_ID_PATTERN.test(entry.parentFolderId), 'GHOST_EXCLUSION_PARENT_ID_INVALID')
    assert(entry.localClassification === 'stale_temp_candidate', 'GHOST_EXCLUSION_LOCAL_CLASSIFICATION_INVALID')
    assert(entry.serverStatus === 'MISSING', 'GHOST_EXCLUSION_SERVER_STATUS_INVALID')

    assertExactKeys(
      entry.expectedMetadata,
      ['name', 'sizeBytes', 'hash', 'flags', 'ctimeRaw', 'mtimeRaw'],
      'GHOST_EXCLUSION_METADATA_SHAPE_INVALID',
    )
    assert(typeof entry.expectedMetadata.name === 'string' && entry.expectedMetadata.name.length > 0, 'GHOST_EXCLUSION_NAME_INVALID')
    assert(path.win32.basename(entry.relativePath) === entry.expectedMetadata.name, 'GHOST_EXCLUSION_NAME_PATH_MISMATCH')
    assert(Number.isSafeInteger(entry.expectedMetadata.sizeBytes) && entry.expectedMetadata.sizeBytes >= 0, 'GHOST_EXCLUSION_SIZE_INVALID')
    assert(typeof entry.expectedMetadata.hash === 'string' && /^-?[0-9]+$/.test(entry.expectedMetadata.hash), 'GHOST_EXCLUSION_PCLOUD_HASH_INVALID')
    for (const key of ['flags', 'ctimeRaw', 'mtimeRaw']) {
      assert(Number.isSafeInteger(entry.expectedMetadata[key]), 'GHOST_EXCLUSION_METADATA_INTEGER_INVALID')
    }

    const pathKey = normalizeWindowsPath(entry.absolutePath).toUpperCase()
    assert(!seenPaths.has(pathKey), 'GHOST_EXCLUSION_DUPLICATE_PATH')
    assert(!seenFileIds.has(entry.fileId), 'GHOST_EXCLUSION_DUPLICATE_FILE_ID')
    seenPaths.add(pathKey)
    seenFileIds.add(entry.fileId)
  }
}

function verifyLocalDatabase(manifest, pcloudDatabasePath) {
  const databaseUrl = pathToFileURL(pcloudDatabasePath)
  databaseUrl.searchParams.set('mode', 'ro')
  databaseUrl.searchParams.set('immutable', '1')
  const database = new DatabaseSync(databaseUrl, { readOnly: true, timeout: 0 })

  try {
    const statement = database.prepare(`
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

    let matchedCount = 0
    for (const entry of manifest.entries) {
      const row = statement.get(BigInt(entry.fileId))
      assert(row, 'GHOST_EXCLUSION_PCLOUD_ROW_MISSING')
      assert(row.id_text === entry.fileId, 'GHOST_EXCLUSION_PCLOUD_FILE_ID_MISMATCH')
      assert(row.parentfolderid_text === entry.parentFolderId, 'GHOST_EXCLUSION_PCLOUD_PARENT_ID_MISMATCH')
      assert(row.name === entry.expectedMetadata.name, 'GHOST_EXCLUSION_PCLOUD_NAME_MISMATCH')
      assert(row.size === entry.expectedMetadata.sizeBytes, 'GHOST_EXCLUSION_PCLOUD_SIZE_MISMATCH')
      assert(row.hash_text === entry.expectedMetadata.hash, 'GHOST_EXCLUSION_PCLOUD_HASH_MISMATCH')
      assert(row.flags === entry.expectedMetadata.flags, 'GHOST_EXCLUSION_PCLOUD_FLAGS_MISMATCH')
      assert(row.ctime === entry.expectedMetadata.ctimeRaw, 'GHOST_EXCLUSION_PCLOUD_CTIME_MISMATCH')
      assert(row.mtime === entry.expectedMetadata.mtimeRaw, 'GHOST_EXCLUSION_PCLOUD_MTIME_MISMATCH')
      matchedCount += 1
    }

    return matchedCount
  } finally {
    database.close()
  }
}

try {
  const args = parseArguments(process.argv.slice(2))
  const manifestText = await readFile(args.manifestPath, 'utf8')
  const manifest = JSON.parse(manifestText)

  validateManifestShape(manifest, args.sourceRoot)
  validateEntries(manifest)
  const localDbMatchedCount = verifyLocalDatabase(manifest, args.pcloudDatabasePath)

  emit(
    {
      schemaVersion: 'storage-ghost-exclusion-validation/1.0.0',
      status: 'pass',
      entryCount: manifest.entries.length,
      exactPathMatchedCount: manifest.entries.length,
      localDbMatchedCount,
      wildcardRuleCount: 0,
      extensionRuleCount: 0,
      folderRuleCount: 0,
    },
    0,
  )
} catch (error) {
  blocked(
    typeof error?.safeCode === 'string'
      ? error.safeCode
      : 'GHOST_EXCLUSION_VALIDATOR_RUNTIME_ERROR',
  )
}
