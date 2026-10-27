import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'

const run = promisify(execFile)
const noticePath = 'services/file-agent/THIRD-PARTY-NOTICES.txt'

test('HEIC notices identify the statically embedded LGPL decoder and exact source/build chain', async () => {
  const notice = await readFile(noticePath, 'utf8')
  const pkg = JSON.parse(await readFile('services/file-agent/package.json', 'utf8'))
  assert.ok(notice.includes(`libheif-js ${pkg.dependencies['libheif-js']}`))
  assert.ok(/libde265 1\.0\.15/.test(notice), 'the embedded libde265 decoder must be identified')
  assert.ok(/Copyright \(c\) 2013-2014 struktur AG, Dirk Farin/.test(notice), 'the embedded decoder attribution must be preserved')
  assert.ok(notice.includes('https://github.com/strukturag/libde265/tree/v1.0.15'))
  assert.ok(notice.includes('https://github.com/strukturag/libde265/blob/v1.0.15/COPYING'))
  assert.ok(notice.includes('https://github.com/strukturag/libheif/blob/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/build-emscripten.sh'))
  assert.ok(/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]*Version 3, 29 June 2007/.test(notice), 'the LGPL-3.0 text must be retained')
  assert.ok(/GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3, 29 June 2007/.test(notice), 'the GPL-3.0 text must be retained')
})

test('actual npm package carries the complete codec notice bytes', async () => {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean)
  let npmCli
  for (const candidate of candidates) {
    try { await access(candidate); npmCli = candidate; break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  assert.ok(npmCli, 'npm CLI must be available with the supported Node.js installation')
  const directory = await mkdtemp(join(tmpdir(), 'hasarbotu-codec-notices-'))
  try {
    const { stdout } = await run(process.execPath, [npmCli, 'pack', '--workspace', '@hasarbotu/file-agent', '--ignore-scripts', '--json', '--pack-destination', directory], { windowsHide: true })
    const [packed] = JSON.parse(stdout)
    const notice = await readFile(noticePath)
    const supplement = await readFile('services/file-agent/codec-license-evidence.json')
    const entry = packed.files.find(file => file.path === 'THIRD-PARTY-NOTICES.txt')
    assert.equal(entry?.size, notice.length)
    assert.equal(packed.files.find(file => file.path === 'codec-license-evidence.json')?.size, supplement.length)
    const tar = gunzipSync(await readFile(join(directory, packed.filename)))
    assert.ok(tar.includes(notice), 'the archive must retain the whole notice, including embedded codec attribution and licenses')
    assert.ok(tar.includes(supplement), 'native license resolutions and aggregate binary limits must accompany distribution')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
