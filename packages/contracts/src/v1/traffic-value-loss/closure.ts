import { z } from 'zod'
import {
  TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION,
  TRAFFIC_VALUE_LOSS_CLOSURE_STATUSES,
  TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES,
  TRAFFIC_VALUE_LOSS_STATUSES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  caseTypeSchema,
  idSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { closeModeSchema } from '../case-lifecycle/commands.js'
import { trafficValueLossMoneyMinorSchema } from './commands.js'

export const trafficValueLossClosureStatusSchema = z.enum(TRAFFIC_VALUE_LOSS_CLOSURE_STATUSES)

export const trafficValueLossClosureSummarySchema = z.strictObject({
  status: trafficValueLossClosureStatusSchema,
  reason: z.string().min(1).max(500),
  ruleVersion: z.literal(TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION),
  requiresHumanReview: z.boolean(),
  assessmentId: idSchema.nullable(),
  assessmentVersionId: idSchema.nullable(),
  assessmentVersion: z.number().int().min(1).nullable(),
  assessmentStatus: z.enum(TRAFFIC_VALUE_LOSS_STATUSES).nullable(),
  humanApprovalStatus: z.enum(['pending', 'approved', 'rejected']).nullable(),
  calculationRuleVersion: z.string().min(1).max(80).nullable(),
  resultCode: z.enum(TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES).nullable(),
  amountMinor: trafficValueLossMoneyMinorSchema.nullable(),
  reportId: idSchema.nullable(),
  reportGeneratedAt: utcDateTimeSchema.nullable(),
})

export const trafficValueLossClosureListItemSchema = z.strictObject({
  caseId: caseIdSchema,
  officeCaseNumber: officeCaseNumberSchema,
  plate: plateNumberSchema,
  caseType: caseTypeSchema,
  closedAt: utcDateTimeSchema,
  closureMode: closeModeSchema.nullable(),
  closureReason: z.string().min(3).max(500).nullable(),
  summary: trafficValueLossClosureSummarySchema,
})

export const trafficValueLossClosureListResponseSchema = z.strictObject({
  items: z.array(trafficValueLossClosureListItemSchema).max(10_000),
})

export type TrafficValueLossClosureSummaryDto = z.infer<typeof trafficValueLossClosureSummarySchema>
export type TrafficValueLossClosureListItemDto = z.infer<typeof trafficValueLossClosureListItemSchema>
export type TrafficValueLossClosureListResponse = z.infer<typeof trafficValueLossClosureListResponseSchema>
