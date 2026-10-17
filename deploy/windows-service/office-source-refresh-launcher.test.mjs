import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('source refresh starts PowerShell without creating a visible console and waits for its exit status', async () => {
  const source = await readFile(new URL('./run-office-source-refresh.vbs', import.meta.url), 'utf8')
  assert.match(source, /shell\.Run\(command, 0, True\)/)
  assert.match(source, /WScript\.Quit shell\.Run/)
  assert.match(source, /-NoProfile -NonInteractive -WindowStyle Hidden/)
  assert.match(source, /mode <> "all" And mode <> "pending" And mode <> "preview"/)
  if (process.platform === 'win32') {
    const result = spawnSync('cscript.exe', ['//B', '//Nologo', fileURLToPath(new URL('./run-office-source-refresh.vbs', import.meta.url)), 'invalid'], { windowsHide: true })
    assert.equal(result.status, 2)
  }
})
