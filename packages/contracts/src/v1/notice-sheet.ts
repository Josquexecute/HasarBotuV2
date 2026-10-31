import { z } from 'zod'
import { NOTICE_SHEET_FIELD_LIMITS, NOTICE_SHEET_DOCUMENT_CODES, type NoticeSheetField, type NoticeSheetDocument } from '@hasarbotu/domain'
import { caseIdSchema, entityVersionSchema, localDateSchema, utcDateTimeSchema } from '../common/primitives.js'

export const NOTICE_SHEET_ROUTE = '/api/v1/cases/:caseId/notice-sheet' as const
export const noticeSheetParamsSchema = z.strictObject({ caseId: caseIdSchema })

const fieldShapes = Object.fromEntries(Object.entries(NOTICE_SHEET_FIELD_LIMITS).map(([key, limit]) => [
  key, z.string().trim().max(limit).refine(value =>
    !['inspectionDate', 'preliminaryReportDate', 'notificationDate', 'lossDate', 'closureDate', 'insuredRegistrationDate', 'victimRegistrationDate'].includes(key) || value === '' || localDateSchema.safeParse(value).success,
  { message: 'invalid_local_date' }),
])) as Record<NoticeSheetField, z.ZodString>
const documentShapes = Object.fromEntries(NOTICE_SHEET_DOCUMENT_CODES.map(code => [code, z.boolean()])) as Record<NoticeSheetDocument, z.ZodBoolean>

export const noticeSheetFieldsSchema = z.strictObject(fieldShapes)
// Source facts remain complete even when they exceed the manual entry limits.
// The preview can then ask the user to shorten a field without losing its source.
const defaultFieldsSchema = z.strictObject(Object.fromEntries(
  Object.keys(NOTICE_SHEET_FIELD_LIMITS).map(key => [key,
    ['insuredRegistrationDate', 'victimRegistrationDate', 'insuredDamageHistory', 'victimDamageHistory'].includes(key) ? z.string().default('') : z.string()]),
) as Record<NoticeSheetField, z.ZodString>)
export const noticeSheetDocumentsSchema = z.strictObject(documentShapes)
export const noticeSheetOverridesSchema = z.strictObject({
  fields: noticeSheetFieldsSchema.partial(),
  documents: noticeSheetDocumentsSchema.partial(),
})
export const noticeSheetSaveRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema.nullable(),
  overrides: noticeSheetOverridesSchema,
  confirmed: z.literal(true),
})
export const noticeSheetResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseType: z.enum(['traffic', 'casco']).nullable(),
  organizationName: z.string().min(1),
  officeNumber: z.string(),
  claimNumber: z.string().nullable(),
  noticeNumber: z.string().nullable(),
  insurerName: z.string().nullable(),
  plate: z.string(),
  notificationDate: localDateSchema.nullable(),
  lossDate: localDateSchema.nullable(),
  closureDate: localDateSchema.nullable(),
  expertName: z.string().nullable(),
  version: entityVersionSchema.nullable(),
  updatedAt: utcDateTimeSchema.nullable(),
  defaults: z.strictObject({ fields: defaultFieldsSchema, documents: noticeSheetDocumentsSchema }),
  overrides: noticeSheetOverridesSchema,
  permissions: z.strictObject({ canEdit: z.boolean() }),
})
export type NoticeSheetResponse = z.infer<typeof noticeSheetResponseSchema>
export type NoticeSheetSaveRequest = z.infer<typeof noticeSheetSaveRequestSchema>
export type { NoticeSheetField, NoticeSheetFields, NoticeSheetDocument, NoticeSheetDocuments, NoticeSheetOverrides } from '@hasarbotu/domain'
export { NOTICE_SHEET_FIELD_LIMITS, applyNoticeSheetOverrides } from '@hasarbotu/domain'
