import { describe, expect, it } from 'vitest'
import { evaluatePolicyAiPilotQuality } from '../src/index.js'

const thresholds = {
  minimumRecallBps: 8_000,
  minimumPrecisionBps: 8_000,
  minimumSourceAccuracyBps: 10_000,
  minimumEvidenceAccuracyBps: 10_000,
}

describe('Paket 29 AI pilot kalite ölçümü', () => {
  it('alan, kaynak ve metin kanıtını integer basis-point ile ölçer', () => {
    const expected = [
      { canonicalField: 'deductible.conditional', normalizedValue: { percentage: 10 }, sourceAnchorIds: ['page-2'] },
      { canonicalField: 'replacement_vehicle.maximum_days', normalizedValue: 7, sourceAnchorIds: ['page-3'] },
    ]
    const result = evaluatePolicyAiPilotQuality({
      expected,
      actual: [
        { ...expected[0]!, originalValue: '%10' },
        { ...expected[1]!, originalValue: '7 gün' },
      ],
      sources: [
        { sourceAnchorId: 'page-2', text: 'Koşullu muafiyet %10 uygulanır.' },
        { sourceAnchorId: 'page-3', text: 'İkame araç en fazla 7 gün sağlanır.' },
      ],
      thresholds,
    })
    expect(result).toMatchObject({ recallBps: 10_000, precisionBps: 10_000, sourceAccuracyBps: 10_000, evidenceAccuracyBps: 10_000, passed: true, blockers: [] })
  })

  it('uydurma alan ve yanlış anchor için fail-closed blocker üretir', () => {
    const result = evaluatePolicyAiPilotQuality({
      expected: [{ canonicalField: 'part.allowed', normalizedValue: 'original', sourceAnchorIds: ['page-1'] }],
      actual: [
        { canonicalField: 'part.allowed', normalizedValue: 'original', sourceAnchorIds: ['page-2'], originalValue: 'orijinal parça' },
        { canonicalField: 'coverage.imaginary', normalizedValue: true, sourceAnchorIds: ['page-2'], originalValue: 'hayali' },
      ],
      sources: [{ sourceAnchorId: 'page-2', text: 'Hayali ifade; orijinal parça kaynağı değildir.' }],
      thresholds,
    })
    expect(result).toMatchObject({ recallBps: 10_000, precisionBps: 5_000, sourceAccuracyBps: 0, passed: false })
    expect(result.blockers).toEqual(['PILOT_PRECISION_BELOW_THRESHOLD', 'PILOT_SOURCE_ACCURACY_BELOW_THRESHOLD'])
  })

  it('geçersiz eşik ve yinelenen beklentiyi reddeder', () => {
    expect(() => evaluatePolicyAiPilotQuality({ expected: [], actual: [], sources: [], thresholds: { ...thresholds, minimumRecallBps: 10_001 } })).toThrow('invalid_policy_ai_pilot_threshold')
    const duplicate = { canonicalField: 'coverage.collision', normalizedValue: true, sourceAnchorIds: ['page-1'] }
    expect(() => evaluatePolicyAiPilotQuality({ expected: [duplicate, duplicate], actual: [], sources: [], thresholds })).toThrow('duplicate_policy_ai_pilot_expectation')
  })

  it('yinelenen gerçek adayı ikinci doğru eşleşme saymaz', () => {
    const expected = { canonicalField: 'coverage.collision', normalizedValue: 'included', sourceAnchorIds: ['page-1'] }
    const candidate = { ...expected, originalValue: 'çarpışma' }
    const result = evaluatePolicyAiPilotQuality({ expected: [expected], actual: [candidate, candidate], sources: [{ sourceAnchorId: 'page-1', text: 'çarpışma' }], thresholds })
    expect(result).toMatchObject({ matchedCount: 1, unexpectedCount: 1, recallBps: 10_000, precisionBps: 5_000, passed: false })
  })
})
