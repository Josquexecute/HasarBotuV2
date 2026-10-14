import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareReleaseAssets, validateDraftUpdate } from './release-artifacts.mjs'
import { compareReleaseVersions, mergeReleaseNotes, readReleaseCommits, renderReleaseNotes } from './release-notes.mjs'

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'Josquexecute/HasarBotuV2') throw new Error('This draft publisher runs only in the source repository GitHub workflow.')
const repository = process.env.GITHUB_REPOSITORY, sha = process.env.GITHUB_SHA
const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version
function gh(args) { return execFileSync('gh', args, { windowsHide: true, encoding: 'utf8', maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] }) }
function api(route) { return JSON.parse(gh(['api', route])) }
if (api(`repos/${repository}/git/ref/heads/main`).object.sha !== sha) throw new Error('Main changed after this build; the newer run must prepare the draft.')
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha) throw new Error('Checkout does not match the tested commit.')
const releases = api(`repos/${repository}/releases?per_page=100`)
const previous = releases.filter(r => !r.draft && !r.prerelease).sort((a, b) => compareReleaseVersions(b.tag_name, a.tag_name))[0]
if (previous && compareReleaseVersions(version, previous.tag_name) <= 0) throw new Error('Increase apps/desktop/package.json before preparing a new release.')
const baseline = JSON.parse(await readFile('.github/release-baseline.json', 'utf8'))
if (!previous && compareReleaseVersions(version, baseline.version) <= 0) throw new Error('Increase the desktop version beyond the existing distribution baseline.')
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ status: 'PASS', version, testedSource: sha }))
  process.exit(0)
}
const previousSha = previous ? execFileSync('git', ['rev-parse', `${previous.tag_name}^{commit}`], { encoding: 'utf8' }).trim() : baseline.sourceSha
let summary = ''
try { summary = await readFile(`.github/release-notes/${version}.md`, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
const testSummary = JSON.parse(await readFile(join(process.env.RUNNER_TEMP, 'hasarbotu-release-checks/summary.json'), 'utf8'))
const generated = renderReleaseNotes(readReleaseCommits(previousSha, sha), { version, sourceSha: sha, summary, testSummary,
  runUrl: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` })
let existing = releases.find(r => r.tag_name === 'v' + version)
const tag = validateDraftUpdate(existing, { version, sourceSha: sha })
let existingTag
try { existingTag = api(`repos/${repository}/commits/${tag}`).sha } catch (error) { if (!String(error.stderr).includes('HTTP 404') && !String(error.stderr).includes('HTTP 422')) throw error }
if (existingTag && existingTag !== sha) throw new Error('This tag already points to another commit; choose a new version.')
const staging = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'hasarbotu-validated-release-'))
const artifact = await prepareReleaseAssets(`apps/desktop/release/HasarBotu-Setup-${version}.exe`, version, staging)
const inputFile = join(staging, 'request.json')
async function request(route, body, method = 'POST') {
  await writeFile(inputFile, JSON.stringify(body))
  return JSON.parse(gh(['api', '--method', method, route, '--input', inputFile]))
}
const notes = mergeReleaseNotes(existing?.body ?? '', generated + `\n<!-- hasarbotu-artifact:${artifact.sha256}:${artifact.size} -->`)
if (notes.length > 4000) throw new Error('Release notes must fit the desktop update limit of 4000 characters.')
// A fixed tested commit prevents publishing a package against a later, untested main.
const pending = mergeReleaseNotes(existing?.body ?? '', 'Paket yükleniyor; bu taslağı henüz yayınlamayın.')
existing = existing
  ? await request(`repos/${repository}/releases/${existing.id}`, { body: pending, target_commitish: sha }, 'PATCH')
  : await request(`repos/${repository}/releases`, { tag_name: tag, target_commitish: sha, name: `HasarBotu ${version}`, body: pending, draft: true, prerelease: false })
if (!existing.draft) throw new Error('Release was published before artifact verification.')
for (const asset of existing.assets ?? []) {
  if (['HasarBotu-Kurulum.exe', 'SHA256SUMS.txt'].includes(asset.name)) gh(['api', '--method', 'DELETE', `repos/${repository}/releases/assets/${asset.id}`])
}
gh(['release', 'upload', tag, artifact.artifact, artifact.checksum, '--repo', repository])
const verified = api(`repos/${repository}/releases/${existing.id}`)
const exe = verified.assets.find(a => a.name === 'HasarBotu-Kurulum.exe'), sums = verified.assets.find(a => a.name === 'SHA256SUMS.txt')
if (!verified.draft || exe?.digest !== 'sha256:' + artifact.sha256 || exe?.size !== artifact.size
  || sums?.digest !== 'sha256:' + createHash('sha256').update(artifact.sha256 + '  HasarBotu-Kurulum.exe\n').digest('hex')) throw new Error('Uploaded draft assets were not verified.')
await request(`repos/${repository}/releases/${existing.id}`, { body: notes, target_commitish: sha }, 'PATCH')
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `Sürüm taslağı hazır: [${tag}](${verified.html_url}).\n\nPaket ve açıklama doğrulandı. Son yayın düğmesi kullanıcıya aittir.\n`, { flag: 'a' })
console.log(JSON.stringify({ status: 'PASS', draft: true, tag, sha256: artifact.sha256, size: artifact.size, url: verified.html_url }))
