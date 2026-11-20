import { describe, expect, it } from 'vitest'
import { isNoticeSheetFieldVisible, noticeSheetDocxParamsSchema, noticeSheetSaveRequestSchema } from '../src/v1/notice-sheet.js'

describe('Notice sheet write contract', () => {
  const input = { expectedVersion: null, overrides: { fields: { insuredName: 'Örnek' }, documents: { statement: true } }, confirmed: true }
  it('accepts partial overrides without turning missing fields into blanks', () => {
    expect(noticeSheetSaveRequestSchema.parse(input).overrides.fields).toEqual({ insuredName: 'Örnek' })
  })
  it('validates native Word download IDs before they reach UUID-backed storage', () => {
    expect(noticeSheetDocxParamsSchema.safeParse({ caseId: '019aa78c-7f00-7000-8000-000000000001' }).success).toBe(true)
    expect(noticeSheetDocxParamsSchema.safeParse({ caseId: 'not-a-case-id' }).success).toBe(false)
    expect(noticeSheetDocxParamsSchema.safeParse({ caseId: '../private' }).success).toBe(false)
  })
  it('keeps retired form fields and document flags writable for older clients', () => {
    const fields = { iban: 'TR00000000000000000000000000', missingDocuments: 'Eski eksik notu', insuredMileage: '125000', insuredHeavyDamage: 'Yok', insuredPreviousClaims: '2', victimName: 'Eski karşı taraf' }
    const documents = { statement: true, insuredLicense: false, victimRegistration: true }
    expect(noticeSheetSaveRequestSchema.parse({ ...input, overrides: { fields, documents } }).overrides).toEqual({ fields, documents })
    expect(isNoticeSheetFieldVisible('traffic', 'insuredMileage')).toBe(false)
    expect(isNoticeSheetFieldVisible('casco', 'insuredMileage')).toBe(true)
  })
  it.each([
    { ...input, confirmed: false }, { ...input, expectedVersion: 0 },
    { ...input, overrides: { fields: { unknownField: 'x' }, documents: {} } },
    { ...input, overrides: { fields: { inspectionDate: '2026-02-30' }, documents: {} } },
    { ...input, overrides: { fields: { servicePhone: 'x'.repeat(81) }, documents: {} } },
    { ...input, overrides: { fields: {}, documents: { unknownDocument: true } } },
  ])('rejects invalid or unconfirmed edits %#', value => {
    expect(noticeSheetSaveRequestSchema.safeParse(value).success).toBe(false)
  })
})
