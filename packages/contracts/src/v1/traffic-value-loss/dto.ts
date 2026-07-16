import { z } from 'zod'
import {
  TRAFFIC_VALUE_LOSS_CALCULATION_METHOD,
  TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES,
  TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM,
  TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS,
  TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES,
  TRAFFIC_VALUE_LOSS_ROUNDING_RULE,
  TRAFFIC_VALUE_LOSS_RULE_SET_ID,
  TRAFFIC_VALUE_LOSS_RULE_VERSION,
  TRAFFIC_VALUE_LOSS_STATUSES,
  TRAFFIC_VALUE_LOSS_UNCERTAINTY_CODES,
} from '@hasarbotu/domain'
import { caseIdSchema, idSchema, localDateSchema, utcDateTimeSchema, userIdSchema } from '../../common/primitives.js'
import {
  trafficValueLossBasisPointsSchema,
  trafficValueLossCodeSchema,
  trafficValueLossDamagePartInputSchema,
  trafficValueLossExternalReferenceSchema,
  trafficValueLossMoneyMinorSchema,
} from './commands.js'

export const trafficValueLossParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const trafficValueLossVersionParamsSchema = z.strictObject({ caseId: caseIdSchema, versionId: idSchema })

export const trafficValueLossRuleSourceSchema = z.strictObject({
  code: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  sourceType: z.enum(['official_gazette', 'seddk_circular']),
  publishedAt: localDateSchema,
  effectiveFrom: z.literal(TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM),
  locator: z.string().min(1).max(300),
  url: z.string().url().max(500),
})

export const trafficValueLossUncertaintySchema = z.strictObject({
  code: z.enum(TRAFFIC_VALUE_LOSS_UNCERTAINTY_CODES),
  field: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  blocking: z.boolean(),
  requiresHumanReview: z.literal(true),
})

export const trafficValueLossEvaluationSchema = z.strictObject({
  ruleSetId: z.literal(TRAFFIC_VALUE_LOSS_RULE_SET_ID),
  ruleVersion: z.literal(TRAFFIC_VALUE_LOSS_RULE_VERSION),
  effectiveFrom: z.literal(TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM),
  calculationMethod: z.literal(TRAFFIC_VALUE_LOSS_CALCULATION_METHOD),
  roundingRule: z.literal(TRAFFIC_VALUE_LOSS_ROUNDING_RULE),
  ruleSources: z.array(trafficValueLossRuleSourceSchema).min(2),
  eligibilityStatus: z.enum(TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES),
  grossValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
  faultAdjustedValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
  qualifyingPreComparableCount: z.number().int().min(0).max(100),
  qualifyingPostComparableCount: z.number().int().min(0).max(100),
  uncertainties: z.array(trafficValueLossUncertaintySchema).max(100),
  reasoning: z.array(z.string().min(1).max(500)).min(1).max(50),
  humanApprovalRequired: z.literal(true),
  canSubmitForApproval: z.boolean(),
})

export const trafficValueLossEvidenceSchema = z.strictObject({
  id: idSchema,
  evidenceKey: trafficValueLossCodeSchema,
  sourceType: z.enum(TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES),
  documentId: idSchema.nullable(),
  documentVersionId: idSchema.nullable(),
  externalReference: trafficValueLossExternalReferenceSchema.nullable(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: localDateSchema.nullable(),
  supports: z.array(z.enum(TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS)).min(1).max(20),
  verificationStatus: z.enum(['verified', 'control_required']),
  conflict: z.boolean(),
  notes: z.string().min(1).max(500).nullable(),
  createdAt: utcDateTimeSchema,
})

export const trafficValueLossComparableSchema = z.strictObject({
  id: idSchema,
  comparableKey: trafficValueLossCodeSchema,
  side: z.enum(['pre_accident', 'post_repair']),
  amountMinor: trafficValueLossMoneyMinorSchema,
  mileage: z.number().int().min(0).max(10_000_000).nullable(),
  observedAt: localDateSchema,
  evidenceId: idSchema,
  excluded: z.boolean(),
  exclusionReason: z.string().min(1).max(500).nullable(),
})

export const trafficValueLossInputSnapshotSchema = z.strictObject({
  lossDate: localDateSchema.nullable(),
  notificationDate: localDateSchema.nullable(),
  evaluatedOn: localDateSchema,
  heavyOrTotalDamage: z.boolean().nullable(),
  vehicle: z.strictObject({
    make: z.string().min(1).max(100).nullable(),
    model: z.string().min(1).max(100).nullable(),
    variant: z.string().min(1).max(150).nullable(),
    modelYear: z.number().int().min(1900).max(2200).nullable(),
    mileage: z.number().int().min(0).max(10_000_000).nullable(),
    usageType: z.string().min(1).max(100).nullable(),
  }),
  faultRateBasisPoints: trafficValueLossBasisPointsSchema.nullable(),
  preAccidentMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  postRepairMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  damageParts: z.array(trafficValueLossDamagePartInputSchema).max(500),
})

export const trafficValueLossVersionSchema = z.strictObject({
  id: idSchema,
  assessmentVersion: z.number().int().min(1),
  status: z.enum(TRAFFIC_VALUE_LOSS_STATUSES),
  ruleSetId: z.literal(TRAFFIC_VALUE_LOSS_RULE_SET_ID),
  ruleVersion: z.literal(TRAFFIC_VALUE_LOSS_RULE_VERSION),
  effectiveFrom: z.literal(TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM),
  input: trafficValueLossInputSnapshotSchema,
  evaluation: trafficValueLossEvaluationSchema,
  evidence: z.array(trafficValueLossEvidenceSchema),
  comparables: z.array(trafficValueLossComparableSchema),
  humanApprovalStatus: z.enum(['pending', 'approved', 'rejected']),
  approvedBy: userIdSchema.nullable(),
  approvedAt: utcDateTimeSchema.nullable(),
  approvalReason: z.string().min(1).max(500).nullable(),
  createdBy: userIdSchema,
  createdAt: utcDateTimeSchema,
})

export const trafficValueLossAssessmentSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  currentVersion: trafficValueLossVersionSchema,
  version: z.number().int().min(1),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const trafficValueLossResponseSchema = z.strictObject({ assessment: trafficValueLossAssessmentSchema })
export const trafficValueLossVersionsResponseSchema = z.strictObject({ versions: z.array(trafficValueLossVersionSchema) })

export type TrafficValueLossAssessmentDto = z.infer<typeof trafficValueLossAssessmentSchema>
export type TrafficValueLossVersionDto = z.infer<typeof trafficValueLossVersionSchema>
export type TrafficValueLossResponse = z.infer<typeof trafficValueLossResponseSchema>
export type TrafficValueLossVersionsResponse = z.infer<typeof trafficValueLossVersionsResponseSchema>
