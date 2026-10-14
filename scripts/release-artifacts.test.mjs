import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDraftUpdate } from './release-artifacts.mjs'
const input = { version: '0.1.16', sourceSha: 'a'.repeat(40) }
test('new or unpublished matching drafts can be prepared', () => {
  assert.equal(validateDraftUpdate(undefined, input), 'v0.1.16')
  assert.equal(validateDraftUpdate({ tag_name: 'v0.1.16', draft: true, prerelease: false }, input), 'v0.1.16')
})
test('published versions, unrelated tags and missing test provenance are refused', () => {
  assert.throws(() => validateDraftUpdate({ tag_name: 'v0.1.16', draft: false }, input))
  assert.throws(() => validateDraftUpdate({ tag_name: 'v0.1.15', draft: true }, input))
  assert.throws(() => validateDraftUpdate({ tag_name: 'v0.1.16', draft: true, prerelease: true }, input))
  assert.throws(() => validateDraftUpdate(undefined, { ...input, sourceSha: 'main' }))
})
