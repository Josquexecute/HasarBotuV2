import { createHash } from 'node:crypto'
import { compareReleaseVersions } from './release-notes.mjs'
import { validatePublishedRelease } from './published-release.mjs'

export function inspectOfficeRelease({ release, sourceSha, run, current }) {
  const approved = validatePublishedRelease(release, sourceSha)
  if (!run || run.conclusion !== 'success' || run.head_sha !== sourceSha || run.head_branch !== 'main'
    || run.path !== '.github/workflows/desktop-release.yml') throw new Error('RELEASE_BUILD_NOT_VERIFIED')
  if (current) {
    const comparison = compareReleaseVersions(approved.version, current.version)
    if (comparison < 0) return { ...approved, action: 'KEEP_NEWER' }
    if (comparison === 0) {
      if (approved.sha256 !== current.sha256 || approved.size !== current.size) throw new Error('PUBLISHED_VERSION_CHANGED')
      return { ...approved, action: 'CURRENT' }
    }
  }
  return { ...approved, action: 'UPDATE' }
}

export function verifyOfficeReleaseDownload(approved, installer, checksum) {
  if (installer.length !== approved.size || installer.subarray(0, 2).toString('ascii') !== 'MZ'
    || createHash('sha256').update(installer).digest('hex') !== approved.sha256
    || checksum !== approved.sha256 + '  HasarBotu-Kurulum.exe\n') throw new Error('RELEASE_DOWNLOAD_MISMATCH')
}
