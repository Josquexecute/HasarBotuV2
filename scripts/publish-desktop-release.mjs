import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { desktopReleaseSchema } from '@hasarbotu/contracts'

const [installer, directory, version, notesFile] = process.argv.slice(2)
if (!installer || !directory || !version || !notesFile) throw new Error('Usage: node scripts/publish-desktop-release.mjs <installer.exe> <release-directory> <version> <notes.txt>')
const source = resolve(installer), target = resolve(directory)
if (process.platform !== 'win32') throw new Error('Publish Windows releases on Windows to verify executable version metadata')
const actualVersion = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HB_PUBLISH_INSTALLER_PATH).VersionInfo.ProductVersion'], { windowsHide: true, timeout: 15_000, encoding: 'utf8', env: { ...process.env, HB_PUBLISH_INSTALLER_PATH: source } }).trim()
if (actualVersion !== version && actualVersion !== version + '.0') throw new Error('Executable version does not match the release version')
async function hashFile(path) {
  const handle = await open(path, 'r'), digest = createHash('sha256')
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); return digest.digest('hex') }
  finally { await handle.close() }
}
const handle = await open(source, 'r')
try {
  const signature = Buffer.alloc(2); await handle.read(signature, 0, 2, 0)
  if (signature.toString('ascii') !== 'MZ') throw new Error('Installer must be a Windows executable')
} finally { await handle.close() }
const release = desktopReleaseSchema.parse({ version, platform: 'win32', arch: 'x64', sha256: await hashFile(source), size: (await stat(source)).size, publishedAt: new Date().toISOString(), notes: await readFile(resolve(notesFile), 'utf8') })
await mkdir(target, { recursive: true })
const manifest = join(target, 'latest.json'), artifact = join(target, release.sha256 + '.exe')
let previous
try { previous = desktopReleaseSchema.parse(JSON.parse(await readFile(manifest, 'utf8'))) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (previous) {
  const a = release.version.split('.').map(BigInt), b = previous.version.split('.').map(BigInt)
  let comparison = 0
  for (let i = 0; i < 3 && !comparison; i++) comparison = a[i] > b[i] ? 1 : a[i] < b[i] ? -1 : 0
  if (comparison < 0 || comparison === 0 && previous.sha256 !== release.sha256) throw new Error('A release must not downgrade or replace an existing version')
}
try { await copyFile(source, artifact, constants.COPYFILE_EXCL) }
catch (error) { if (error.code !== 'EEXIST') throw error }
if ((await stat(artifact)).size !== release.size || await hashFile(artifact) !== release.sha256) throw new Error('Published artifact integrity mismatch')
const temporary = manifest + '.' + process.pid + '.tmp'
try { await writeFile(temporary, JSON.stringify(release, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, manifest) }
finally { await rm(temporary, { force: true }) }
console.log(JSON.stringify({ status: 'PASS', version: release.version, sha256: release.sha256, size: release.size }))
