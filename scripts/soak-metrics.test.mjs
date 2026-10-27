import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeMemory } from './soak-metrics.mjs'

test('distinguishes rising RSS from flat managed heap after warm-up', () => {
  const samples = [0, 1, 2].map(hour => ({ elapsedMs: hour * 3600000, rss: (100 + hour * 10) * 1048576, heapUsed: 5 * 1048576, external: 2 * 1048576 }))
  const result = summarizeMemory(samples)
  assert.equal(result.rssMiBPerHour, 10)
  assert.equal(result.heapMiBPerHour, 0)
  assert.equal(result.externalMiBPerHour, 0)
  assert.equal(result.arrayBuffersMiBPerHour, null)
  assert.equal(result.leakAbsenceProven, false)
})

test('does not invent a slope for insufficient or identical sample times', () => {
  assert.equal(summarizeMemory([]).rssMiBPerHour, null)
  assert.equal(summarizeMemory([{ elapsedMs: 1, rss: 5 }, { elapsedMs: 1, rss: 6 }]).rssMiBPerHour, null)
})
