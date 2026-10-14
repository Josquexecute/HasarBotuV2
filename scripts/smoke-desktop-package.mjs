import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildApp } from '../services/api/dist/app.js'
import { parseOfficeConnection } from '../apps/desktop/dist/main/office-connection.js'

if (process.platform !== 'win32') throw new Error('Run Windows package smoke validation on Windows.')
const directory = resolve(process.argv[2] ?? 'apps/desktop/release/win-unpacked')
const expectedVersion = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version
const expectedProfile = parseOfficeConnection(JSON.parse(await readFile(process.env.HASARBOTU_DISTRIBUTION_PROFILE, 'utf8')))
const packagedProfile = parseOfficeConnection(JSON.parse(await readFile(join(directory, 'resources/office-connection.json'), 'utf8')))
assert.deepEqual(packagedProfile, expectedProfile)
let verifiedUiFiles = 0
async function verifyUi(relative = '') {
  for (const entry of await readdir(join('dist', relative), { withFileTypes: true })) {
    const file = join(relative, entry.name)
    if (entry.isDirectory()) await verifyUi(file)
    else if (entry.isFile()) {
      const source = await readFile(join('dist', file)), packaged = await readFile(join(directory, 'resources/dist', file))
      assert.equal(createHash('sha256').update(packaged).digest('hex'), createHash('sha256').update(source).digest('hex'))
      verifiedUiFiles++
    }
  }
}
await verifyUi()
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'hasarbotu-package-smoke-')), profile = join(root, 'profile')
await mkdir(profile)
// An isolated real API fixture checks the package without requiring office access or account credentials.
const api = buildApp({ logLevel: 'silent' })
await api.listen({ host: '127.0.0.1', port: 0 })
const apiOrigin = `http://127.0.0.1:${api.server.address().port}`
const env = { ...process.env, HASARBOTU_API_ORIGIN: apiOrigin }
delete env.HASARBOTU_ASSET_ROOT; delete env.HASARBOTU_BRIDGE_PORT
const child = spawn(join(directory, 'HasarBotu.exe'), ['--user-data-dir=' + profile], { env, windowsHide: true, stdio: 'ignore' })
const done = new Promise((finish, reject) => { child.once('exit', finish); child.once('error', reject) })
try {
  const deadline = Date.now() + 30_000
  let startup
  do {
    try { startup = JSON.parse(await readFile(join(profile, 'startup-status.json'), 'utf8')); if (startup.ready) break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(finish => setTimeout(finish, 200))
  } while (Date.now() < deadline)
  assert.equal(startup?.ready, true); assert.equal(startup.version, expectedVersion); assert.equal(startup.apiOrigin, apiOrigin)
  const command = `$ports=@(Get-NetTCPConnection -State Listen -OwningProcess ${child.pid}|Where-Object {$_.LocalAddress -eq '127.0.0.1'}|Select-Object -ExpandProperty LocalPort -Unique);if($ports.Count -ne 1){throw 'PACKAGED_BRIDGE_NOT_UNIQUE'};$ports[0]`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8' })
  const page = await fetch(`http://127.0.0.1:${Number(stdout.trim())}/`)
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('<div id="root">'))
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('apps/desktop/test/harness/close-package-smoke.ps1'), '-ExpectedProcessId', String(child.pid)], { windowsHide: true })
  let timer
  try { assert.equal(await Promise.race([done, new Promise(finish => { timer = setTimeout(() => finish('timeout'), 5000) })]), 0) }
  finally { clearTimeout(timer) }
  console.log(JSON.stringify({ status: 'PASS', version: expectedVersion, verifiedUiFiles, packagedProfileVerified: true,
    actualPackagedStartup: true, bridgeServingPackagedUi: true, normalShutdown: true, isolatedFixture: true, realAccountAcceptance: false }))
} finally {
  if (child.exitCode === null) child.kill()
  await api.close()
}
