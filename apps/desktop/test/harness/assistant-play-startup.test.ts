import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

test('a missing staged runtime dependency writes a failed proof and exits before product assertions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hb-touch-import-'))
  try {
    const harness = join(root, 'apps/desktop/test/harness')
    await mkdir(harness, { recursive: true })
    for (const name of ['assistant-play-main.mjs', 'assistant-play-checks.mjs', 'test-display.mjs', 'test-display-policy.mjs']) {
      await cp(new URL(name, import.meta.url), join(harness, name))
    }
    await mkdir(join(root, 'apps/desktop/dist/main'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, 'apps/desktop/dist/main/shell.js'), 'import "./missing-runtime-dependency.js"; export const startDesktopShell = () => {}')
    await writeFile(join(root, 'apps/desktop/dist/main/assistant.js'), 'export const startDesktopAssistant = () => {}')
    await mkdir(join(root, 'node_modules/electron'), { recursive: true })
    await writeFile(join(root, 'node_modules/electron/package.json'), '{"type":"module","exports":"./index.js"}')
    // Only the main-process lifecycle is substituted; Node still performs the
    // real failing transitive import. No browser or desktop window is created.
    await writeFile(join(root, 'node_modules/electron/index.js'), `
      export const app = { enableSandbox() {}, on() {}, whenReady: () => Promise.resolve(), exit: code => process.exit(code) }
      export const ipcMain = { listenerCount: () => 0, _invokeHandlers: new Map() }
      export const screen = {}
    `)
    const run = spawnSync(process.execPath, [join(harness, 'assistant-play-main.mjs')], {
      timeout: 3000, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, HB_PLAY_OUTPUT: root, HB_TEST_DISPLAY_INDEX: undefined },
    })
    assert.equal(run.error, undefined)
    assert.equal(run.status, 1)
    const saved = await readFile(join(root, 'play-native-proof.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    assert.ok(saved, 'startup import failure must produce a terminal failed proof')
    const proof = JSON.parse(saved) as { passed: boolean; checks: { name: string; pass: boolean }[]; pixels?: unknown; gaze?: unknown }
    assert.equal(proof.passed, false)
    assert.match(proof.checks.find(check => !check.pass)?.name ?? '', /missing-runtime-dependency/)
    assert.equal(proof.pixels, undefined)
    assert.equal(proof.gaze, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})
