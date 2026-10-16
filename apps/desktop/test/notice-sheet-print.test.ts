import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const test = process.env.TEST_DATABASE_URL ? it : it.skip

test('production notice sheets: save, reopen, print one A4 and block overflow', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hb-notice-print-'))
  if (resolve(dirname(workspace)) !== resolve(tmpdir()) || !basename(workspace).startsWith('hb-notice-print-')) throw new Error('Unexpected print test cleanup path')
  const resultPath = join(workspace, 'result.json')
  try {
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const exitCode = await new Promise<number | null>((done, reject) => {
      const child = spawn(require('electron') as string, [fileURLToPath(new URL('./harness/notice-sheet-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], {
        windowsHide: true, stdio: 'ignore', env: { ...environment, HB_NOTICE_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)), HB_NOTICE_RESULT: resultPath, HB_NOTICE_OUTPUT: workspace },
      })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Notice sheet acceptance timed out')) }, 90_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); done(code) })
    })
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as { error?: string; files: string[]; checks: { name: string; pass: boolean }[] }
    expect(result.error).toBeUndefined()
    expect(result.checks.filter(check => !check.pass)).toEqual([])
    expect(exitCode).toBe(0)
    expect(result.files).toHaveLength(2)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    for (const file of result.files) {
      const task = getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true })
      const document = await task.promise
      try {
        expect(document.numPages).toBe(1)
        const page = await document.getPage(1)
        expect(page.view[2]).toBeCloseTo(595, 0)
        expect(page.view[3]).toBeCloseTo(842, 0)
        const text = (await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(' ')
        expect(text).toContain('İhbar Föyü')
        expect(text).toContain('Sentetik ekspertiz çalışması')
        expect(text).not.toContain('Kaydet ve Yazdır')
      } finally { await task.destroy() }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 110_000)
