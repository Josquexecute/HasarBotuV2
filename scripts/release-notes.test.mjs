import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareReleaseVersions, mergeReleaseNotes, parseReleaseVersion, renderReleaseNotes } from './release-notes.mjs'
const sha = 'a'.repeat(40), options = { version: '0.1.16', sourceSha: sha, runUrl: 'https://github.com/example/source/actions/runs/123', testSummary: { status: 'PASS', passed: 42, skipped: 8 } }
test('strict versions reject unsafe tags and compare numeric components', () => {
  assert.equal(parseReleaseVersion('v0.1.16'), '0.1.16')
  assert.equal(compareReleaseVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareReleaseVersions('0.1.16', 'v0.1.16'), 0)
  for (const value of ['v01.1.1', '1.2', 'v1.2.3-beta', '1.2.3; command', '--all']) assert.throws(() => parseReleaseVersion(value))
})
test('direct commits generate categorized notes without requiring pull requests', () => {
  const notes = renderReleaseNotes([{ sha, subject: 'feat(tracking): Yeni klasörleri otomatik ekle' }, { sha, subject: 'fix: Dikey fare takibini düzelt' }, { sha, subject: 'Kurulum otomasyonu' }], options)
  assert.ok(notes.includes('Yeni özellikler')); assert.ok(notes.includes('- Yeni klasörleri otomatik ekle'))
  assert.ok(notes.includes('Düzeltmeler')); assert.ok(notes.includes('Kurulum otomasyonu'))
  assert.ok(notes.includes('hasarbotu-source:' + sha)); assert.ok(notes.includes(options.runUrl))
  assert.ok(!notes.includes('feat(tracking):'))
  assert.ok(notes.includes('42 test geçti; 8 test atlandı'))
})
test('regenerating a draft preserves the user text outside the generated section', () => {
  const original = 'Ofise duyuru\n\n' + mergeReleaseNotes('', 'old') + '\n\nKendi açıklamam'
  const updated = mergeReleaseNotes(original, 'new')
  assert.ok(updated.startsWith('Ofise duyuru')); assert.ok(updated.endsWith('Kendi açıklamam'))
  assert.ok(!updated.includes('old')); assert.equal(mergeReleaseNotes(updated, 'new'), updated)
  assert.ok(mergeReleaseNotes('El ile yazılmış not', 'new').startsWith('El ile yazılmış not'))
})
test('damaged markers and invalid validation provenance fail before publication', () => {
  assert.throws(() => mergeReleaseNotes('<!-- hasarbotu-generated:start -->', 'new'))
  assert.throws(() => mergeReleaseNotes('<!-- hasarbotu-generated:end --><!-- hasarbotu-generated:start -->', 'new'))
  assert.throws(() => renderReleaseNotes([], { ...options, runUrl: 'https://attacker.example/run' }))
  assert.throws(() => renderReleaseNotes([{ sha: 'HEAD', subject: 'bad' }], options))
  assert.throws(() => renderReleaseNotes([], { ...options, testSummary: undefined }))
})
test('broken Turkish summaries, commit titles and existing notes cannot enter a draft', () => {
  const broken = 'Kapan\u00c4\u00b1\u00c5\u0178'
  assert.throws(() => renderReleaseNotes([], { ...options, summary: broken }), /garbled text/)
  assert.throws(() => renderReleaseNotes([{ sha, subject: 'fix: ' + broken }], options), /garbled text/)
  assert.throws(() => mergeReleaseNotes(broken, 'Kapanış'), /garbled text/)
})
