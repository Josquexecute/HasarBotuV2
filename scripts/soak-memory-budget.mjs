import assert from 'node:assert/strict'

export function assertMemoryGrowth(sample, baseline, maxGrowth) {
  assert.ok(baseline && sample.memoryPhase === baseline.memoryPhase, 'Memory growth must compare the same workload phase')
  const rssGrowth = sample.rss - baseline.rss
  assert.ok(rssGrowth <= maxGrowth, 'Post-warm RSS growth budget exceeded')
  // Idle private commit catches retained allocations even when Windows evicts resident pages.
  if (sample.memoryPhase === 'idle' && baseline.privateBytes !== undefined && sample.privateBytes !== undefined) {
    assert.ok(sample.privateBytes - baseline.privateBytes <= maxGrowth, 'Post-warm idle private commit growth budget exceeded')
  }
  if (baseline.handles !== undefined && sample.handles !== undefined) assert.ok(sample.handles - baseline.handles <= 64, 'Handle growth budget exceeded')
  return rssGrowth
}
