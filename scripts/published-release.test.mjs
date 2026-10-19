import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validatePublishedRelease } from './published-release.mjs'
const sha = 'a'.repeat(40), digest = 'b'.repeat(64)
const checksum = digest + '  HasarBotu-Kurulum.exe\n'
const release = { tag_name: 'v0.1.16', draft: false, prerelease: false,
  body: `<!-- hasarbotu-source:${sha} -->\n<!-- hasarbotu-artifact:${digest}:123 -->`,
  assets: [{ id: 42, name: 'HasarBotu-Kurulum.exe', size: 123, digest: 'sha256:' + digest },
    { id: 43, name: 'SHA256SUMS.txt', size: Buffer.byteLength(checksum), digest: 'sha256:' + createHash('sha256').update(checksum).digest('hex') }] }
test('a user-published validated release keeps its exact installer identity', () => {
  assert.deepEqual(validatePublishedRelease(release, sha), { version: '0.1.16', sha256: digest, size: 123, assetId: 42, checksumAssetId: 43 })
})
test('missing approval, changed tags, source mismatches and changed installer or checksum fail verification', () => {
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.1.16; command' }, { body: '' },
    { assets: [{ ...release.assets[0], digest: 'sha256:' + 'c'.repeat(64) }, release.assets[1]] },
    { assets: [{ ...release.assets[0], size: 124 }, release.assets[1]] },
    { assets: [release.assets[0]] },
    { assets: [release.assets[0], { ...release.assets[1], digest: 'sha256:' + 'c'.repeat(64) }] }]) {
    assert.throws(() => validatePublishedRelease({ ...release, ...patch }, sha))
  }
  assert.throws(() => validatePublishedRelease(release, 'd'.repeat(40)))
})
test('published notes with broken Turkish fail before office synchronization', () => {
  assert.throws(() => validatePublishedRelease({ ...release, body: 'a\u00c5\u0178amalar\u00c4\u00b1\n' + release.body }, sha), /garbled text/)
})
