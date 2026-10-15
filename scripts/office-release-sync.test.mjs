import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { inspectOfficeRelease, verifyOfficeReleaseDownload } from './office-release-sync.mjs'
const sha = 'a'.repeat(40), bytes = Buffer.from('MZ\0test-installer'), digest = createHash('sha256').update(bytes).digest('hex')
const checksum = digest + '  HasarBotu-Kurulum.exe\n'
const release = { tag_name: 'v0.1.16', draft: false, prerelease: false,
  body: `<!-- hasarbotu-source:${sha} -->\n<!-- hasarbotu-artifact:${digest}:${bytes.length} -->`,
  assets: [{ id: 1, name: 'HasarBotu-Kurulum.exe', size: bytes.length, digest: 'sha256:' + digest },
    { id: 2, name: 'SHA256SUMS.txt', size: Buffer.byteLength(checksum), digest: 'sha256:' + createHash('sha256').update(checksum).digest('hex') }] }
const run = { head_sha: sha, head_branch: 'main', conclusion: 'success', path: '.github/workflows/desktop-release.yml' }
const input = { release, sourceSha: sha, run }
test('only a published release from a successful source build can update the office', () => {
  assert.equal(inspectOfficeRelease(input).action, 'UPDATE')
  for (const changes of [{ conclusion: 'failure' }, { head_sha: 'b'.repeat(40) }, { head_branch: 'other' }, { path: 'other.yml' }]) {
    assert.throws(() => inspectOfficeRelease({ ...input, run: { ...run, ...changes } }), /BUILD_NOT_VERIFIED/)
  }
  assert.throws(() => inspectOfficeRelease({ ...input, release: { ...release, draft: true } }))
})
test('idempotent sync preserves the same release and never downgrades a newer office', () => {
  const current = { version: '0.1.16', sha256: digest, size: bytes.length }
  assert.equal(inspectOfficeRelease({ ...input, current }).action, 'CURRENT')
  assert.equal(inspectOfficeRelease({ ...input, current: { ...current, version: '0.1.17' } }).action, 'KEEP_NEWER')
  assert.throws(() => inspectOfficeRelease({ ...input, current: { ...current, sha256: 'f'.repeat(64) } }), /VERSION_CHANGED/)
})
test('partial, changed or non-executable downloads and changed checksums cannot be published', () => {
  const approved = inspectOfficeRelease(input)
  verifyOfficeReleaseDownload(approved, bytes, checksum)
  assert.throws(() => verifyOfficeReleaseDownload(approved, bytes.subarray(1), checksum), /DOWNLOAD_MISMATCH/)
  assert.throws(() => verifyOfficeReleaseDownload(approved, Buffer.from('ZZ\0test-installer'), checksum), /DOWNLOAD_MISMATCH/)
  assert.throws(() => verifyOfficeReleaseDownload(approved, bytes, 'changed'), /DOWNLOAD_MISMATCH/)
})
