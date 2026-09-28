import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
it('keeps settings, draft text and request identity across real Electron process restarts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-storage-e2e-'))
  const resultPath = join(workspace, 'result.json')
  await writeFile(join(workspace, 'index.html'), '<!doctype html><title>Storage test</title>')
  async function run(mode: string) {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(require('electron') as string, [fileURLToPath(new URL('./harness/persistent-storage-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env, HB_STORAGE_ASSETS: workspace, HB_STORAGE_RESULT: resultPath, HB_STORAGE_MODE: mode },
      })
      const timer = setTimeout(() => { child.kill(); reject(new Error('storage test timed out')) }, 20_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); resolve(code) })
    })
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as { origin: string; data: { theme: string; draft: string } }
    expect(code).toBe(0)
    return result
  }
  try {
    const first = await run('write')
    const second = await run('read')
    expect(second.origin).toBe(first.origin)
    expect(JSON.parse(second.data.theme)).toBe('dark')
    expect(JSON.parse(second.data.draft)).toEqual({ body: 'saved draft', key: 'unchanged-request-id', attempted: true })
  } finally { await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}, 45_000)
