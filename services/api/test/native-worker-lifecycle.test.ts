import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('exits cleanly after native PDF rendering with the API test configuration', () => {
  const vitest = fileURLToPath(new URL('vitest.mjs', import.meta.resolve('vitest/package.json')))
  // A test assertion cannot observe its own worker teardown. Wait for a real
  // renderer test process to exit, including native addon cleanup.
  const result = spawnSync(process.execPath, [
    vitest, 'run', '--config', 'vitest.config.ts',
    'test/traffic-value-loss-report-pdf.test.ts', '--reporter=json',
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })

  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr || result.stdout).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report).toMatchObject({
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
  })
  expect(report.numPassedTests).toBeGreaterThan(0)
}, 40_000)
