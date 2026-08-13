import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseArguments, readResolutionManifest, SafeError } from './run-v1-import.mjs'

test('preview varsayilan ve summary-only salt-okunur argumanlarini ayirir', () => {
  assert.deepEqual(parseArguments(['--root', 'X:/sentetik', '--summary-only']), {
    apply: false,
    summaryOnly: true,
    root: 'X:/sentetik',
    actorEmail: null,
    expectedPlanHash: null,
    resolutionFile: null,
  })
})

test('apply actor ve exact plan hash olmadan fail-closed reddedilir', () => {
  assert.throws(() => parseArguments(['--root', 'X:/sentetik', '--apply']), (error) =>
    error instanceof SafeError && error.safeCode === 'ACTOR_EMAIL_REQUIRED_FOR_APPLY')
  assert.throws(() => parseArguments(['--root', 'X:/sentetik', '--apply', '--actor-email', 'actor@test.local']), (error) =>
    error instanceof SafeError && error.safeCode === 'EXPECTED_PLAN_HASH_REQUIRED_FOR_APPLY')
})

test('resolution manifest stable source/name token ve target bicimini zorlar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hb-v1-resolution-test-'))
  try {
    const valid = join(root, 'valid.json')
    await writeFile(valid, JSON.stringify({
      schemaVersion: 'hasarbotu-v1-resolution/1.0.0',
      cases: { ['a'.repeat(64)]: '019f7000-0000-7000-8000-000000000001' },
      claimTypes: { ['b'.repeat(64)]: 'traffic' },
      users: { ['c'.repeat(16)]: '019f7000-0000-7000-8000-000000000002' },
      experts: {},
      services: {},
    }), 'utf8')
    assert.equal((await readResolutionManifest(valid)).schemaVersion, 'hasarbotu-v1-resolution/1.0.0')

    const invalid = join(root, 'invalid.json')
    await writeFile(invalid, JSON.stringify({
      schemaVersion: 'hasarbotu-v1-resolution/1.0.0',
      claimTypes: { rawCustomerPath: 'traffic' },
    }), 'utf8')
    await assert.rejects(readResolutionManifest(invalid), (error) =>
      error instanceof SafeError && error.safeCode === 'RESOLUTION_MANIFEST_INVALID')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
