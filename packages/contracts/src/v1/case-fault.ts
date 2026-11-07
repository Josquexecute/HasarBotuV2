import { z } from 'zod'
import { CASE_FAULT_PERCENTAGES } from '@hasarbotu/domain'
import { caseIdSchema, caseTypeSchema, utcDateTimeSchema } from '../common/primitives.js'

export const CASE_FAULT_ROUTE = '/api/v1/cases/:caseId/fault'
export const caseFaultPercentageSchema = z.literal(CASE_FAULT_PERCENTAGES)
export const caseFaultParamsSchema = z.strictObject({ caseId: caseIdSchema.uuid() })
export const caseFaultSaveRequestSchema = z.strictObject({
  insuredPercent: caseFaultPercentageSchema.nullable(),
  expectedVersion: z.number().int().min(0).max(2147483646),
})
export const caseFaultResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseType: caseTypeSchema.nullable(),
  insuredPercent: caseFaultPercentageSchema.nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: utcDateTimeSchema.nullable(),
  permissions: z.strictObject({ canEdit: z.boolean() }),
})
export type CaseFaultResponse = z.infer<typeof caseFaultResponseSchema>
export type CaseFaultSaveRequest = z.infer<typeof caseFaultSaveRequestSchema>
