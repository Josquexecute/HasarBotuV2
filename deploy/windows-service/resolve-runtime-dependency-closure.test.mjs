import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  computeClosure,
  isOptionalDependencyCompatible,
  resolveDependencyLockKey,
  verifyOnDiskVersions,
} from './resolve-runtime-dependency-closure.mjs'

// Small, hand-built lockfileVersion-3-shaped fixture that deliberately
// mirrors every real structural quirk this resolver must handle:
//   - a workspace with BOTH dependencies and devDependencies (dev must
//     never be followed);
//   - a workspace-internal dependency reached via an npm workspaces
//     node_modules "link": true stub (must redirect, not be treated as
//     an external package);
//   - a package with a NESTED node_modules override that must win over
//     the hoisted root version of the same name (mirrors this repo's
//     real fastify/ajv-compiler nesting);
//   - an optionalDependency with an os/cpu constraint that is
//     incompatible with the fixture's chosen "current platform" and one
//     that is compatible.
function buildFixtureLockPackages() {
  return {
    '': { name: 'fixture-root' },
    'services/demo': {
      name: '@fixture/demo',
      dependencies: { 'left-pad': '1.0.0', '@fixture/lib': '*', 'optional-native': '2.0.0' },
      devDependencies: { 'vitest': '9.9.9', '@fixture/dev-only-lib': '*' },
    },
    'node_modules/left-pad': {
      name: 'left-pad',
      version: '1.0.0',
      resolved: 'https://registry.example/left-pad/-/left-pad-1.0.0.tgz',
      integrity: 'sha512-fake',
      dependencies: { 'shared-dep': '1.0.0' },
    },
    // Hoisted (root) shared-dep -- should be shadowed by the nested one below
    // when resolved FROM node_modules/left-pad, but would be the correct
    // answer if resolved from elsewhere.
    'node_modules/shared-dep': {
      name: 'shared-dep',
      version: '1.0.0',
      resolved: 'https://registry.example/shared-dep/-/shared-dep-1.0.0.tgz',
      integrity: 'sha512-fake-hoisted',
    },
    // left-pad pins its OWN, different, nested copy of shared-dep.
    'node_modules/left-pad/node_modules/shared-dep': {
      name: 'shared-dep',
      version: '2.0.0',
      resolved: 'https://registry.example/shared-dep/-/shared-dep-2.0.0.tgz',
      integrity: 'sha512-fake-nested',
    },
    'node_modules/optional-native': {
      name: 'optional-native',
      version: '2.0.0',
      resolved: 'https://registry.example/optional-native/-/optional-native-2.0.0.tgz',
      integrity: 'sha512-fake',
      optionalDependencies: {
        'optional-native-win32-x64': '2.0.0',
        'optional-native-linux-x64': '2.0.0',
      },
    },
    'node_modules/optional-native-win32-x64': {
      version: '2.0.0', resolved: 'https://registry.example/x', integrity: 'sha512-fake',
      os: ['win32'], cpu: ['x64'], optional: true,
    },
    'node_modules/optional-native-linux-x64': {
      version: '2.0.0', resolved: 'https://registry.example/x', integrity: 'sha512-fake',
      os: ['linux'], cpu: ['x64'], optional: true,
    },
    // Workspace-internal dependency, reached both via a direct workspace
    // path AND via the npm-workspaces node_modules link stub (only the
    // latter is what a real "dependencies" entry actually resolves to).
    'node_modules/@fixture/lib': { resolved: 'packages/lib', link: true },
    'packages/lib': {
      name: '@fixture/lib',
      dependencies: { 'left-pad': '1.0.0' },
    },
    'node_modules/@fixture/dev-only-lib': { resolved: 'packages/dev-only-lib', link: true },
    'packages/dev-only-lib': { name: '@fixture/dev-only-lib', dependencies: {} },
  }
}

test('resolveDependencyLockKey: kok seviyesinde hoisted paketi bulur', () => {
  const packages = buildFixtureLockPackages()
  assert.equal(resolveDependencyLockKey(packages, 'services/demo', 'left-pad'), 'node_modules/left-pad')
})

test('resolveDependencyLockKey: nested override hoisted olandan ONCE bulunur', () => {
  const packages = buildFixtureLockPackages()
  assert.equal(
    resolveDependencyLockKey(packages, 'node_modules/left-pad', 'shared-dep'),
    'node_modules/left-pad/node_modules/shared-dep',
  )
})

