export function summarizeMemory(samples) {
  const slope = key => {
    const points = samples.filter(s => Number.isFinite(s[key]) && Number.isFinite(s.elapsedMs))
    if (points.length < 2) return null
    const xs = points.map(s => (s.elapsedMs - points[0].elapsedMs) / 3600000)
    const ys = points.map(s => s[key] / 1048576)
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length
    const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0)
    return variance === 0 ? null : xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) / variance
  }
  return { samples: samples.length, windowMs: samples.length > 1 ? samples.at(-1).elapsedMs - samples[0].elapsedMs : 0,
    rssMiBPerHour: slope('rss'), heapMiBPerHour: slope('heapUsed'), externalMiBPerHour: slope('external'),
    arrayBuffersMiBPerHour: slope('arrayBuffers'), leakAbsenceProven: false }
}
