import { z } from 'zod'
import {
  LABOR_AI_PROVIDER_IDS,
  MAX_LABOR_AI_DAMAGE_DESCRIPTION_LENGTH,
} from '@hasarbotu/domain'
import { entityVersionSchema } from '../../common/primitives.js'

export const laborAiPlanRequestSchema = z.strictObject({
  damageDescription: z.string().trim().min(1).max(MAX_LABOR_AI_DAMAGE_DESCRIPTION_LENGTH),
  providerId: z.enum(LABOR_AI_PROVIDER_IDS),
})

export const laborAiStartRequestSchema = laborAiPlanRequestSchema.extend({
  expectedCaseVersion: entityVersionSchema,
  expectedSheetVersion: entityVersionSchema.nullable().default(null),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
})

export type LaborAiPlanRequest = z.infer<typeof laborAiPlanRequestSchema>
export type LaborAiStartRequest = z.infer<typeof laborAiStartRequestSchema>