test('resolveDependencyLockKey: nested override olmayan bir yerden hoisted olana duser', () => {
  const packages = buildFixtureLockPackages()
  // resolveDependencyLockKey saf bir "bu isim buradan nereye cozulur"
  // fonksiyonudur (gercek Node cozumlemesi gibi) -- "demo" shared-dep'i
  // dogrudan bagimlilik olarak LISTELEMESE bile, path'te kendi nested
  // override'i olmadigi icin hoisted koke duser (dogru davranis).
  assert.equal(resolveDependencyLockKey(packages, 'services/demo', 'shared-dep'), 'node_modules/shared-dep')
  assert.equal(resolveDependencyLockKey(packages, 'packages/lib', 'shared-dep'), 'node_modules/shared-dep')
})

test('resolveDependencyLockKey: kilit dosyasinda olmayan paket icin null doner', () => {
  const packages = buildFixtureLockPackages()
  assert.equal(resolveDependencyLockKey(packages, 'services/demo', 'does-not-exist'), null)
})

test('isOptionalDependencyCompatible: os/cpu kisitlarini dogru degerlendirir', () => {
  const packages = buildFixtureLockPackages()
  assert.equal(isOptionalDependencyCompatible(packages['node_modules/optional-native-win32-x64'], 'win32', 'x64'), true)
  assert.equal(isOptionalDependencyCompatible(packages['node_modules/optional-native-win32-x64'], 'linux', 'x64'), false)
  assert.equal(isOptionalDependencyCompatible(packages['node_modules/optional-native-linux-x64'], 'win32', 'x64'), false)
  assert.equal(isOptionalDependencyCompatible(undefined, 'win32', 'x64'), false)
})

test('computeClosure: devDependencies HIC izlenmez (workspace ve nested paketlerde)', () => {
  const packages = buildFixtureLockPackages()
  const closure = computeClosure(packages, 'services/demo', 'win32', 'x64')
  const externalNames = closure.external.map((e) => e.name)
  assert.ok(!externalNames.includes('vitest'), 'vitest (devDependency) closure disinda kalmali')
  assert.ok(!closure.workspaceInternal.includes('packages/dev-only-lib'), 'dev-only workspace paketi closure disinda kalmali')
})

test('computeClosure: workspace-internal link stub dogru sekilde gercek yola yonlendirilir', () => {
  const packages = buildFixtureLockPackages()
  const closure = computeClosure(packages, 'services/demo', 'win32', 'x64')
  assert.deepEqual(closure.workspaceInternal, ['packages/lib'])
  // link stub'in kendisi ("node_modules/@fixture/lib") asla external listede GORUNMEMELI
  assert.ok(!closure.external.some((e) => e.lockKey === 'node_modules/@fixture/lib'))
})

test('computeClosure: nested override (shared-dep 2.0.0) hoisted (1.0.0) yerine dogru secilir', () => {
  const packages = buildFixtureLockPackages()
  const closure = computeClosure(packages, 'services/demo', 'win32', 'x64')
  const sharedDepEntries = closure.external.filter((e) => e.name === 'shared-dep')
  assert.equal(sharedDepEntries.length, 1, 'yalniz left-padin gercekten kullandigi nested surum closure a girmeli')
  assert.equal(sharedDepEntries[0].version, '2.0.0')
  assert.equal(sharedDepEntries[0].lockKey, 'node_modules/left-pad/node_modules/shared-dep')
})

test('computeClosure: platform-uyumsuz optional bagimlilik atlanir, uyumlu olan dahil edilir', () => {
  const packages = buildFixtureLockPackages()
  const closure = computeClosure(packages, 'services/demo', 'win32', 'x64')
  const externalNames = closure.external.map((e) => e.name)
  assert.ok(externalNames.includes('optional-native-win32-x64'))
  assert.ok(!externalNames.includes('optional-native-linux-x64'))
  assert.deepEqual(closure.skippedIncompatibleOptional.map((s) => s.name), ['optional-native-linux-x64'])
})

test('computeClosure: gercekte olmayan bir bagimlilik (lockfile ile package.json uyumsuzlugu) fail-closed hata verir', () => {
  const packages = buildFixtureLockPackages()
  packages['services/demo'].dependencies['ghost-package'] = '1.0.0'
  assert.throws(() => computeClosure(packages, 'services/demo', 'win32', 'x64'), /DEPENDENCY_NOT_IN_LOCKFILE_ghost-package/)
})

