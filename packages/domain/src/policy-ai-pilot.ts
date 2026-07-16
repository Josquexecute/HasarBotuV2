export const POLICY_AI_PILOT_QUALITY_VERSION = 'policy-ai-pilot-quality/1.0.0' as const

export interface PolicyAiPilotSource {
  readonly sourceAnchorId: string
  readonly text: string
}

export interface PolicyAiPilotExpectedCandidate {
  readonly canonicalField: string
  readonly normalizedValue: unknown
  readonly sourceAnchorIds: readonly string[]
}

export interface PolicyAiPilotActualCandidate extends PolicyAiPilotExpectedCandidate {
  readonly originalValue: string
}

export interface PolicyAiPilotQualityThresholds {
  readonly minimumRecallBps: number
  readonly minimumPrecisionBps: number
  readonly minimumSourceAccuracyBps: number
  readonly minimumEvidenceAccuracyBps: number
}

export interface PolicyAiPilotQualityResult {
  readonly version: typeof POLICY_AI_PILOT_QUALITY_VERSION
  readonly expectedCount: number
  readonly actualCount: number
  readonly matchedCount: number
  readonly unexpectedCount: number
  readonly exactSourceCount: number
  readonly groundedEvidenceCount: number
  readonly recallBps: number
  readonly precisionBps: number
  readonly sourceAccuracyBps: number
  readonly evidenceAccuracyBps: number
  readonly passed: boolean
  readonly blockers: readonly string[]
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

function candidateIdentity(candidate: PolicyAiPilotExpectedCandidate): string {
  return `${candidate.canonicalField}|${canonical(candidate.normalizedValue)}`
}

function bps(numerator: number, denominator: number): number {
  return denominator === 0 ? 10_000 : Math.floor((numerator * 10_000) / denominator)
}

function assertBps(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error('invalid_policy_ai_pilot_threshold')
}

function sameAnchors(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort(), sortedRight = [...right].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((anchor, index) => anchor === sortedRight[index])
}

export function evaluatePolicyAiPilotQuality(input: {
  readonly expected: readonly PolicyAiPilotExpectedCandidate[]
  readonly actual: readonly PolicyAiPilotActualCandidate[]
  readonly sources: readonly PolicyAiPilotSource[]
  readonly thresholds: PolicyAiPilotQualityThresholds
}): PolicyAiPilotQualityResult {
  Object.values(input.thresholds).forEach(assertBps)
  const expectedByIdentity = new Map<string, PolicyAiPilotExpectedCandidate>()
  for (const expected of input.expected) {
    const identity = candidateIdentity(expected)
    if (expectedByIdentity.has(identity)) throw new Error('duplicate_policy_ai_pilot_expectation')
    expectedByIdentity.set(identity, expected)
  }
  const sources = new Map(input.sources.map((source) => [source.sourceAnchorId, source.text.toLocaleLowerCase('tr-TR')]))
  const seen = new Set<string>(), matched: PolicyAiPilotActualCandidate[] = []
  let unexpectedCount = 0
  for (const candidate of input.actual) {
    const identity = candidateIdentity(candidate)
    if (!expectedByIdentity.has(identity) || seen.has(identity)) unexpectedCount += 1
    else { seen.add(identity);matched.push(candidate) }
  }
  const exactSourceCount = matched.filter((candidate) => sameAnchors(
    candidate.sourceAnchorIds,
    expectedByIdentity.get(candidateIdentity(candidate))?.sourceAnchorIds ?? [],
  )).length
  const groundedEvidenceCount = matched.filter((candidate) => {
    const value = candidate.originalValue.trim().toLocaleLowerCase('tr-TR')
    return value.length > 0 && candidate.sourceAnchorIds.some((anchor) => sources.get(anchor)?.includes(value) === true)
  }).length
  const recallBps = bps(matched.length, input.expected.length)
  const precisionBps = bps(matched.length, input.actual.length)
  const sourceAccuracyBps = bps(exactSourceCount, matched.length)
  const evidenceAccuracyBps = bps(groundedEvidenceCount, matched.length)
  const blockers = [
    recallBps < input.thresholds.minimumRecallBps ? 'PILOT_RECALL_BELOW_THRESHOLD' : null,
    precisionBps < input.thresholds.minimumPrecisionBps ? 'PILOT_PRECISION_BELOW_THRESHOLD' : null,
    sourceAccuracyBps < input.thresholds.minimumSourceAccuracyBps ? 'PILOT_SOURCE_ACCURACY_BELOW_THRESHOLD' : null,
    evidenceAccuracyBps < input.thresholds.minimumEvidenceAccuracyBps ? 'PILOT_EVIDENCE_ACCURACY_BELOW_THRESHOLD' : null,
  ].filter((value): value is string => value !== null)
  return {
    version: POLICY_AI_PILOT_QUALITY_VERSION,
    expectedCount: input.expected.length,
    actualCount: input.actual.length,
    matchedCount: matched.length,
    unexpectedCount,
    exactSourceCount,
    groundedEvidenceCount,
    recallBps,
    precisionBps,
    sourceAccuracyBps,
    evidenceAccuracyBps,
    passed: blockers.length === 0,
    blockers,
  }
}
