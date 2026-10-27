import assert from 'node:assert/strict'
import test from 'node:test'
import { assertMemoryGrowth } from './soak-memory-budget.mjs'

const mib = value => value * 1048576
test('compares the measured two-lane workload against its matching baseline, never serial cold or idle RSS', () => {
  const warm = { memoryPhase: 'loaded', rss: mib(173), privateBytes: mib(199) }
  const load = { memoryPhase: 'loaded', rss: mib(277), privateBytes: mib(305) }
  assert.equal(assertMemoryGrowth(load, warm, mib(128)), mib(104))
  assert.throws(() => assertMemoryGrowth(load, { memoryPhase: 'serial', rss: mib(147) }, mib(128)), /same workload phase/)
  assert.throws(() => assertMemoryGrowth({ ...load, rss: mib(302) }, warm, mib(128)), /RSS growth/)
})
test('idle private commit cannot evade the unchanged budget through a low resident working set', () => {
  const warm = { memoryPhase: 'idle', rss: mib(100), privateBytes: mib(120), handles: 200 }
  assert.throws(() => assertMemoryGrowth({ ...warm, rss: mib(110), privateBytes: mib(249) }, warm, mib(128)), /private commit/)
  assert.throws(() => assertMemoryGrowth({ ...warm, handles: 265 }, warm, mib(128)), /Handle/)
})
