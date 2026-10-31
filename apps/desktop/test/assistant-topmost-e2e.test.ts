import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// The previous run leaves the shell foreground; cover that startup state too.
it.skipIf(process.platform !== 'win32').each([1, 2])('Windows native foreground, taskbar and full-screen ordering without focus theft (launch %i)', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-touch-order-')), resultPath = join(workspace, 'result.json')
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(createRequire(import.meta.url)('electron') as string, [fileURLToPath(new URL('./harness/assistant-topmost-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], { windowsHide: true, env: { ...process.env, HB_ASSISTANT_RESULT: resultPath }, stdio: 'ignore' })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Windows ordering harness timed out')) }, 90_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', value => { clearTimeout(timer); resolve(value) })
    })
    const checks = JSON.parse(await readFile(resultPath, 'utf8')) as { name: string; pass: boolean }[]
    expect(checks.filter(check => !check.pass)).toEqual([])
    expect(checks.length).toBeGreaterThanOrEqual(5)
    expect(code).toBe(0)
  } finally { await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
})
