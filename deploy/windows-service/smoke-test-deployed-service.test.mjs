import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(new URL('./smoke-test-deployed-service.mjs', import.meta.url))

async function makeFixtureRoot() {
  return await mkdtemp(path.join(tmpdir(), 'hb-smoke-fixture-'))
}

function runSmoke(targetDir, extraEnv = {}) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, targetDir], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv, NODE_PATH: '' },
  })
  const lastLine = result.stdout.trim().split('\n').filter(Boolean).at(-1)
  return { exitCode: result.status, json: lastLine ? JSON.parse(lastLine) : null, stderr: result.stderr }
}

test('basarili durum: main-guard sayesinde import sirasinda gercek baslatma tetiklenmez, ic ice bagimliligi dahil tum grafik cozulur', async () => {
  const root = await makeFixtureRoot()
  try {
    const distDir = path.join(root, 'dist')
    await mkdir(distDir, { recursive: true })
    const depDir = path.join(root, 'node_modules', 'fake-dep')
    await mkdir(depDir, { recursive: true })
    await writeFile(path.join(depDir, 'package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0', type: 'module', main: 'index.js' }))
    await writeFile(path.join(depDir, 'index.js'), 'export const value = 42;\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-service', version: '1.0.0', type: 'module' }))
    await writeFile(
      path.join(distDir, 'index.js'),
      [
        "import { resolve } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "import { value } from 'fake-dep';",
        'export const exportedValue = value;',
        'const entryScript = process.argv[1];',
        'if (entryScript !== undefined && resolve(entryScript) === fileURLToPath(import.meta.url)) {',
        "  throw new Error('REAL STARTUP WAS TRIGGERED -- main-guard failed');",
        '}',
      ].join('\n'),
    )

    const { exitCode, json } = runSmoke(root)
    assert.equal(exitCode, 0)
    assert.equal(json.status, 'ok')
    assert.equal(json.exportCount, 1)
    assert.equal(json.nodePathSet, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dist/index.js yoksa fail-closed hata doner (exit 1)', async () => {
  const root = await makeFixtureRoot()
  try {
    const { exitCode, json } = runSmoke(root)
    assert.equal(exitCode, 1)
    assert.equal(json.status, 'error')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deploy edilmemis (repo kokune bagimli) bir ic ice bagimlilik cozulemezse fail-closed hata doner', async () => {
  const root = await makeFixtureRoot()
  try {
    const distDir = path.join(root, 'dist')
    await mkdir(distDir, { recursive: true })
    await writeFile(
      path.join(distDir, 'index.js'),
      "import { value } from 'missing-dependency-not-vendored';\nexport const exportedValue = value;\n",
    )
    const { exitCode, json } = runSmoke(root)
    assert.equal(exitCode, 1)
    assert.equal(json.status, 'error')
    assert.match(json.errorMessage, /missing-dependency-not-vendored/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('-TargetDir verilmezse fail-closed hata doner (exit 2)', () => {
  const { exitCode, json } = runSmoke('')
  assert.equal(exitCode, 2)
  assert.equal(json.status, 'error')
  assert.equal(json.errorCode, 'TARGET_DIR_REQUIRED')
})
