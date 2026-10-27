import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('real Electron: reaction controls, reduced motion, 61 distinct scenes and appearance preservation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-touch-play-'))
  const output = process.env.HB_PLAY_EVIDENCE ?? workspace
  await mkdir(output, { recursive: true })
  try {
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(createRequire(import.meta.url)('electron') as string, [fileURLToPath(new URL('./harness/assistant-play-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env, HB_PLAY_OUTPUT: output, HB_PLAY_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)) },
      })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native reaction checks timed out')) }, 90_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', value => { clearTimeout(timer); done(value) })
    })
    const proof = JSON.parse(await readFile(join(output, 'play-native-proof.json'), 'utf8')) as { checks: { name: string; pass: boolean }[]; pixels?: { uniqueAnimations: number } }
    expect(proof.checks.filter(check => !check.pass)).toEqual([])
    expect(proof.pixels?.uniqueAnimations).toBe(61)
    expect(code).toBe(0)
  } finally { await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}, 100_000)
