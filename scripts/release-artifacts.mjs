import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseReleaseVersion } from './release-notes.mjs'

export async function prepareReleaseAssets(installer, version, directory) {
  version = parseReleaseVersion(version)
  if (process.platform !== 'win32') throw new Error('Windows installer metadata must be verified on Windows.')
  const source = resolve(installer)
  const actual = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HB_RELEASE_EXE).VersionInfo.ProductVersion'], {
    windowsHide: true, encoding: 'utf8', timeout: 15_000, env: { ...process.env, HB_RELEASE_EXE: source },
  }).trim()
  if (actual !== version && actual !== version + '.0') throw new Error('Installer version must match its release tag.')
  const bytes = await readFile(source)
  if (bytes.subarray(0, 2).toString('ascii') !== 'MZ' || bytes.length < 2 || bytes.length > 250 * 1024 * 1024) throw new Error('Invalid Windows installer.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await mkdir(directory, { recursive: true })
  const artifact = join(directory, 'HasarBotu-Kurulum.exe'), checksum = join(directory, 'SHA256SUMS.txt')
  await copyFile(source, artifact)
  await writeFile(checksum, sha256 + '  HasarBotu-Kurulum.exe\n')
  return { artifact, checksum, sha256, size: bytes.length, version }
}

export function validateDraftUpdate(existing, { version, sourceSha }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('A tested source commit is required.')
  const tag = 'v' + parseReleaseVersion(version)
  if (existing && existing.tag_name !== tag) throw new Error('Release tag mismatch.')
  if (existing && !existing.draft) throw new Error('Published releases are immutable; increase the desktop version.')
  if (existing?.prerelease) throw new Error('Prerelease drafts are not stable desktop releases.')
  return tag
}
