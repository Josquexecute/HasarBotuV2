import { spawnSync } from 'node:child_process'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) throw new Error('A disposable test database is required.')
const output = join(process.env.RUNNER_TEMP ?? '.local', 'hasarbotu-release-checks')
await mkdir(output, { recursive: true })
const commands = [
  ['workspace-tests', process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm test']],
  // Discovery files reset the same disposable database schema and must not run concurrently.
  ['release-and-discovery-tests', process.execPath, ['--test', '--test-concurrency=1', 'scripts/text-encoding.test.mjs', 'scripts/release-notes.test.mjs', 'scripts/release-artifacts.test.mjs', 'scripts/published-release.test.mjs', 'scripts/office-release-sync.test.mjs', 'scripts/electron-download-proxy.test.mjs', 'scripts/frontend-license-notices.test.mjs', 'scripts/file-agent-codec-notices.test.mjs', 'scripts/plan-folder-identity-repair.test.mjs', 'scripts/soak-metrics.test.mjs', 'scripts/soak-memory-budget.test.mjs', 'scripts/worker-memory-preload.test.mjs', 'scripts/ocr-pdf-soak.test.mjs', 'scripts/desktop-signing.test.mjs', 'scripts/review-codec-evidence.test.mjs', 'scripts/complete-native-license-evidence.test.mjs', 'deploy/windows-service/automatic-folder-discovery.test.mjs', 'deploy/windows-service/automatic-folder-outage.test.mjs']],
]
let passed = 0, skipped = 0
for (const [name, executable, args] of commands) {
  const path = join(output, name + '.log'), file = await open(path, 'w')
  let result
  try { result = spawnSync(executable, args, { windowsHide: true, stdio: ['ignore', file.fd, file.fd], timeout: 20 * 60_000 }) }
  finally { await file.close() }
  let text = (await readFile(path, 'utf8')).replace(/\u001b\[[0-9;]*m/g, '')
  if (result.status !== 0) {
    for (const secret of [process.env.TEST_DATABASE_URL, decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).password)]) if (secret) text = text.replaceAll(secret, '[REDACTED]')
    console.error(text.slice(-12_000))
    throw new Error(name + ' failed; no release draft will be prepared.')
  }
  if (name === 'workspace-tests') {
    const lines = text.split(/\r?\n/).filter(line => /^\s*Tests\s/.test(line))
    for (const line of lines) { passed += Number(/(\d+) passed/.exec(line)?.[1] ?? 0); skipped += Number(/(\d+) skipped/.exec(line)?.[1] ?? 0) }
  } else {
    passed += Number(/(?:#|ℹ) pass (\d+)/.exec(text)?.[1] ?? 0)
    skipped += Number(/(?:#|ℹ) skipped (\d+)/.exec(text)?.[1] ?? 0)
  }
}
if (!passed) throw new Error('No passed tests were recorded.')
const summary = { status: 'PASS', passed, skipped, skippedChecksPassed: false }
await writeFile(join(output, 'summary.json'), JSON.stringify(summary))
console.log(JSON.stringify(summary))
