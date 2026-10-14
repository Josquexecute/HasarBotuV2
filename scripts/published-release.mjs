import { createHash } from 'node:crypto'
import { parseReleaseVersion } from './release-notes.mjs'

export function validatePublishedRelease(release, sourceSha) {
  if (release.draft || release.prerelease) throw new Error('Only a published stable release can be distributed.')
  if (typeof release.body !== 'string' || release.body.length > 4000) throw new Error('Published notes must fit the desktop update limit.')
  const version = parseReleaseVersion(release.tag_name)
  const source = /<!-- hasarbotu-source:([a-f0-9]{40}) -->/.exec(release.body ?? '')
  const artifact = /<!-- hasarbotu-artifact:([a-f0-9]{64}):(\d+) -->/.exec(release.body ?? '')
  if (!source || source[1] !== sourceSha || !artifact) throw new Error('Release approval does not match the tested source and artifact.')
  const size = Number(artifact[2]), sha256 = artifact[1]
  if (!Number.isSafeInteger(size) || size < 2 || size > 250 * 1024 * 1024) throw new Error('Invalid approved artifact size.')
  const exe = release.assets?.find(a => a.name === 'HasarBotu-Kurulum.exe')
  if (exe?.size !== size || exe.digest !== 'sha256:' + sha256) throw new Error('Published installer differs from its approved draft.')
  const checksum = sha256 + '  HasarBotu-Kurulum.exe\n'
  const sums = release.assets?.find(a => a.name === 'SHA256SUMS.txt')
  if (sums?.size !== Buffer.byteLength(checksum) || sums.digest !== 'sha256:' + createHash('sha256').update(checksum).digest('hex')) throw new Error('Published checksum differs from its approved draft.')
  return { version, sha256, size, assetId: exe.id, checksumAssetId: sums.id }
}
