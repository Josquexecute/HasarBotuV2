import { describe, expect, it } from 'vitest'
import {
  createOfficeCaseNumber,
  parseCaseId,
  parseEntityVersion,
  parseInsurerClaimNumber,
  parseInsurerId,
  parseNotificationFormNumber,
  parsePlateNumber,
  parseServiceId,
  parseUserId,
  parseUtcDateTime,
  type CaseCore,
  type ParseResult,
} from '@hasarbotu/domain'
import {
  caseCoreToDetail,
  caseCoreToListItem,
  caseDetailToCaseCore,
  caseListItemSchema,
} from '../src/index.js'

function unwrap<Value>(result: ParseResult<Value>): Value {
  if (!result.ok) throw new Error(`Test fixture failed: ${result.error.code}`)
  return result.value
}

const minimalCase: CaseCore = {
  id: unwrap(parseCaseId('case-2026-184')),
  officeCaseNumber: unwrap(createOfficeCaseNumber(2026, 184)),
  plate: unwrap(parsePlateNumber('34 MPA 764')),
  caseType: 'casco',
  status: 'open',
  stage: 'inspection_pending',
  createdAt: unwrap(parseUtcDateTime('2026-07-11T08:00:00Z')),
  updatedAt: unwrap(parseUtcDateTime('2026-07-11T09:00:00Z')),
  version: unwrap(parseEntityVersion(1)),
}

const fullCase: CaseCore = {
  ...minimalCase,
  notificationFormNumber: unwrap(parseNotificationFormNumber('F-2026-0988')),
  insurerClaimNumber: unwrap(parseInsurerClaimNumber('HSR-992-881')),
  responsibleUserId: unwrap(parseUserId('usr-2')),
  insurerId: unwrap(parseInsurerId('insurer-1')),
  serviceId: unwrap(parseServiceId('service-1')),
  followUpAt: unwrap(parseUtcDateTime('2026-07-11T11:30:00Z')),
  lastInterventionAt: unwrap(parseUtcDateTime('2026-07-11T09:15:00Z')),
}

describe('Cases domain <-> DTO mapper', () => {
  it('domain undefined iliskileri wire null olarak eslestirir', () => {
    const dto = caseCoreToListItem(minimalCase)
    expect(dto.officeCaseNumber).toBe('2026/184')
    expect(dto.serviceId).toBeNull()
    expect(dto.followUpDate).toBeNull()
    expect(dto.notificationFormNumber).toBeNull()
    // Uretilen DTO kendi semasini gecer.
    expect(caseListItemSchema.safeParse(dto).success).toBe(true)
  })

  it('domain followUpAt alanini wire followUpDate olarak tasir', () => {
    const dto = caseCoreToDetail(fullCase)
    expect(dto.followUpDate).toBe('2026-07-11T11:30:00Z')
    expect('followUpAt' in dto).toBe(false)
  })

  it('tam vaka round-trip domain degerini yeniden uretir', () => {
    const dto = caseCoreToDetail(fullCase)
    const back = caseDetailToCaseCore(dto)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.value).toEqual(fullCase)
  })

  it('minimal vaka round-trip null iliskileri undefined olarak geri cevirir', () => {
    const dto = caseCoreToDetail(minimalCase)
    const back = caseDetailToCaseCore(dto)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.value).toEqual(minimalCase)
    expect('followUpAt' in back.value).toBe(false)
    expect('serviceId' in back.value).toBe(false)
  })

  it('gecersiz DTO icin reverse mapper guvenli ParseResult hatasi doner', () => {
    const dto = { ...caseCoreToDetail(minimalCase), officeCaseNumber: '2026-184' }
    const back = caseDetailToCaseCore(dto)
    expect(back.ok).toBe(false)
  })
})
