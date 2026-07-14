import { z } from 'zod'
import { CLOSURE_MODES, OPEN_CASE_STAGES } from '@hasarbotu/domain'
import { entityVersionSchema } from '../../common/primitives.js'

export const lifecycleReasonSchema = z.string().min(3).max(500).regex(/\S/, { error: 'must_not_be_blank' })
export const closeModeSchema = z.enum(CLOSURE_MODES)
export const openWorkflowStageSchema = z.enum(OPEN_CASE_STAGES)

export const closePlanRequestSchema = z.strictObject({
  expectedCaseVersion: entityVersionSchema,
  expectedLocationVersion: entityVersionSchema,
  closeMode: closeModeSchema,
  reason: lifecycleReasonSchema.optional(),
}).superRefine((value, context) => {
  if (value.closeMode === 'with_missing_requirements' && value.reason === undefined) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' })
  }
})

export const reopenPlanRequestSchema = z.strictObject({
  expectedCaseVersion: entityVersionSchema,
  expectedLocationVersion: entityVersionSchema,
  reason: lifecycleReasonSchema,
  targetWorkflowStage: openWorkflowStageSchema.default('new_notification'),
})

export const lifecycleApproveRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  approved: z.literal(true),
})

export const lifecycleCancelRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  cancelled: z.literal(true),
})

export type ClosePlanRequest = z.infer<typeof closePlanRequestSchema>
export type ReopenPlanRequest = z.infer<typeof reopenPlanRequestSchema>
export type LifecycleApproveRequest = z.infer<typeof lifecycleApproveRequestSchema>
export type LifecycleCancelRequest = z.infer<typeof lifecycleCancelRequestSchema>
