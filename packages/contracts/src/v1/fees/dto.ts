import { z } from 'zod'
import {
  CLOSURE_FEE_CURRENCY,
  CLOSURE_FEE_RULE_VERSION,
  CLOSURE_FEE_SOURCE_TYPES,
  CLOSURE_FEE_STATUSES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  caseTypeSchema,
  entityVersionSchema,
  idSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { closureFeeAmountMinorSchema, closureFeeSourcePageSchema } from './commands.js'

export const closureFeeStatusSchema = z.enum(CLOSURE_FEE_STATUSES)
export const closureFeeSourceTypeSchema = z.enum(CLOSURE_FEE_SOURCE_TYPES)

export const closureFeeVersionSchema = z.strictObject({
  id: idSchema,
  feeVersion: entityVersionSchema,
  status: closureFeeStatusSchema,
  candidateAmountMinor: closureFeeAmountMinorSchema,
  approvedAmountMinor: closureFeeAmountMinorSchema.nullable(),
  currency: z.literal(CLOSURE_FEE_CURRENCY),
  sourceDocumentVersionId: idSchema,
  sourcePage: closureFeeSourcePageSchema,
  sourceType: closureFeeSourceTypeSchema,
  ruleVersion: z.literal(CLOSURE_FEE_RULE_VERSION),
  correctionReason: z.string().min(3).max(500).nullable(),
  createdByUserId: idSchema,
  approvedByUserId: idSchema.nullable(),
  approvedAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
})

export const closureFeePermissionsSchema = z.strictObject({
  canCreateCandidate: z.boolean(),
  canApprove: z.boolean(),
  canCorrect: z.boolean(),
})

export const closureFeeRecordSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  version: entityVersionSchema,
  currentVersion: closureFeeVersionSchema,
  history: z.array(closureFeeVersionSchema).min(1).max(1_000),
  permissions: closureFeePermissionsSchema,
})

export const caseClosureFeeResponseSchema = z.strictObject({
  fee: closureFeeRecordSchema.nullable(),
  permissions: closureFeePermissionsSchema,
})

export const closureFeeResponseSchema = z.strictObject({
  fee: closureFeeRecordSchema,
})

export const closureFeeListItemSchema = z.strictObject({
  caseId: caseIdSchema,
  officeCaseNumber: officeCaseNumberSchema,
  plate: plateNumberSchema,
  caseType: caseTypeSchema,
  insurerName: z.string().min(1).max(160).nullable(),
  serviceName: z.string().min(1).max(160).nullable(),
  responsibleUserName: z.string().min(1).max(160).nullable(),
  closedAt: utcDateTimeSchema,
  fee: closureFeeRecordSchema,
})

export const closureFeeListResponseSchema = z.strictObject({
  items: z.array(closureFeeListItemSchema).max(10_000),
})

export const reportFeeSummarySchema = z.strictObject({
  totalCaseCount: z.number().int().min(0).max(100_000),
  openCaseCount: z.number().int().min(0).max(100_000),
  closedCaseCount: z.number().int().min(0).max(100_000),
  trafficCaseCount: z.number().int().min(0).max(100_000),
  cascoCaseCount: z.number().int().min(0).max(100_000),
  approvedFeeCount: z.number().int().min(0).max(100_000),
  /** `includesFinancials=false` iken (HB-011) rolün mali görünürlüğü yoktur; tutar `null` döner. */
  approvedFeeTotalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  controlRequiredFeeCount: z.number().int().min(0).max(100_000),
  closedCaseWithoutFeeCount: z.number().int().min(0).max(100_000),
  approvedValueLossCount: z.number().int().min(0).max(100_000),
  approvedValueLossTotalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  controlRequiredValueLossCount: z.number().int().min(0).max(100_000),
  notApplicableValueLossCount: z.number().int().min(0).max(100_000),
})

export const reportDistributionItemSchema = z.strictObject({
  code: z.enum(['traffic', 'casco', 'closed']),
  count: z.number().int().min(0).max(100_000),
})

export const reportFilterOptionSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(160),
})

export const caseSummaryReportResponseSchema = z.strictObject({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEndExclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: utcDateTimeSchema,
  periodBasis: z.literal('open_created_closed_finalized'),
  /** HB-011: mali alan (tutar/bekleyen ücret listesi) yalnız FINANCIAL_READ_ROLES için doludur. */
  includesFinancials: z.boolean(),
  summary: reportFeeSummarySchema,
  distribution: z.array(reportDistributionItemSchema).length(3),
  responsibleUsers: z.array(reportFilterOptionSchema).max(5_000),
  services: z.array(reportFilterOptionSchema).max(5_000),
  pendingFees: z.array(closureFeeListItemSchema).max(10_000),
})

export const caseFeeParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const feeParamsSchema = z.strictObject({ feeId: idSchema })

export type ClosureFeeStatusDto = z.infer<typeof closureFeeStatusSchema>
export type ClosureFeeVersion = z.infer<typeof closureFeeVersionSchema>
export type ClosureFeePermissions = z.infer<typeof closureFeePermissionsSchema>
export type ClosureFeeRecord = z.infer<typeof closureFeeRecordSchema>
export type CaseClosureFeeResponse = z.infer<typeof caseClosureFeeResponseSchema>
export type ClosureFeeResponse = z.infer<typeof closureFeeResponseSchema>
export type ClosureFeeListItem = z.infer<typeof closureFeeListItemSchema>
export type ClosureFeeListResponse = z.infer<typeof closureFeeListResponseSchema>
export type CaseSummaryReportResponse = z.infer<typeof caseSummaryReportResponseSchema>
