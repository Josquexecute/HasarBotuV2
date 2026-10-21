import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('exits cleanly after native PDF rendering with the API test configuration', () => {
  const vitest = fileURLToPath(new URL('vitest.mjs', import.meta.resolve('vitest/package.json')))
  const directory = mkdtempSync(join(tmpdir(), 'hb-native-lifecycle-'))
  const output = join(directory, 'report.json')
  try {
    // A test assertion cannot observe its own worker teardown. Wait for a real
    // renderer test process to exit, including native addon cleanup.
    const result = spawnSync(process.execPath, [
      vitest, 'run', '--config', 'vitest.config.ts',
      'test/traffic-value-loss-report-pdf.test.ts', '--reporter=json', '--outputFile=' + output,
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
    const report = JSON.parse(readFileSync(output, 'utf8'))
    expect(report).toMatchObject({
      success: true,
      numFailedTests: 0,
      numPendingTests: 0,
    })
    expect(report.numPassedTests).toBeGreaterThan(0)
  } finally {
    rmSync(output, { force: true })
    rmdirSync(directory)
  }
}, 40_000)
