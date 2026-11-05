import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { provisionOfficeNetwork } from '../deploy/windows-service/provision-office-network.mjs'

const script = fileURLToPath(new URL('./write-ci-distribution-profile.mjs', import.meta.url))
let root, profile

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'hb-ci-office-profile-'))
  const openssl = process.env.TEST_OPENSSL_EXE ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
  const provisioned = await provisionOfficeNetwork({ directory: join(root, 'tls'), openssl,
    apiOrigin: 'https://office.example.test', lanHostname: 'OFFICE' })
  profile = provisioned.profile
})

after(async () => {
  if (root) {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    await rm(root, { recursive: true, force: true })
  }
})

async function run(changes = {}) {
  const directory = await mkdtemp(join(root, 'runner-'))
  const environmentFile = join(directory, 'github.env')
  await writeFile(environmentFile, 'EXISTING=preserved\n')
  const env = { ...process.env }
  for (const name of Object.keys(env)) if (name.startsWith('HASARBOTU_OFFICE_')) delete env[name]
  Object.assign(env, { RUNNER_TEMP: directory, GITHUB_ENV: environmentFile,
    HASARBOTU_OFFICE_API_ORIGIN: profile.apiOrigin,
    HASARBOTU_OFFICE_LAN_HOSTNAME: profile.lanHostname,
    HASARBOTU_OFFICE_CA_CERTIFICATE: profile.caCertificate,
    ...changes })
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  return { ...result, directory, environmentFile, profileFile: join(directory, 'hasarbotu-office-connection.json') }
}

async function unchanged(result) {
  assert.notEqual(result.status, 0)
  assert.equal(await readFile(result.environmentFile, 'utf8'), 'EXISTING=preserved\n')
  await assert.rejects(readFile(result.profileFile), { code: 'ENOENT' })
}

test('writes a valid v2 profile and appends its actual path for subsequent GitHub steps', async () => {
  const result = await run({ HASARBOTU_OFFICE_LAN_IPV4: '192.168.1.100' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(result.profileFile, 'utf8')), profile)
  assert.equal(await readFile(result.environmentFile, 'utf8'),
    `EXISTING=preserved\nHASARBOTU_DISTRIBUTION_PROFILE=${result.profileFile}\n`)
  assert.equal(result.stdout.includes(profile.caCertificate), false)
})

test('preserves explicitly configured ports and remote HTTPS origin', async () => {
  const result = await run({ HASARBOTU_OFFICE_HTTPS_PORT: '9443', HASARBOTU_OFFICE_DISCOVERY_PORT: '43111',
    HASARBOTU_OFFICE_REMOTE_ORIGIN: 'https://remote.example.test' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(result.profileFile, 'utf8')),
    { ...profile, httpsPort: 9443, discoveryPort: 43111, remoteOrigin: 'https://remote.example.test' })
})

test('identifies the missing CA when only the former v1 GitHub variables are configured', async () => {
  const result = await run({ HASARBOTU_OFFICE_CA_CERTIFICATE: undefined, HASARBOTU_OFFICE_LAN_IPV4: '192.168.1.100' })
  await unchanged(result)
  assert.match(result.stderr, /Missing GitHub Actions repository variables: HASARBOTU_OFFICE_CA_CERTIFICATE/)
  assert.match(result.stderr, /client-profile\.json/)
})

test('lists all missing required variables together without creating a partial profile', async () => {
  const result = await run({ HASARBOTU_OFFICE_API_ORIGIN: '', HASARBOTU_OFFICE_LAN_HOSTNAME: '  ', HASARBOTU_OFFICE_CA_CERTIFICATE: undefined })
  await unchanged(result)
  for (const name of ['HASARBOTU_OFFICE_API_ORIGIN', 'HASARBOTU_OFFICE_LAN_HOSTNAME', 'HASARBOTU_OFFICE_CA_CERTIFICATE']) {
    assert.ok(result.stderr.includes(name))
  }
})

test('rejects an invalid CA instead of using the former LAN profile or printing its contents', async () => {
  const invalidCa = 'not-a-certificate-private-value'
  const result = await run({ HASARBOTU_OFFICE_CA_CERTIFICATE: invalidCa, HASARBOTU_OFFICE_LAN_IPV4: '192.168.1.100' })
  await unchanged(result)
  assert.equal(result.stderr.includes(invalidCa), false)
})

test('rejects invalid ports and remote URLs before publishing any profile path', async () => {
  for (const changes of [{ HASARBOTU_OFFICE_HTTPS_PORT: '0' }, { HASARBOTU_OFFICE_DISCOVERY_PORT: 'not-a-port' },
    { HASARBOTU_OFFICE_REMOTE_ORIGIN: 'http://remote.example.test' }]) {
    await unchanged(await run(changes))
  }
})

test('requires GitHub runner paths before writing files', async () => {
  const result = await run({ GITHUB_ENV: undefined })
  await unchanged(result)
  assert.match(result.stderr, /GitHub runner configuration is missing/)
})
