import { z } from 'zod'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'

export const V1_IMPORT_QUARANTINE_REASONS = [
  'claim_type_unresolved',
  'ambiguous_target',
  'genuine_evidence_conflict',
  'malformed_source',
] as const

export const v1ImportQuarantineReasonSchema = z.enum(V1_IMPORT_QUARANTINE_REASONS)
export const v1ImportQuarantineStatusSchema = z.enum(['unresolved', 'resolved'])

export const v1ImportQuarantinesQuerySchema = z.strictObject({
  reason: v1ImportQuarantineReasonSchema.optional(),
  status: v1ImportQuarantineStatusSchema.optional(),
  page: pageWithDefaultSchema,
  pageSize: pageSizeWithDefaultSchema,
})

export type V1ImportQuarantineReason = z.infer<typeof v1ImportQuarantineReasonSchema>
export type V1ImportQuarantineStatus = z.infer<typeof v1ImportQuarantineStatusSchema>
export type V1ImportQuarantinesQuery = z.infer<typeof v1ImportQuarantinesQuerySchema>
