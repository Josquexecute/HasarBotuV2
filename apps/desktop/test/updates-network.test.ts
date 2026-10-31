import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('ends a stalled real Electron transfer, removes partial bytes and safely retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-network-update-'))
  const output = directory + '.json'
  try {
    const binary = createRequire(import.meta.url)('electron') as string
    await new Promise<void>((resolve, reject) => execFile(binary, [fileURLToPath(new URL('./harness/update-network-main.mjs', import.meta.url)), directory, output], { windowsHide: true, timeout: 20_000 }, error => error ? reject(error) : resolve()))
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ passed: true, requests: 2 })
  } finally { await rm(directory, { recursive: true, force: true }); await rm(output, { force: true }) }
})
