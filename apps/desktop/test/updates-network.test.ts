import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([0, 300])('ends a stalled real Electron transfer, removes partial bytes and safely retries (network startup: %i ms)', async (startupDelayMs) => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-network-update-'))
  const output = directory + '.json'
  try {
    const binary = createRequire(import.meta.url)('electron') as string
    await new Promise<void>((resolve, reject) => execFile(binary, [fileURLToPath(new URL('./harness/update-network-main.mjs', import.meta.url)), directory, output, String(startupDelayMs)], { windowsHide: true, timeout: 20_000 }, error => error ? reject(error) : resolve()))
    const proof = JSON.parse(await readFile(output, 'utf8')) as { passed: boolean; requests?: number; error?: string }
    expect(proof, JSON.stringify(proof)).toMatchObject({ passed: true, requests: 2 })
  } finally { await rm(directory, { recursive: true, force: true }); await rm(output, { force: true }) }
})
