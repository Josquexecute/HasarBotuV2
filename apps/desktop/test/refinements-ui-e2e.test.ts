import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect,it } from 'vitest'

const require = createRequire(import.meta.url)
const test = process.env.TEST_DATABASE_URL ? it : it.skip
test('real packaged UI: quick-note geometry, persistence, dark filters, owner inbox and pagination',async () => {
  const workspace = await mkdtemp(join(tmpdir(),'hb-refinements-ui-'))
  const resultPath = join(workspace,'result.json')
  try {
    const exitCode = await new Promise<number | null>((resolve,reject) => {
      const child = spawn(require('electron') as string,[fileURLToPath(new URL('./harness/refinements-ui-main.mjs',import.meta.url)),`--user-data-dir=${join(workspace,'user-data')}`],{
        env: { ...process.env,HB_REFINEMENTS_ASSETS: fileURLToPath(new URL('../../../dist/',import.meta.url)),HB_REFINEMENTS_RESULT: resultPath,HB_REFINEMENTS_EVIDENCE: process.env.HB_REFINEMENTS_EVIDENCE ?? workspace },stdio: 'ignore',
      })
      const timer = setTimeout(() => { child.kill();reject(new Error('Packaged UI acceptance timed out')) },90_000)
      child.once('error',(error) => { clearTimeout(timer);reject(error) })
      child.once('exit',(code) => { clearTimeout(timer);resolve(code) })
    })
    const checks = JSON.parse(await readFile(resultPath,'utf8')) as Array<{ name: string;pass: boolean }>
    expect(checks.filter((check) => !check.pass)).toEqual([])
    expect(checks.length).toBeGreaterThanOrEqual(10)
    expect(exitCode).toBe(0)
  } finally { await rm(workspace,{ recursive: true,force: true,maxRetries: 3,retryDelay: 100 }) }
})
