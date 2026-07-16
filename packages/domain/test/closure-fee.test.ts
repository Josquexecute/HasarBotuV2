import { describe, expect, it } from 'vitest'
import {
  evaluateClosureFeeSource,
  isApprovedClosureFeeStatus,
  isValidClosureFeeMinor,
} from '../src/index.js'

describe('kapanma ücreti domain kuralları', () => {
  const readySource = {
    caseLifecycleStatus: 'closed' as const,
    documentType: 'expert_report',
    documentStatus: 'ready' as const,
    hashVerified: true,
    sizeVerified: true,
    verifiedAt: '2026-07-16T08:00:00.000Z',
  }

  it('yalnız kapalı case ve doğrulanmış nihai ekspertiz raporunu kabul eder', () => {
    expect(evaluateClosureFeeSource(readySource)).toEqual({
      eligible: true,
      reasonCode: 'eligible',
    })
    expect(evaluateClosureFeeSource({ ...readySource, caseLifecycleStatus: 'open' }))
      .toMatchObject({ eligible: false, reasonCode: 'case_not_closed' })
    expect(evaluateClosureFeeSource({ ...readySource, documentType: 'preliminary_report' }))
      .toMatchObject({ eligible: false, reasonCode: 'final_report_required' })
    expect(evaluateClosureFeeSource({ ...readySource, documentStatus: 'pending' }))
      .toMatchObject({ eligible: false, reasonCode: 'source_not_ready' })
    expect(evaluateClosureFeeSource({ ...readySource, hashVerified: false }))
      .toMatchObject({ eligible: false, reasonCode: 'source_not_verified' })
  })

  it('para değerini güvenli pozitif minor-unit ile sınırlar', () => {
    expect(isValidClosureFeeMinor(485_000)).toBe(true)
    expect(isValidClosureFeeMinor(0)).toBe(false)
    expect(isValidClosureFeeMinor(12.5)).toBe(false)
    expect(isValidClosureFeeMinor(Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it('yalnız onaylı veya düzeltilmiş sürümü kesin ücret sayar', () => {
    expect(isApprovedClosureFeeStatus('control_required')).toBe(false)
    expect(isApprovedClosureFeeStatus('approved')).toBe(true)
    expect(isApprovedClosureFeeStatus('corrected')).toBe(true)
  })
})
