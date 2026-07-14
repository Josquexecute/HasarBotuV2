import { describe, expect, it } from 'vitest'
import {
  createOfficeCaseNumber,
  parseCaseId,
  parseEntityVersion,
  parseInsurerClaimNumber,
  parseInsurerId,
  parseLocalDate,
  parseNotificationFormNumber,
  parsePlateNumber,
  parseServiceId,
  parseUserId,
  parseUtcDateTime,
  type CaseCore,
  type ParseResult,
} from '../src/index.js'

function unwrap<Value>(result: ParseResult<Value>): Value {
  if (!result.ok) throw new Error(`Test fixture failed: ${result.error.code}`)
  return result.value
}

const requiredCase: CaseCore = {
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

describe('CaseCore', () => {
  it('zorunlu alanlarla framework bağımsız vaka çekirdeği kurar', () => {
    expect(requiredCase).toMatchObject({
      caseType: 'casco',
      status: 'open',
      stage: 'inspection_pending',
      officeCaseNumber: { year: 2026, sequence: 184 },
    })
  })

  it('doğrulanmış isteğe bağlı iş kimliklerini ve tarihleri taşır', () => {
    const completeCase: CaseCore = {
      ...requiredCase,
      notificationFormNumber: unwrap(parseNotificationFormNumber('F-2026-0988')),
      insurerClaimNumber: unwrap(parseInsurerClaimNumber('HSR-992-881')),
      responsibleUserId: unwrap(parseUserId('usr-2')),
      expertUserId: unwrap(parseUserId('usr-expert')),
      insurerId: unwrap(parseInsurerId('insurer-1')),
      serviceId: unwrap(parseServiceId('service-1')),
      followUpDate: unwrap(parseLocalDate('2026-07-14')),
      lossDate: unwrap(parseLocalDate('2026-07-10')),
      notificationDate: unwrap(parseLocalDate('2026-07-11')),
      lastInterventionAt: unwrap(parseUtcDateTime('2026-07-11T09:15:00Z')),
    }

    expect(completeCase.followUpDate).toBe('2026-07-14')
    expect(completeCase.responsibleUserId).toBe('usr-2')
    expect(completeCase.expertUserId).toBe('usr-expert')
    expect(completeCase.lossDate).toBe('2026-07-10')
  })

  it('sunum alanlarını çalışma zamanı nesnesine eklemez', () => {
    expect(requiredCase).not.toHaveProperty('followUpTone')
    expect(requiredCase).not.toHaveProperty('statusPill')
    expect(requiredCase).not.toHaveProperty('lastActionLabel')
  })
})

function assertCaseCoreBoundary(): void {
  // @ts-expect-error exactOptionalPropertyTypes, açık undefined atamasını engeller.
  const explicitUndefined: CaseCore = { ...requiredCase, serviceId: undefined }
  // @ts-expect-error Domain sınırında null kullanılmaz.
  const nullableService: CaseCore = { ...requiredCase, serviceId: null }
  // @ts-expect-error UI'ya özgü takip tonu CaseCore alanı değildir.
  const presentationTone = requiredCase.followUpTone
  // @ts-expect-error CaseCore değişmezdir.
  requiredCase.status = 'closed'
  // @ts-expect-error followUpAt alanı kaldırıldı; takip yalnız followUpDate (LocalDate) taşır.
  const legacyFollowUpAt = requiredCase.followUpAt
  // @ts-expect-error followUpDate LocalDate ister; UtcDateTime brand'i atanamaz.
  const wrongFollowUp: CaseCore = { ...requiredCase, followUpDate: unwrap(parseUtcDateTime('2026-07-11T11:30:00Z')) }
  void explicitUndefined
  void nullableService
  void presentationTone
  void legacyFollowUpAt
  void wrongFollowUp
}

void assertCaseCoreBoundary
