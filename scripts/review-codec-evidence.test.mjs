import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewNativeSbom } from './review-codec-evidence.mjs'

test('native closure exposes unknown licenses and MPL separately from package MIT', () => {
  const result = reviewNativeSbom({ components: [
    { name: 'libwebp', version: '1', licenses: [{ license: { id: 'BSD-3-Clause' } }] },
    { name: 'selectors', version: '2', licenses: [{ expression: 'MPL-2.0' }] },
    { name: 'unclassified', licenses: [] },
  ] })
  assert.deepEqual(result.missingLicenseMetadata.map(c => c.name), ['unclassified'])
  assert.deepEqual(result.mplSourceNoticeRequired.map(c => c.name), ['selectors'])
  assert.deepEqual(result.codecComponents.map(c => c.name), ['libwebp'])
  assert.throws(() => reviewNativeSbom({}), /SBOM/)
})
