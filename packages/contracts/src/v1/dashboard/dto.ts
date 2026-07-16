import { z } from 'zod'
import { DASHBOARD_ATTENTION_CODES, DASHBOARD_PRIORITY_VERSION } from '@hasarbotu/domain'
import {
  caseIdSchema,
  caseTypeSchema,
  entityVersionSchema,
  localDateSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

export const DASHBOARD_OPEN_STAGES = [
  'new_notification',
  'vehicle_or_service_pending',
  'inspection_pending',
  'damage_assessment',
  'parts_and_labor',
  'repair_approval_pending',
  'under_repair',
  'reporting',
  'closing_documents',
  'ready_to_close',
] as const

export const DASHBOARD_PRIORITIES = ['critical', 'high', 'medium', 'normal'] as const
export const DASHBOARD_HUMAN_APPROVAL_KINDS = [
  'case_lifecycle',
  'policy_analysis',
  'policy_ai_review',
  'traffic_value_loss',
] as const

export const dashboardPrioritySchema = z.enum(DASHBOARD_PRIORITIES)
export const dashboardAttentionCodeSchema = z.enum(DASHBOARD_ATTENTION_CODES)
export const dashboardHumanApprovalKindSchema = z.enum(DASHBOARD_HUMAN_APPROVAL_KINDS)
export const dashboardOpenStageSchema = z.enum(DASHBOARD_OPEN_STAGES)

const boundedCountSchema = z.number().int().min(0).max(100_000)
const safeDisplayNameSchema = z.string().min(1).max(160)

function uniqueArray<T extends z.ZodType>(schema: T, maximum: number, marker: string) {
  return z.array(schema).max(maximum).superRefine((items, context) => {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: 'custom', message: 'duplicate_value' })
    }
  }).meta({ 'x-hasarbotu-runtime-validation': marker })
}

export const dashboardCaseItemSchema = z.strictObject({
  caseId: caseIdSchema,
  caseType: caseTypeSchema,
  officeCaseNumber: officeCaseNumberSchema,
  plate: plateNumberSchema,
  stage: dashboardOpenStageSchema,
  responsibleUserId: userIdSchema.nullable(),
  responsibleUserName: safeDisplayNameSchema.nullable(),
  insurerName: safeDisplayNameSchema.nullable(),
  serviceName: safeDisplayNameSchema.nullable(),
  followUpDate: localDateSchema.nullable(),
  updatedAt: utcDateTimeSchema,
  version: entityVersionSchema,
  missingDocumentCount: boundedCountSchema,
  controlRequiredDocumentCount: boundedCountSchema,
  documentRuleVersion: z.string().min(1).max(64),
  pendingHumanApprovalCount: boundedCountSchema,
  pendingHumanApprovalKinds: uniqueArray(
    dashboardHumanApprovalKindSchema,
    DASHBOARD_HUMAN_APPROVAL_KINDS.length,
    'unique-dashboard-approval-kind',
  ),
  manualRecoveryCount: boundedCountSchema,
  failedOperationCount: boundedCountSchema,
  blockedOperationCount: boundedCountSchema,
  priority: dashboardPrioritySchema,
  priorityScore: z.number().int().min(0).max(2_000),
  primaryAttention: dashboardAttentionCodeSchema.nullable(),
  attentionCodes: uniqueArray(
    dashboardAttentionCodeSchema,
    DASHBOARD_ATTENTION_CODES.length,
    'unique-dashboard-attention-code',
  ),
  requiresAction: z.boolean(),
})

export const dashboardSummarySchema = z.strictObject({
  openCaseCount: boundedCountSchema,
  overdueFollowUpCount: boundedCountSchema,
  dueTodayCount: boundedCountSchema,
  upcomingFollowUpCount: boundedCountSchema,
  missingDocumentCaseCount: boundedCountSchema,
  controlRequiredDocumentCaseCount: boundedCountSchema,
  pendingHumanApprovalCaseCount: boundedCountSchema,
  actionRequiredCaseCount: boundedCountSchema,
  criticalCaseCount: boundedCountSchema,
})

export const dashboardStageCountSchema = z.strictObject({
  stage: dashboardOpenStageSchema,
  count: boundedCountSchema,
})

export const dashboardResponseSchema = z.strictObject({
  asOfDate: localDateSchema,
  evaluatedAt: utcDateTimeSchema,
  priorityVersion: z.literal(DASHBOARD_PRIORITY_VERSION),
  summary: dashboardSummarySchema,
  stageCounts: z.array(dashboardStageCountSchema).length(DASHBOARD_OPEN_STAGES.length),
  items: z.array(dashboardCaseItemSchema).max(5_000),
})

export type DashboardPriorityDto = z.infer<typeof dashboardPrioritySchema>
export type DashboardAttentionCodeDto = z.infer<typeof dashboardAttentionCodeSchema>
export type DashboardHumanApprovalKindDto = z.infer<typeof dashboardHumanApprovalKindSchema>
export type DashboardCaseItem = z.infer<typeof dashboardCaseItemSchema>
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>
export type DashboardStageCount = z.infer<typeof dashboardStageCountSchema>
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>
