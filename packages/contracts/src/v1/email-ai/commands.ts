import { z } from 'zod'
import {
  EMAIL_AI_PROVIDER_IDS,
  EMAIL_DRAFT_TYPES,
  MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH,
} from '@hasarbotu/domain'
import { entityVersionSchema } from '../../common/primitives.js'

export const emailAiPlanRequestSchema = z.strictObject({
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  instruction: z.string().trim().max(MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH).nullable().default(null),
  providerId: z.enum(EMAIL_AI_PROVIDER_IDS),
})

export const emailAiStartRequestSchema = emailAiPlanRequestSchema.extend({
  expectedCaseVersion: entityVersionSchema,
  expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
})

export type EmailAiPlanRequest = z.infer<typeof emailAiPlanRequestSchema>
export type EmailAiStartRequest = z.infer<typeof emailAiStartRequestSchema>
