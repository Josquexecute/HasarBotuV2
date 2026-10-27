import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const file = require.resolve('../apps/desktop/electron-builder.signed.cjs')
const load = () => { delete require.cache[file]; return require(file) }

test('signed configuration preserves distribution settings and rejects unsafe overrides', async () => {
  const saved = { ...process.env }
  try {
    for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_IDENTITY_AUTO_DISCOVERY', 'ELECTRON_BUILDER_OFFLINE', 'HASARBOTU_SIGNING_CERT_SHA1']) delete process.env[key]
    assert.throws(load, /certificate/)
    // An inert test identifier; no certificate is created or used to sign anything.
    process.env.HASARBOTU_SIGNING_CERT_SHA1 = 'a'.repeat(40)
    process.env.HASARBOTU_SIGNING_PUBLISHER = 'CN=TEST ONLY'
    process.env.HASARBOTU_SIGNING_TIMESTAMP_URL = 'https://timestamp.example.invalid'
    const config = load(), base = require('../apps/desktop/package.json').build
    assert.equal(config.forceCodeSigning, true)
    assert.deepEqual(config.extraResources, base.extraResources)
    assert.deepEqual(config.nsis, base.nsis)
    assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, ['sha256'])
    assert.equal(config.directories.output, 'release/signed')
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')
    await validateConfiguration(config, { isEnabled: false })
    process.env.HASARBOTU_SIGNING_TIMESTAMP_URL = 'https://secret@timestamp.example.invalid'
    assert.throws(load, /HTTPS/)
    process.env.HASARBOTU_SIGNING_TIMESTAMP_URL = 'https://timestamp.example.invalid'
    process.env.ELECTRON_BUILDER_OFFLINE = 'true'
    assert.throws(load, /online timestamping/)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    delete require.cache[file]
  }
})

test('Windows preflight fails closed without a selected identity and creates no signature', { skip: process.platform !== 'win32' }, () => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('HASARBOTU_SIGNING_')) delete env[key]
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/check-desktop-signing.ps1'], { env, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 2, result.stderr)
  const report = JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.signaturesCreated, 0)
  assert.equal(report.trustStoreModified, false)
})
