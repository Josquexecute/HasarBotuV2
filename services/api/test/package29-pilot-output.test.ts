import { describe, expect, it } from 'vitest'
import { parsePackage29PilotOutput } from '../test-support/package29-pilot-output.js'

const anchorId = 'a'.repeat(64)
const candidate = {
  candidateId: 'coverage-collision',
  category: 'coverage',
  canonicalField: 'coverage.collision',
  normalizedValue: 'included',
  originalValue: 'Çarpma ve çarpışma teminatı dahildir.',
  conditions: [],
  exceptions: [],
  sourceAnchorIds: [anchorId],
  providerConfidence: 0.9,
}

describe('Paket 29 canlı pilot canonical output sınırı', () => {
  it('geçerli provider çıktısını canonical sözleşmeyle kabul eder', () => {
    expect(parsePackage29PilotOutput({
      schemaVersion: 'policy-ai-candidates/1.0.0',
      candidates: [candidate],
    })).toMatchObject({ success: true, data: { candidates: [candidate] } })
  })

  it('schema ve kategori uyuşmazlığını değer sızdırmadan alan koduyla gösterir', () => {
    const result = parsePackage29PilotOutput({
      schemaVersion: 'raw-secret-wrong-version',
      candidates: [{ ...candidate, category: 'raw-secret-category' }],
    })
    expect(result).toMatchObject({ success: false })
    if (result.success) throw new Error('invalid test state')
    expect(result.safeErrorCode).toContain('SCHEMAVERSION_INVALID_VALUE')
    expect(result.safeErrorCode).toContain('CANDIDATES_ITEM_CATEGORY_INVALID_VALUE')
    expect(result.safeErrorCode).not.toContain('raw-secret')
  })

  it('anchor biçimi ve unknown alanı ham veri olmadan fail-closed raporlar', () => {
    const result = parsePackage29PilotOutput({
      schemaVersion: 'policy-ai-candidates/1.0.0',
      candidates: [{ ...candidate, sourceAnchorIds: ['raw-secret-anchor'], rawSecretField: 'raw-secret-value' }],
    })
    expect(result).toMatchObject({ success: false })
    if (result.success) throw new Error('invalid test state')
    expect(result.safeErrorCode).toMatch(/CANDIDATES_ITEM_SOURCEANCHORIDS_ITEM_INVALID_FORMAT|CANDIDATES_ITEM_UNRECOGNIZED_KEYS/)
    expect(result.safeErrorCode).not.toContain('raw-secret')
  })
})
