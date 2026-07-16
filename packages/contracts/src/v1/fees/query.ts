import { z } from 'zod'
import { CLOSURE_FEE_STATUSES } from '@hasarbotu/domain'
import { idSchema } from '../../common/primitives.js'

export const reportPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const caseSummaryReportQuerySchema = z.strictObject({
  period: reportPeriodSchema,
  responsibleUserId: idSchema.optional(),
  serviceId: idSchema.optional(),
})

export const closureFeeListQuerySchema = z.strictObject({
  status: z.enum(CLOSURE_FEE_STATUSES).optional(),
})

export type CaseSummaryReportQuery = z.infer<typeof caseSummaryReportQuerySchema>
export type ClosureFeeListQuery = z.infer<typeof closureFeeListQuerySchema>
