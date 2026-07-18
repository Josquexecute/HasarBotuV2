import { z } from 'zod'
import {
  LABOR_DICTIONARY_SCHEMA_VERSION,
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_DICTIONARY_ENTRIES,
  MAX_LABOR_DICTIONARY_QUERY_LENGTH,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
} from '@hasarbotu/domain'
import { utcDateTimeSchema } from '../../common/primitives.js'

const amountMinorSchema = z.number().int().min(0).max(MAX_LABOR_AMOUNT_MINOR)

export const laborDictionaryQuerySchema = z.strictObject({
  query: z.string().trim().max(MAX_LABOR_DICTIONARY_QUERY_LENGTH).default(''),
  limit: z.number().int().min(1).max(MAX_LABOR_DICTIONARY_ENTRIES).default(MAX_LABOR_DICTIONARY_ENTRIES),
})

export const laborDictionaryEntrySchema = z.strictObject({
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  usageCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  lastPartAmountMinor: amountMinorSchema,
  lastLaborAmountMinor: amountMinorSchema,
  lastUsedAt: utcDateTimeSchema,
})

export const laborDictionaryResponseSchema = z.strictObject({
  schemaVersion: z.literal(LABOR_DICTIONARY_SCHEMA_VERSION),
  items: z.array(laborDictionaryEntrySchema).max(MAX_LABOR_DICTIONARY_ENTRIES),
})

export type LaborDictionaryQuery = z.infer<typeof laborDictionaryQuerySchema>
export type LaborDictionaryEntryDto = z.infer<typeof laborDictionaryEntrySchema>
export type LaborDictionaryResponse = z.infer<typeof laborDictionaryResponseSchema>
