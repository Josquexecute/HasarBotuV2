import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const [directoryText, durationText, ...extra] = process.argv.slice(2)
const directory = resolve(directoryText ?? '')
const durationMs = Number(durationText)
if (Number(process.versions.node.split('.')[0]) !== 24 || extra.length || !directory.startsWith(resolve('.local') + sep) ||
  !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 7 * 86400000) throw new Error('Expected a new project-local .local directory and duration in milliseconds')
await mkdir(directory) // Refuse to overwrite another run.
const fingerprint = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const sources = ['scripts/ocr-pdf-soak.mjs', 'services/file-agent/dist/pdf-text-extractor.js', 'services/file-agent/dist/policy-ocr-extractor.js',
  'services/file-agent/dist/pdf-parser-worker.js', 'services/file-agent/dist/policy-ocr-worker.js',
  'services/file-agent/dist/extraction-process.js', 'services/file-agent/dist/extraction-process-host.js',
  'scripts/soak-memory-budget.mjs', 'scripts/soak-metrics.mjs',
  'node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
  'node_modules/tesseract.js/src/createWorker.js', 'node_modules/tesseract.js/src/worker/node/terminateWorker.js',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js', 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
  'node_modules/tesseract.js-core/tesseract-core-simd-lstm.js', 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
  'package-lock.json']
const fingerprints = Object.fromEntries(await Promise.all(sources.map(async path => [path, await fingerprint(path)])))
const startedAt = new Date().toISOString()
const resultPath = join(directory, 'result.json'), receiptPath = join(directory, 'receipt.json')
const stdout = await open(join(directory, 'stdout.log'), 'wx'), stderr = await open(join(directory, 'stderr.log'), 'wx')
const child = spawn(process.execPath, ['--expose-gc', resolve('scripts/ocr-pdf-soak.mjs'), '--duration-ms=' + durationMs,
  '--concurrency=2', '--output=' + resultPath], { windowsHide: true, stdio: ['ignore', stdout.fd, stderr.fd] })
const receipt = { status: 'RUNNING', supervisorPid: process.pid, childPid: child.pid, startedAt,
  expectedEndAt: new Date(Date.parse(startedAt) + durationMs).toISOString(), durationMs, node: process.version,
  resultPath, fingerprints, productionMutations: 0 }
async function save() {
  await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2) + '\n')
  await rename(receiptPath + '.tmp', receiptPath)
}
await save()
try {
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done) })
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  receipt.finishedAt = new Date().toISOString()
  receipt.exitCode = code
  const drift = []
  for (const path of sources) if (await fingerprint(path) !== fingerprints[path]) drift.push(path)
  receipt.sourceDrift = drift
  // An early exit or changed runtime cannot satisfy the requested duration.
  receipt.status = code === 0 && result.status === 'PASS_BOUNDED_SOAK' && result.durationMs >= durationMs && drift.length === 0
    ? 'COMPLETED_BOUNDED_SOAK' : 'FAIL'
  receipt.resultStatus = result.status
} catch (error) {
  receipt.status = 'FAIL'
  receipt.error = String(error)
  process.exitCode = 1
} finally {
  await stdout.close(); await stderr.close()
  await save()
}
if (receipt.status === 'FAIL') process.exitCode = 1
