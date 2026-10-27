import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'

test('RSS budget failure returns nonzero with measured evidence and never marks the soak passed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-soak-budget-test-'))
  const output = join(directory, 'result.json')
  try {
    const result = spawnSync(process.execPath, ['--expose-gc', 'scripts/ocr-pdf-soak.mjs', '--duration-ms=1000', '--max-rss-mib=64', '--output=' + output],
      { encoding: 'utf8', windowsHide: true, timeout: 45000 })
    assert.equal(result.status, 1, result.stderr)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.status, 'FAIL')
    assert.match(report.error, /RSS budget exceeded/)
    assert.ok(report.peaks.rss > 64 * 1048576)
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    await rm(directory, { recursive: true, force: true })
  }
})

test('RSS ceiling includes the disposable engine processes while the parent stays below the ceiling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-soak-child-budget-test-'))
  try {
    const output = join(directory, 'result.json')
    const result = spawnSync(process.execPath, ['--expose-gc', 'scripts/ocr-pdf-soak.mjs', '--duration-ms=1000', '--max-rss-mib=192', '--output=' + output],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    assert.equal(result.status, 1, result.stderr)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.status, 'FAIL')
    assert.match(report.error, /RSS budget exceeded/)
    assert.ok(report.peaks.parentRss < 192 * 1048576, 'The parent alone would incorrectly pass')
    assert.ok(report.peaks.rss > 192 * 1048576, 'The total process tree must trip the ceiling')
    assert.ok(report.peaks.childProcessesRss > 0)
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    await rm(directory, { recursive: true, force: true })
  }
})
