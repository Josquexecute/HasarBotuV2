import { z } from 'zod'
import {
  LABOR_SHEET_CURRENCY,
  LABOR_SHEET_SCHEMA_VERSION,
  LABOR_SHEET_SOURCE_TYPES,
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  MAX_LABOR_REVISION_REASON_LENGTH,
  MAX_LABOR_SHEET_ITEMS,
  MAX_LABOR_SHEET_TOTAL_MINOR,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

const displayNameSchema = z.string().min(1).max(200)
const amountMinorSchema = z.number().int().min(0).max(MAX_LABOR_AMOUNT_MINOR)
const totalMinorSchema = z.number().int().min(0).max(MAX_LABOR_SHEET_TOTAL_MINOR)

export const laborSheetParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const laborSheetItemSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(MAX_LABOR_SHEET_ITEMS),
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  partAmountMinor: amountMinorSchema,
  laborAmountMinor: amountMinorSchema,
})

export const laborSheetTotalsSchema = z.strictObject({
  partTotalMinor: totalMinorSchema,
  laborTotalMinor: totalMinorSchema,
  grandTotalMinor: totalMinorSchema,
})

export const laborSheetVersionSchema = z.strictObject({
  id: idSchema,
  sheetVersion: entityVersionSchema,
  previousVersionId: idSchema.nullable(),
  items: z.array(laborSheetItemSchema).min(1).max(MAX_LABOR_SHEET_ITEMS),
  totals: laborSheetTotalsSchema,
  schemaVersion: z.literal(LABOR_SHEET_SCHEMA_VERSION),
  currency: z.literal(LABOR_SHEET_CURRENCY),
  sourceType: z.enum(LABOR_SHEET_SOURCE_TYPES),
  revisionReason: z.string().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
})

export const laborSheetSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  version: entityVersionSchema,
  currentVersion: laborSheetVersionSchema,
  versions: z.array(laborSheetVersionSchema).min(1).max(1_000),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const laborSheetPermissionsSchema = z.strictObject({
  canWrite: z.boolean(),
})

export const laborSheetWorkspaceResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  lifecycleStatus: z.enum(['open', 'closed']),
  sheet: laborSheetSchema.nullable(),
  permissions: laborSheetPermissionsSchema,
})

export const laborSheetResponseSchema = z.strictObject({
  sheet: laborSheetSchema,
})

export type LaborSheetParams = z.infer<typeof laborSheetParamsSchema>
export type LaborSheetItem = z.infer<typeof laborSheetItemSchema>
export type LaborSheetTotals = z.infer<typeof laborSheetTotalsSchema>
export type LaborSheetVersion = z.infer<typeof laborSheetVersionSchema>
export type LaborSheet = z.infer<typeof laborSheetSchema>
export type LaborSheetPermissions = z.infer<typeof laborSheetPermissionsSchema>
export type LaborSheetWorkspaceResponse = z.infer<typeof laborSheetWorkspaceResponseSchema>
export type LaborSheetResponse = z.infer<typeof laborSheetResponseSchema>
