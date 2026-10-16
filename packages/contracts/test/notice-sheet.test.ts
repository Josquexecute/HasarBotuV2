import { describe, expect, it } from 'vitest'
import { noticeSheetSaveRequestSchema } from '../src/v1/notice-sheet.js'

describe('Notice sheet write contract', () => {
  const input = { expectedVersion: null, overrides: { fields: { insuredName: 'Örnek' }, documents: { statement: true } }, confirmed: true }
  it('accepts partial overrides without turning missing fields into blanks', () => {
    expect(noticeSheetSaveRequestSchema.parse(input).overrides.fields).toEqual({ insuredName: 'Örnek' })
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
