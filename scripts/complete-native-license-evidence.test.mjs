import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { registryLicenseEvidence } from './complete-native-license-evidence.mjs'

function archive(includeText = true) {
  const files = [['test-1.0.0/Cargo.toml', '[package]\nname="test"\nversion="1.0.0"\nlicense="MIT"\n']]
  if (includeText) files.push(['test-1.0.0/LICENSE', 'Synthetic license text for parser test'])
  return gzipSync(Buffer.concat([...files.flatMap(([name, text]) => {
    const data = Buffer.from(text), header = Buffer.alloc(512)
    header.write(name); header.write(data.length.toString(8).padStart(11, '0'), 124); header[156] = 48
    return [header, data, Buffer.alloc((512 - data.length % 512) % 512)]
  }), Buffer.alloc(1024)]))
}
const component = bytes => ({ name: 'test', version: '1.0.0', 'bom-ref': 'pkg:cargo/test@1.0.0', hashes: [{ alg: 'SHA-256', content: createHash('sha256').update(bytes).digest('hex') }] })

test('license completion rejects checksum drift and declarations without license text', () => {
  const bytes = archive(), c = component(bytes)
  assert.equal(registryLicenseEvidence(c, bytes).licenseExpression, 'MIT')
  assert.throws(() => registryLicenseEvidence(c, Buffer.concat([bytes, Buffer.from('changed')])), /checksum/)
  const noText = archive(false)
  assert.throws(() => registryLicenseEvidence(component(noText), noText), /license text/)
})

test('checked-in supplement is tied to installed SBOM and does not relabel aggregate native binary as MIT', async () => {
  const data = await readFile('node_modules/@napi-rs/canvas-win32-x64-msvc/sbom.cdx.json')
  const supplement = JSON.parse(await readFile('services/file-agent/codec-license-evidence.json', 'utf8'))
  assert.equal(supplement.upstreamSbomSha256, createHash('sha256').update(data).digest('hex'))
  assert.equal(supplement.resolutions.length, 6)
  assert.equal(supplement.classifiedEntries.length, 3)
  assert.equal(supplement.classifiedEntries.find(c => c.status === 'AGGREGATE_BINARY_IDENTIFIED').licenseExpression, undefined)
  assert.equal(supplement.upstreamSbomModified, false)
  assert.equal(supplement.legalClearanceClaimed, false)
})
