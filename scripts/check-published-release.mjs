import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validatePublishedRelease } from './published-release.mjs'
import { prepareReleaseAssets } from './release-artifacts.mjs'
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'Josquexecute/HasarBotuV2') throw new Error('Use the private source publication workflow.')
const repository = process.env.GITHUB_REPOSITORY, event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
function gh(args, binary = false) { return execFileSync('gh', args, { windowsHide: true,
  ...(binary ? {} : { encoding: 'utf8' }), maxBuffer: binary ? 250 * 1024 * 1024 : 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] }) }
const release = JSON.parse(gh(['api', `repos/${repository}/releases/${event.release.id}`]))
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const approved = validatePublishedRelease(release, sha)
const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'hasarbotu-published-check-'))
const bytes = gh(['api', `repos/${repository}/releases/assets/${approved.assetId}`, '-H', 'Accept: application/octet-stream'], true)
if (bytes.length !== approved.size || createHash('sha256').update(bytes).digest('hex') !== approved.sha256) throw new Error('Private release download integrity mismatch.')
const checksum = gh(['api', `repos/${repository}/releases/assets/${approved.checksumAssetId}`, '-H', 'Accept: application/octet-stream'])
if (checksum !== approved.sha256 + '  HasarBotu-Kurulum.exe\n') throw new Error('Private release checksum download mismatch.')
const installer = join(directory, 'published.exe')
await writeFile(installer, bytes)
await prepareReleaseAssets(installer, approved.version, join(directory, 'verified'))
console.log(JSON.stringify({ status: 'PASS', version: approved.version, actualPrivateDownloadVerified: true, checksumDownloadVerified: true, sourceCommitVerified: true }))
