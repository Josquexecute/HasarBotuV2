import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
it.skipIf(!process.env.TEST_DATABASE_URL)('real clients: administrator-only management and synchronized profile names', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-profile-ui-')), resultPath = join(workspace, 'result.json')
  try {
    await mkdir(process.env.HB_PROFILE_EVIDENCE ?? workspace, { recursive: true })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(require('electron') as string, [fileURLToPath(new URL('./harness/profile-access-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], {
        env: { ...process.env, HB_PROFILE_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)), HB_PROFILE_RESULT: resultPath, HB_PROFILE_EVIDENCE: process.env.HB_PROFILE_EVIDENCE ?? workspace },
        windowsHide: true, stdio: 'ignore',
      })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Profile UI acceptance timed out')) }, 110_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); resolve(code) })
    })
    const checks = JSON.parse(await readFile(resultPath, 'utf8')) as { name: string; pass: boolean }[]
    expect(checks.filter(check => !check.pass)).toEqual([])
    expect(checks.length).toBeGreaterThanOrEqual(12)
    expect(exitCode).toBe(0)
  } finally { await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}, 120_000)
