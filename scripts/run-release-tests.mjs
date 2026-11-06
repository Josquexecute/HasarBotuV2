import { spawnSync } from 'node:child_process'
import { mkdir, open, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
const powerShellOnly = process.argv.includes('--powershell-only')
const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!powerShellOnly && (!testDatabaseUrl || !new URL(testDatabaseUrl).pathname.endsWith('_test'))) throw new Error('A disposable test database is required.')
const output = join(process.env.RUNNER_TEMP ?? '.local', powerShellOnly ? 'hasarbotu-powershell-checks' : 'hasarbotu-release-checks')
await mkdir(output, { recursive: true })
await rm(join(output, 'summary.json'), { force: true })
const commands = [
  ['workspace-tests', process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm test']],
  ['live-api-tests', process.execPath, ['scripts/run-live-api-tests.mjs']],
  ['identity-maintenance-tests', process.execPath, ['--test', 'deploy/windows-service/repair-folder-identity.test.mjs']],
  ['office-network-tests', process.execPath, ['--test', '--test-concurrency=1', 'deploy/windows-service/office-network.test.mjs', 'deploy/windows-service/office-network-service.test.mjs', 'deploy/windows-service/office-network-installer.test.mjs', 'deploy/windows-service/office-network-readiness.test.mjs', 'deploy/windows-service/office-service-recovery.test.mjs']],
  ['office-startup-tests', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'deploy/windows-service/start-office-server.tests.ps1']],
  ['office-certificate-tests', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'deploy/windows-service/renew-office-network.tests.ps1']],
  ['office-rollback-tests', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'deploy/windows-service/office-network-state.tests.ps1']],
  // Discovery files reset the same disposable database schema and must not run concurrently.
  ['release-and-discovery-tests', process.execPath, ['--test', '--test-concurrency=1', 'scripts/text-encoding.test.mjs', 'scripts/release-notes.test.mjs', 'scripts/release-artifacts.test.mjs', 'scripts/published-release.test.mjs', 'scripts/office-release-sync.test.mjs', 'scripts/electron-download-proxy.test.mjs', 'scripts/frontend-license-notices.test.mjs', 'scripts/file-agent-codec-notices.test.mjs', 'scripts/plan-folder-identity-repair.test.mjs', 'scripts/soak-metrics.test.mjs', 'scripts/soak-memory-budget.test.mjs', 'scripts/worker-memory-preload.test.mjs', 'scripts/ocr-pdf-soak.test.mjs', 'scripts/desktop-signing.test.mjs', 'scripts/review-codec-evidence.test.mjs', 'scripts/complete-native-license-evidence.test.mjs', 'deploy/windows-service/automatic-folder-discovery.test.mjs', 'deploy/windows-service/automatic-folder-outage.test.mjs']],
]
let passed = 0, skipped = 0, resolvedSkips = 0
for (const [name, executable, args] of commands.filter(([, executable]) => !powerShellOnly || executable === 'powershell.exe')) {
  const path = join(output, name + '.log'), file = await open(path, 'w')
  let result
  try { result = spawnSync(executable, args, { windowsHide: true, stdio: ['ignore', file.fd, file.fd], timeout: 20 * 60_000 }) }
  finally { await file.close() }
  let text = (await readFile(path, 'utf8')).replace(/\u001b\[[0-9;]*m/g, '')
  if (result.status !== 0) {
    for (const secret of [testDatabaseUrl, testDatabaseUrl ? decodeURIComponent(new URL(testDatabaseUrl).password) : undefined]) if (secret) text = text.replaceAll(secret, '[REDACTED]')
    console.error(text.slice(-12_000))
    throw new Error(name + ' failed; no release draft will be prepared.')
  }
  if (name === 'workspace-tests' || name === 'live-api-tests') {
    const lines = text.split(/\r?\n/).filter(line => /^\s*Tests\s/.test(line))
    for (const line of lines) { passed += Number(/(\d+) passed/.exec(line)?.[1] ?? 0); skipped += Number(/(\d+) skipped/.exec(line)?.[1] ?? 0) }
    if (name === 'live-api-tests') {
      resolvedSkips = lines.reduce((sum, line) => sum + Number(/(\d+) passed/.exec(line)?.[1] ?? 0), 0)
      if (resolvedSkips !== 6 || lines.some(line => /skipped|failed/.test(line))) throw new Error('All six isolated live API checks must pass.')
    }
  } else {
    passed += Number(/(?:#|ℹ) pass (\d+)/.exec(text)?.[1] ?? /^(\d+)\/\1 PASS\r?$/m.exec(text)?.[1] ?? 0)
    skipped += Number(/(?:#|ℹ) skipped (\d+)/.exec(text)?.[1] ?? 0)
  }
}
if (!passed) throw new Error('No passed tests were recorded.')
// The six opt-in HTTP tests reported skipped by npm test are executed above against a real isolated API.
const summary = { status: 'PASS', passed, skipped: Math.max(0, skipped - resolvedSkips), initiallySkipped: skipped, resolvedSkips, skippedChecksPassed: false }
await writeFile(join(output, 'summary.json'), JSON.stringify(summary))
console.log(JSON.stringify(summary))
