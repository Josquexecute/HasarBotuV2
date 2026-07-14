import { describe, expect, it } from 'vitest'
import {
  CASE_STAGES,
  CASE_STATUSES,
  isCaseStage,
  isCaseStatus,
  parseCaseStage,
  parseCaseStatus,
  type CaseStage,
  type CaseStatus,
} from '../src/index.js'

describe('CaseStatus', () => {
  it('yaşam döngüsünü open ve closed ile sınırlar', () => {
    expect(CASE_STATUSES).toEqual(['open', 'closed'])
  })

  it.each(CASE_STATUSES)('%s durumunu kabul eder', (value) => {
    expect(parseCaseStatus(value)).toEqual({ ok: true, value })
  })

  it('type guard yaşam döngüsü kodunu sunum durumundan ayırır', () => {
    expect(isCaseStatus('open')).toBe(true)
    expect(isCaseStatus('review_pending')).toBe(false)
  })

  it.each(['waiting', 'overdue', 'review_pending'])('%s sunum durumunu reddeder', (value) => {
    expect(parseCaseStatus(value)).toEqual({
      ok: false,
      error: { code: 'unsupported_value', field: 'caseStatus' },
    })
  })
})

describe('CaseStage', () => {
  it('ürün belgelerindeki on aşamayı aynı sırada taşır', () => {
    expect(CASE_STAGES).toEqual([
      'new_notification',
      'vehicle_or_service_pending',
      'inspection_pending',
      'damage_assessment',
      'parts_and_labor',
      'repair_approval_pending',
      'under_repair',
      'reporting',
      'closing_documents',
      'ready_to_close',
      'closed',
    ])
  })

  it.each(CASE_STAGES)('%s aşamasını kabul eder', (value) => {
    expect(parseCaseStage(value)).toEqual({ ok: true, value })
  })

  it('type guard yalnız kanonik aşamayı tanır', () => {
    expect(isCaseStage('reporting')).toBe(true)
    expect(isCaseStage('Raporlama')).toBe(false)
  })

  it('bilinmeyen aşamayı reddeder', () => {
    expect(parseCaseStage('archived')).toEqual({
      ok: false,
      error: { code: 'unsupported_value', field: 'caseStage' },
    })
  })
})

function assertStatusStageSeparation(): void {
  const status = 'open' as CaseStatus
  const stage = 'reporting' as CaseStage
  // @ts-expect-error Durum ve operasyon aşaması ayrı kavramlardır.
  const invalidStage: CaseStage = status
  // @ts-expect-error Operasyon aşaması yaşam döngüsü durumu değildir.
  const invalidStatus: CaseStatus = stage
  void invalidStage
  void invalidStatus
}

void assertStatusStageSeparation
