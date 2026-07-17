import { z } from 'zod'
import {
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  MAX_LABOR_REVISION_REASON_LENGTH,
  MAX_LABOR_SHEET_ITEMS,
} from '@hasarbotu/domain'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'

const normalizedText = (maximum: number) => z.string().trim().min(1).max(maximum)
const amountMinorSchema = z.number().int().min(0).max(MAX_LABOR_AMOUNT_MINOR)

export const laborItemInputSchema = z.strictObject({
  description: normalizedText(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: normalizedText(MAX_LABOR_ITEM_ACTION_LENGTH),
  partAmountMinor: amountMinorSchema,
  laborAmountMinor: amountMinorSchema,
})

const laborItemListSchema = z.array(laborItemInputSchema).min(1).max(MAX_LABOR_SHEET_ITEMS)

export const laborSheetCreateRequestSchema = z.strictObject({
  expectedCaseVersion: entityVersionSchema,
  items: laborItemListSchema,
  laborAiSuggestionRunId: idSchema.nullable().default(null),
  confirmed: z.literal(true),
})

export const laborSheetReviseRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  items: laborItemListSchema,
  reason: normalizedText(MAX_LABOR_REVISION_REASON_LENGTH),
  laborAiSuggestionRunId: idSchema.nullable().default(null),
  confirmed: z.literal(true),
})

export type LaborItemInputPayload = z.infer<typeof laborItemInputSchema>
export type LaborSheetCreateRequest = z.infer<typeof laborSheetCreateRequestSchema>
export type LaborSheetReviseRequest = z.infer<typeof laborSheetReviseRequestSchema>
