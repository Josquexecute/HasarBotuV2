import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { buildFrontendLicenseNotices, frontendLicenseNotices } from './frontend-license-notices.ts'

const roots = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'hb-frontend-licenses-'))
  roots.push(root)
  return root
}
async function dependency(root, name, files = { LICENSE: 'MIT license text\n' }, metadata = {}) {
  const directory = path.join(root, 'node_modules', name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', main: 'index.js', ...metadata }))
  await writeFile(path.join(directory, 'index.js'), 'export const value = 42\n')
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(directory, file), content)
  return path.join(directory, 'index.js')
}

test('uses only included packages, retains license and notices, and sorts deterministically', async () => {
  const root = await fixture()
  const alpha = await dependency(root, '@scope/alpha', { 'LICENSE.md': 'Alpha license\n', NOTICE: 'Copyright Alpha\n' })
  const beta = await dependency(root, 'beta', { COPYING: 'Beta license\n' })
  await dependency(root, 'unused', {})
  const first = await buildFrontendLicenseNotices([beta, alpha, alpha + '?commonjs-proxy', path.join(root, 'main.js')])
  assert.equal(first, await buildFrontendLicenseNotices([alpha, beta]))
  assert.match(first, /Alpha license\n/)
  assert.match(first, /Copyright Alpha\n/)
  assert.ok(first.indexOf('@scope/alpha@1.0.0') < first.indexOf('beta@1.0.0'))
  assert.doesNotMatch(first, /unused|hb-frontend-licenses/)
})

test('fails closed on missing license text, required notices, and empty legal files', async () => {
  const root = await fixture()
  const absent = await dependency(root, 'absent', {})
  await assert.rejects(buildFrontendLicenseNotices([absent]), /license text missing/)
  const notice = await dependency(root, 'notice', { LICENSE: 'MIT' }, { files: ['index.js', 'NOTICE.txt'] })
  await assert.rejects(buildFrontendLicenseNotices([notice]), /legal file missing: notice@1.0.0\/NOTICE.txt/)
  const empty = await dependency(root, 'empty', { LICENSE: 'MIT', NOTICE: '  \n' })
  await assert.rejects(buildFrontendLicenseNotices([empty]), /legal file empty/)
  const reference = await dependency(root, 'reference', { LICENSE: 'MIT' }, { license: 'SEE LICENSE IN COPYING.txt' })
  await assert.rejects(buildFrontendLicenseNotices([reference]), /legal file missing/)
})

test('emits the notices through a real production Vite bundle', async () => {
  const root = await fixture()
  await dependency(root, 'bundled', { LICENSE: 'Bundled complete license\n', NOTICE: 'Required notice\n' })
  await dependency(root, 'not-bundled', {})
  await writeFile(path.join(root, 'main.js'), "import { value } from 'bundled'; console.log(value)\n")
  const result = await build({ root, configFile: false, logLevel: 'silent', plugins: [frontendLicenseNotices()], build: { write: false, rollupOptions: { input: path.join(root, 'main.js') } } })
  const notice = result.output.find(output => output.type === 'asset' && output.fileName === 'THIRD-PARTY-NOTICES.txt')
  assert.ok(notice)
  assert.match(notice.source, /bundled@1.0.0/)
  assert.match(notice.source, /Bundled complete license\n/)
  assert.match(notice.source, /Required notice\n/)
  assert.doesNotMatch(notice.source, /not-bundled/)
})
