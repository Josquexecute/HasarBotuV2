import { describe, expect, it } from 'vitest'
import {
  parseAuditEventId,
  parseCaseId,
  parseDocumentId,
  parseFeeRecordId,
  parseInsurerId,
  parseLegislationSourceId,
  parseNoteId,
  parsePhotoId,
  parseRoleId,
  parseServiceId,
  parseTaskId,
  parseUserId,
  type CaseId,
  type ParseResult,
  type UserId,
} from '../src/index.js'

type IdParser = (value: unknown) => ParseResult<string>

const parsers = [
  ['caseId', parseCaseId],
  ['userId', parseUserId],
  ['roleId', parseRoleId],
  ['serviceId', parseServiceId],
  ['insurerId', parseInsurerId],
  ['documentId', parseDocumentId],
  ['photoId', parsePhotoId],
  ['noteId', parseNoteId],
  ['taskId', parseTaskId],
  ['auditEventId', parseAuditEventId],
  ['legislationSourceId', parseLegislationSourceId],
  ['feeRecordId', parseFeeRecordId],
] as const satisfies readonly (readonly [string, IdParser])[]

describe.each(parsers)('%s parser', (field, parse) => {
  it('değeri kırpar ve kabul eder', () => {
    expect(parse('  sample-1  ')).toEqual({ ok: true, value: 'sample-1' })
  })

  it('boş değeri kararlı kodla reddeder', () => {
    expect(parse('  ')).toEqual({ ok: false, error: { code: 'required', field } })
  })

  it('string olmayan değeri reddeder', () => {
    expect(parse(42)).toEqual({ ok: false, error: { code: 'invalid_type', field } })
  })
})

it('hata sonucuna ham girdi veya mesaj eklemez', () => {
  const result = parseCaseId('\t  ')
  expect(result).toEqual({ ok: false, error: { code: 'required', field: 'caseId' } })
  expect(JSON.stringify(result)).not.toContain('message')
  expect(JSON.stringify(result)).not.toContain('input')
})

function assertIdBrandSeparation(): void {
  const caseId = '' as CaseId
  const userId = '' as UserId
  // @ts-expect-error Farklı nominal kimlikler birbirine atanamaz.
  const invalidUserId: UserId = caseId
  // @ts-expect-error Ters yönde de nominal ayrım korunur.
  const invalidCaseId: CaseId = userId
  void invalidUserId
  void invalidCaseId
}

void assertIdBrandSeparation
