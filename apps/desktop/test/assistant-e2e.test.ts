import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it('Windows assistant: real Electron window, security, menu, navigation, persistence and cleanup', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-assistant-test-'))
  const resultPath = join(workspace, 'result.json')
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(require('electron') as string, [
        fileURLToPath(new URL('./harness/assistant-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'user-data')}`,
      ], { env: { ...process.env, HB_ASSISTANT_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)), HB_ASSISTANT_RESULT: resultPath, HB_ASSISTANT_OUTPUT: workspace }, stdio: 'ignore' })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill() }, 60_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (exitCode) => {
        clearTimeout(timer)
        if (timedOut) reject(new Error('assistant Electron test timed out'))
        else resolve(exitCode)
      })
    })
    const checks = JSON.parse(await readFile(resultPath, 'utf8')) as { name: string; pass: boolean }[]
    expect(checks.filter((check) => !check.pass)).toEqual([])
    expect(checks.length).toBeGreaterThanOrEqual(20)
    expect(code).toBe(0)
  } finally {
    // Chromium may release its Windows profile handles just after the parent exits.
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