test('computeClosure: lockfilede olmayan workspace icin fail-closed hata verir', () => {
  const packages = buildFixtureLockPackages()
  assert.throws(() => computeClosure(packages, 'services/does-not-exist', 'win32', 'x64'), /WORKSPACE_NOT_IN_LOCKFILE/)
})

test('verifyOnDiskVersions: gercek diskteki surum kilit dosyasiyla eslesirse lockIntegrityOk true doner', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-closure-test-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', version: '1.0.0' }))

  const closure = { external: [{ lockKey: 'node_modules/left-pad', name: 'left-pad', version: '1.0.0' }] }
  const result = await verifyOnDiskVersions(root, closure)
  assert.equal(result.allOk, true)
  assert.equal(result.external[0].lockIntegrityOk, true)
  assert.equal(result.external[0].onDiskVersion, '1.0.0')
})

test('verifyOnDiskVersions: surum uyusmazliginda (drift) lockIntegrityOk false doner', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-closure-test-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', version: '9.9.9' }))

  const closure = { external: [{ lockKey: 'node_modules/left-pad', name: 'left-pad', version: '1.0.0' }] }
  const result = await verifyOnDiskVersions(root, closure)
  assert.equal(result.allOk, false)
  assert.equal(result.external[0].lockIntegrityOk, false)
})

test('verifyOnDiskVersions: diskte hic olmayan paket icin lockIntegrityOk false doner (silinmis/eksik node_modules)', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-closure-test-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const closure = { external: [{ lockKey: 'node_modules/never-installed', name: 'never-installed', version: '1.0.0' }] }
  const result = await verifyOnDiskVersions(root, closure)
  assert.equal(result.allOk, false)
  assert.equal(result.external[0].existsOnDisk, false)
})

test('CLI: desteklenmeyen lockfileVersion fail-closed reddedilir', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-closure-test-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const lockPath = path.join(root, 'package-lock.json')
  await writeFile(lockPath, JSON.stringify({ lockfileVersion: 2, packages: {} }))
  const scriptPath = fileURLToPath(new URL('./resolve-runtime-dependency-closure.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath, '--repo-root', root, '--workspace', 'services/demo', '--lockfile', lockPath], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.Status, 'error')
  assert.equal(output.ErrorCode, 'LOCKFILE_VERSION_UNSUPPORTED')
})

test('CLI: gercek monorepo lockfile ile services/api ve services/file-agent icin closure basariyla hesaplanir', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const scriptPath = fileURLToPath(new URL('./resolve-runtime-dependency-closure.mjs', import.meta.url))

  const apiResult = spawnSync(process.execPath, [scriptPath, '--repo-root', repoRoot, '--workspace', 'services/api'], { encoding: 'utf8' })
  assert.equal(apiResult.status, 0, apiResult.stdout + apiResult.stderr)
  const apiOutput = JSON.parse(apiResult.stdout)
  assert.equal(apiOutput.Status, 'ok')
  assert.deepEqual([...apiOutput.WorkspaceInternal].sort(), ['packages/contracts', 'packages/database', 'packages/domain'])
  const apiNames = apiOutput.External.map((e) => e.name)
  assert.ok(apiNames.includes('fastify'))
  assert.ok(apiNames.includes('argon2'))
  assert.ok(apiNames.includes('@napi-rs/canvas-win32-x64-msvc'))
  assert.ok(!apiNames.includes('vitest'))
  assert.ok(!apiNames.includes('@hasarbotu/desktop-bridge'))
  assert.ok(apiOutput.External.every((e) => e.lockIntegrityOk === true), 'gercek makinede kurulu node_modules kilit dosyasiyla drift etmemis olmali')

  const fileAgentResult = spawnSync(process.execPath, [scriptPath, '--repo-root', repoRoot, '--workspace', 'services/file-agent'], { encoding: 'utf8' })
  assert.equal(fileAgentResult.status, 0, fileAgentResult.stdout + fileAgentResult.stderr)
  const fileAgentOutput = JSON.parse(fileAgentResult.stdout)
  const fileAgentNames = fileAgentOutput.External.map((e) => e.name)
  assert.ok(fileAgentNames.includes('tesseract.js'))
  assert.ok(fileAgentNames.includes('@tesseract.js-data/eng'))
  assert.ok(fileAgentNames.includes('@tesseract.js-data/tur'))
  assert.ok(!fileAgentNames.includes('fastify'))
})
