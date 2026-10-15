import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { inspectOfficeRelease, verifyOfficeReleaseDownload } from './office-release-sync.mjs'
import { parseReleaseVersion } from './release-notes.mjs'

if (process.platform !== 'win32' || !isAbsolute(process.argv[2] ?? '')) throw new Error('Use an absolute Windows office release sync configuration.')
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const fields = ['githubExecutable', 'publisherScript', 'releaseDirectory', 'stateDirectory']
if (Object.keys(config).sort().join(',') !== fields.sort().join(',') || !fields.every(key => typeof config[key] === 'string' && isAbsolute(config[key]))
  || resolve(config.stateDirectory) !== resolve(dirname(process.argv[2]))) throw new Error('INVALID_RELEASE_SYNC_CONFIG')
const repository = 'Josquexecute/HasarBotuV2'
await mkdir(config.stateDirectory, { recursive: true })
async function status(value) {
  const output = { ...value, checkedAt: new Date().toISOString() }, temporary = join(config.stateDirectory, `status.${process.pid}.tmp`)
  await writeFile(temporary, JSON.stringify(output, null, 2))
  await rename(temporary, join(config.stateDirectory, 'status.json'))
  console.log(JSON.stringify(output))
}
function gh(args, binary = false) {
  try { return execFileSync(config.githubExecutable, ['api', '--hostname', 'github.com', ...args.slice(1)], { windowsHide: true, timeout: binary ? 180_000 : 30_000,
    maxBuffer: binary ? 250 * 1024 * 1024 : 2_000_000, stdio: ['ignore', 'pipe', 'pipe'], ...(binary ? {} : { encoding: 'utf8' }) }) }
  catch (error) {
    const code = /HTTP (\d{3})/.exec(String(error.stderr))?.[1]
    throw new Error(code === '401' || error.status === 4 ? 'GITHUB_AUTH_REQUIRED' : code === '404' ? 'GITHUB_RELEASE_NOT_ACCESSIBLE' : 'GITHUB_REQUEST_FAILED')
  }
}
const api = route => JSON.parse(gh(['api', `repos/${repository}${route ? '/' + route : ''}`]))
try {
  const access = api('')
  if (access.full_name !== repository || !access.private) throw new Error('PRIVATE_SOURCE_REPOSITORY_REQUIRED')
  let release
  try { release = api('releases/latest') }
  catch (error) {
    if (error.message !== 'GITHUB_RELEASE_NOT_ACCESSIBLE') throw error
    await status({ status: 'NO_PUBLISHED_RELEASE' })
    process.exit(0)
  }
  parseReleaseVersion(release.tag_name)
  const sourceSha = api('commits/' + encodeURIComponent(release.tag_name)).sha
  const runId = new RegExp(`https://github\\.com/${repository}/actions/runs/(\\d+)`).exec(release.body ?? '')?.[1]
  if (!runId) throw new Error('RELEASE_BUILD_REFERENCE_MISSING')
  const run = api('actions/runs/' + runId)
  let current
  try { current = JSON.parse(await readFile(join(config.releaseDirectory, 'latest.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const approved = inspectOfficeRelease({ release, sourceSha, run, current })
  if (approved.action === 'CURRENT') {
    const bytes = await readFile(join(config.releaseDirectory, approved.sha256 + '.exe'))
    if (bytes.length !== approved.size || createHash('sha256').update(bytes).digest('hex') !== approved.sha256) throw new Error('OFFICE_ARTIFACT_DAMAGED')
  } else if (approved.action === 'UPDATE') {
    const directory = await mkdtemp(join(config.stateDirectory, 'download-'))
    const installer = gh(['api', `repos/${repository}/releases/assets/${approved.assetId}`, '-H', 'Accept: application/octet-stream'], true)
    const checksum = gh(['api', `repos/${repository}/releases/assets/${approved.checksumAssetId}`, '-H', 'Accept: application/octet-stream'])
    verifyOfficeReleaseDownload(approved, installer, checksum)
    const unchanged = inspectOfficeRelease({ release: api('releases/' + release.id), sourceSha, run, current })
    if (unchanged.sha256 !== approved.sha256 || unchanged.action !== 'UPDATE') throw new Error('RELEASE_CHANGED_DURING_DOWNLOAD')
    const executable = join(directory, 'installer.exe'), notes = join(directory, 'notes.txt')
    await writeFile(executable, installer); await writeFile(notes, release.body)
    try { execFileSync(process.execPath, [config.publisherScript, executable, config.releaseDirectory, approved.version, notes], {
      windowsHide: true, timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'],
    }) } catch { throw new Error('OFFICE_RELEASE_PUBLICATION_FAILED') }
    const effective = JSON.parse(await readFile(join(config.releaseDirectory, 'latest.json'), 'utf8'))
    if (effective.version !== approved.version || effective.sha256 !== approved.sha256 || effective.size !== approved.size) throw new Error('OFFICE_RELEASE_MANIFEST_MISMATCH')
    await unlink(executable)
  }
  await status({ status: 'PASS', action: approved.action, githubVersion: approved.version, officeVersion: approved.action === 'KEEP_NEWER' ? current.version : approved.version })
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'OFFICE_RELEASE_SYNC_FAILED'
  await status({ status: code === 'GITHUB_AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'BLOCKED', code })
  process.exitCode = 1
}
