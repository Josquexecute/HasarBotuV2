import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  canonicalizeValueLossJson,
  computeCanonicalSnapshotHash,
  verifySnapshotIdentity,
} from './verify-value-loss-reference-data-identity.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./verify-value-loss-reference-data-identity.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REAL_SNAPSHOT_PATH = path.join(
  REPO_ROOT, 'reference-data', 'value-loss', 'real-market-analysis', '2026-07-01', '1.0.0', 'snapshot.json',
)
const REAL_EXPECTED_IDENTITY = 'real-market-analysis/2026-07-01/1.0.0'
const REAL_EXPECTED_HASH = 'e4fc8087ddbc1ff92e3255546e053c6956e20bd1dca269533113b727f728b940'

test('canonicalizeValueLossJson: nesne anahtarlarini alfabetik siralar', () => {
  const canonical = canonicalizeValueLossJson({ b: 1, a: 2 })
  assert.equal(canonical, '{"a":2,"b":1}')
})

test('canonicalizeValueLossJson: ic ice nesne/dizi/primitifleri dogru serilestirir', () => {
  const canonical = canonicalizeValueLossJson({
    z: [1, 'x', null, true],
    a: { nested: { c: 1, b: 2 } },
  })
  assert.equal(canonical, '{"a":{"nested":{"b":2,"c":1}},"z":[1,"x",null,true]}')
})

test('canonicalizeValueLossJson: anahtar sirasi girdi sirasindan BAGIMSIZDIR (deterministik)', () => {
  const a = canonicalizeValueLossJson({ x: 1, y: 2, z: 3 })
  const b = canonicalizeValueLossJson({ z: 3, y: 2, x: 1 })
  assert.equal(a, b)
})

test('verifySnapshotIdentity: gecersiz JSON icin SNAPSHOT_JSON_INVALID doner', () => {
  const result = verifySnapshotIdentity('{ not valid json')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SNAPSHOT_JSON_INVALID')
})

test('verifySnapshotIdentity: identity alani eksikse SNAPSHOT_IDENTITY_FIELD_MISSING doner', () => {
  const result = verifySnapshotIdentity(JSON.stringify({ foo: 'bar' }))
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SNAPSHOT_IDENTITY_FIELD_MISSING')
})

test('verifySnapshotIdentity: yanlis identity degeri SNAPSHOT_IDENTITY_MISMATCH doner', () => {
  const result = verifySnapshotIdentity(JSON.stringify({ identity: 'wrong/1.0.0', foo: 'bar' }))
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SNAPSHOT_IDENTITY_MISMATCH')
  assert.equal(result.actualIdentity, 'wrong/1.0.0')
})

test('verifySnapshotIdentity: dogru identity ama tahrif edilmis icerik SNAPSHOT_HASH_MISMATCH doner', () => {
  const result = verifySnapshotIdentity(JSON.stringify({ identity: REAL_EXPECTED_IDENTITY, tampered: true }))
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SNAPSHOT_HASH_MISMATCH')
  assert.notEqual(result.computedHash, REAL_EXPECTED_HASH)
})

test('verifySnapshotIdentity: GERCEK diskteki snapshot.json dogru identity+hash ile GECER (domain paketinin sabitine pinlenmis)', async () => {
  const snapshotText = await readFile(REAL_SNAPSHOT_PATH, 'utf8')
  const result = verifySnapshotIdentity(snapshotText)
  assert.equal(result.ok, true)
  assert.equal(result.identity, REAL_EXPECTED_IDENTITY)
  assert.equal(result.hash, REAL_EXPECTED_HASH)
})

test('computeCanonicalSnapshotHash: en ust seviye anahtar EKLEME sirasi degistirilmis ama icerik AYNI nesne icin AYNI hash uretir', async () => {
  const snapshotText = await readFile(REAL_SNAPSHOT_PATH, 'utf8')
  const parsed = JSON.parse(snapshotText)
  const reordered = Object.fromEntries(Object.entries(parsed).reverse())
  assert.notEqual(JSON.stringify(parsed), JSON.stringify(reordered))
  const hashOriginalOrder = computeCanonicalSnapshotHash(parsed)
  const hashReorderedTopLevel = computeCanonicalSnapshotHash(reordered)
  assert.equal(hashOriginalOrder, hashReorderedTopLevel)
  assert.equal(hashOriginalOrder, REAL_EXPECTED_HASH)
})

test('CLI: gercek snapshot.json icin exit 0 ve Status ok doner', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--snapshot-path', REAL_SNAPSHOT_PATH], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  const json = JSON.parse(result.stdout.trim())
  assert.equal(json.Status, 'ok')
  assert.equal(json.Hash, REAL_EXPECTED_HASH)
})

test('CLI: olmayan dosya icin SNAPSHOT_FILE_NOT_FOUND ile exit 1 doner', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--snapshot-path', path.join(REPO_ROOT, 'does-not-exist.json')], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const json = JSON.parse(result.stdout.trim())
  assert.equal(json.Status, 'error')
  assert.equal(json.ErrorCode, 'SNAPSHOT_FILE_NOT_FOUND')
})

test('CLI: --snapshot-path eksikse exit 1 doner', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' })
  assert.equal(result.status, 1)
})
