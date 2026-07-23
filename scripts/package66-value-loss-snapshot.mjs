import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA,
  VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME,
  VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
  buildValueLossRuleManifest,
  buildValueLossRuleSnapshot,
  canonicalValueLossJson,
  hashValueLossRuleSnapshot,
} from '../packages/domain/dist/index.js'
import {
  assertWorkbookHashUnchanged,
  assertWorkbookSha256,
  extractOoxmlWorkbook,
  sha256WorkbookBytes,
} from '../services/file-agent/dist/index.js'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..')
const OUTPUT_DIR = resolve(
  REPOSITORY_ROOT,
  'reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0',
)
const PRODUCT_DECISIONS_PATH = resolve(OUTPUT_DIR, 'product-decisions.json')

function parseArguments(args) {
  const options = { workbookPath: null, write: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--workbook') {
      options.workbookPath = args[index + 1] ?? null
      index += 1
    } else if (argument === '--write') {
      options.write = true
    } else {
      throw new Error(`UNKNOWN_ARGUMENT:${argument}`)
    }
  }
  if (options.workbookPath === null) throw new Error('WORKBOOK_PATH_REQUIRED')
  return options
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function writeCanonicalJson(path, value) {
  await writeFile(path, `${canonicalValueLossJson(value)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  })
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (basename(options.workbookPath) !== VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME) {
    throw new Error('WORKBOOK_FILE_NAME_MISMATCH')
  }

  const beforeBytes = await readFile(options.workbookPath)
  const startSha256 = assertWorkbookSha256(beforeBytes, VALUE_LOSS_SOURCE_WORKBOOK_SHA256)
  const workbook = extractOoxmlWorkbook(beforeBytes)
  const productDecisions = JSON.parse(await readFile(PRODUCT_DECISIONS_PATH, 'utf8'))
  const snapshot = buildValueLossRuleSnapshot({
    workbook,
    productDecisions,
    workbookSha256: startSha256,
    workbookFileName: basename(options.workbookPath),
  })
  const canonicalSnapshot = canonicalValueLossJson(snapshot)
  const snapshotSha256 = hashValueLossRuleSnapshot(snapshot)
  if (snapshotSha256 !== sha256Text(canonicalSnapshot)) {
    throw new Error('CANONICAL_SNAPSHOT_HASH_MISMATCH')
  }
  const manifest = buildValueLossRuleManifest(snapshot, snapshotSha256)

  const afterBytes = await readFile(options.workbookPath)
  const endSha256 = sha256WorkbookBytes(afterBytes)
  assertWorkbookHashUnchanged(startSha256, endSha256)

  if (options.write) {
    await writeCanonicalJson(resolve(OUTPUT_DIR, 'snapshot.json'), snapshot)
    await writeCanonicalJson(resolve(OUTPUT_DIR, 'manifest.json'), manifest)
    await writeCanonicalJson(resolve(OUTPUT_DIR, 'schema.json'), VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    written: options.write,
    identity: snapshot.identity,
    startSha256,
    endSha256,
    snapshotSha256,
    mappingCounts: manifest.mappingCounts,
    partTables: snapshot.partTables.map((table) => ({
      tableId: table.tableId,
      sourceRowCount: table.sourceRowCount,
      emittedRuleCount: table.emittedRuleCount,
    })),
    anomalyCodes: manifest.anomalyCodes,
  }, null, 2)}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
