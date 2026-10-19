import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopConfigError } from '../src/main/config.js'
import { initializeOfficeConnection, OfficeConnectionSetupError } from '../src/main/office-connection.js'
import { describeStartupFailure } from '../src/main/startup-feedback.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

it('explains connection timeout, setup failure, saved-port conflict and invalid configuration without leaking errors', () => {
  expect(describeStartupFailure(new OfficeConnectionSetupError('timeout'))).toContain('süre doldu')
  expect(describeStartupFailure(new OfficeConnectionSetupError('failed'))).toContain('hazırlanamadı')
  expect(describeStartupFailure({ code: 'EADDRINUSE' })).toContain('Taslakları korumak')
  expect(describeStartupFailure(new DesktopConfigError('test', 'SYNTHETIC_PRIVATE_VALUE'))).toContain('yapılandırması')
  for (const error of [new Error('SYNTHETIC_PRIVATE_VALUE'), null, new DesktopConfigError('test', 'SYNTHETIC_PRIVATE_VALUE')]) {
    expect(describeStartupFailure(error)).not.toContain('SYNTHETIC_PRIVATE_VALUE')
  }
})

describe.skipIf(process.platform !== 'win32')('actual office connection subprocess diagnostics', () => {
  async function script(contents: string) {
    const directory = await mkdtemp(join(tmpdir(), 'hb-startup-'))
    directories.push(directory)
    const file = join(directory, 'setup.ps1')
    await writeFile(file, contents, 'utf8')
    return file
  }
  it('retains the configured result from the real PowerShell child', async () => {
    const file = await script("@{status='configured'}|ConvertTo-Json -Compress")
    await expect(initializeOfficeConnection(file)).resolves.toEqual({ status: 'configured' })
  })
  it('classifies an actual killed child as timeout and exposes a useful user message', async () => {
    const file = await script('Start-Sleep -Seconds 30')
    await expect(initializeOfficeConnection(file, 500)).rejects.toMatchObject({ reason: 'timeout' })
  })
  it('classifies nonzero exit and invalid output as setup failure', async () => {
    for (const contents of ['exit 7', "Write-Output 'invalid json'", "@{status='unexpected'}|ConvertTo-Json -Compress"]) {
      await expect(initializeOfficeConnection(await script(contents))).rejects.toMatchObject({ reason: 'failed' })
    }
  })
})
