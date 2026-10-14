import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopReleaseSchema } from '@hasarbotu/contracts'

const [repository, installer, version, notesFile] = process.argv.slice(2)
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !installer || !version || !notesFile) {
  throw new Error('Usage: node scripts/publish-desktop-github-release.mjs <public-download-repository> <installer.exe> <version> <notes.md>')
}
if (process.platform !== 'win32') throw new Error('Windows executable metadata must be verified on Windows.')
function gh(args) { return execFileSync('gh', args, { windowsHide: true, encoding: 'utf8', maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] }) }
function optionalApi(route) {
  try { return JSON.parse(gh(['api', route])) } catch (error) {
    if (String(error.stderr).includes('HTTP 404')) return null
    throw error
  }
}
const repo = JSON.parse(gh(['repo', 'view', repository, '--json', 'isPrivate']))
if (repo.isPrivate) throw new Error('Use a separate public download repository; source repository visibility is never changed.')
const source = resolve(installer)
const actualVersion = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HB_GITHUB_INSTALLER_PATH).VersionInfo.ProductVersion'], {
  windowsHide: true, encoding: 'utf8', env: { ...process.env, HB_GITHUB_INSTALLER_PATH: source },
}).trim()
if (actualVersion !== version && actualVersion !== version + '.0') throw new Error('Installer version mismatch.')
const bytes = await readFile(source)
if (bytes.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Expected a Windows installer.')
const release = desktopReleaseSchema.parse({ version, platform: 'win32', arch: 'x64', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, publishedAt: new Date().toISOString(), notes: await readFile(resolve(notesFile), 'utf8') })
const tag = 'v' + release.version
const latest = optionalApi(`repos/${repository}/releases/latest`)
if (latest) {
  const previous = latest.tag_name.replace(/^v/, '').split('.').map(BigInt), next = release.version.split('.').map(BigInt)
  let comparison = 0
  for (let index = 0; index < 3 && !comparison; index++) comparison = next[index] > previous[index] ? 1 : next[index] < previous[index] ? -1 : 0
  if (comparison < 0) throw new Error('A release cannot downgrade the public download.')
}
const existing = JSON.parse(gh(['api', `repos/${repository}/releases?per_page=100`])).find(candidate => candidate.tag_name === tag)
if (existing?.assets?.length) {
  const asset = existing.assets.find(a => a.name === 'HasarBotu-Kurulum.exe')
  if (!asset || asset.digest !== 'sha256:' + release.sha256 || asset.size !== release.size) throw new Error('Existing release artifact cannot be replaced.')
} else {
  if (existing && !existing.draft) throw new Error('Published release is missing its verified artifact.')
  if (!existing) gh(['release', 'create', tag, '--repo', repository, '--draft', '--title', 'HasarBotu ' + version, '--notes-file', resolve(notesFile)])
  const staging = await mkdtemp(join(tmpdir(), 'hasarbotu-release-'))
  const artifact = join(staging, 'HasarBotu-Kurulum.exe'), checksums = join(staging, 'SHA256SUMS.txt')
  await copyFile(source, artifact)
  await writeFile(checksums, release.sha256 + '  HasarBotu-Kurulum.exe\n')
  gh(['release', 'upload', tag, artifact, checksums, '--repo', repository])
}
const uploaded = JSON.parse(gh(['api', `repos/${repository}/releases?per_page=100`])).find(candidate => candidate.tag_name === tag)
if (!uploaded) throw new Error('Uploaded release is missing.')
const verified = JSON.parse(gh(['api', `repos/${repository}/releases/${uploaded.id}`]))
const asset = verified.assets.find(a => a.name === 'HasarBotu-Kurulum.exe')
if (asset?.digest !== 'sha256:' + release.sha256 || asset.size !== release.size) throw new Error('GitHub uploaded artifact integrity mismatch.')
const checksum = verified.assets.find(a => a.name === 'SHA256SUMS.txt')
if (checksum?.digest !== 'sha256:' + createHash('sha256').update(release.sha256 + '  HasarBotu-Kurulum.exe\n').digest('hex')) throw new Error('GitHub checksum asset is missing or changed.')
console.log(JSON.stringify({ status: 'PASS', draft: verified.draft, version: release.version, sha256: release.sha256, size: release.size, url: verified.html_url }))
