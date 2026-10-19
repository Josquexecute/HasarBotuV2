import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { assertReadableText, decodeUtf8Text } from './text-encoding.mjs'

const text = 'Dosya aşamaları: ÇĞİÖŞÜ çğıöşü. Kapanış, gerçek taşıma, Ağır Hasar/Pert. Âmâ, Åland, Änne, «evrak», € — ✓'
test('UTF-8 release notes retain Turkish letters and punctuation exactly, with or without BOM', () => {
  assert.equal(decodeUtf8Text(Buffer.from(text)), text)
  assert.equal(decodeUtf8Text(Buffer.from('\uFEFF' + text)), text)
  assert.equal(assertReadableText(text), text)
})
test('invalid bytes and Windows-decoded UTF-8 are rejected instead of published or guessed', () => {
  for (const bytes of [Buffer.from([0xe7, 0xfd, 0xf0]), Buffer.from(text, 'utf16le'), Buffer.from([0xef, 0xbb, 0xbf, 0xff])]) assert.throws(() => decodeUtf8Text(bytes))
  for (const broken of [Buffer.from(text).toString('latin1'), '\u00c3\u00a7', '\u00c4\u00b1', '\u00c4\u0178', '\u00c5\u0178', '\u00c3\u00bc', '\u00e2\u20ac\u201d', '\ufffd']) {
    assert.throws(() => assertReadableText(broken), /garbled text/)
  }
})
test('all owned application text is UTF-8 and Windows script literals remain readable', () => {
  assert.equal(JSON.parse(execFileSync(process.execPath, ['scripts/check-text-encoding.mjs'], { encoding: 'utf8' })).status, 'PASS')
})
