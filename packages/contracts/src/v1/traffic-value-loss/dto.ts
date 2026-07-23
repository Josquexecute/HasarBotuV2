import { z } from 'zod'
import {
  REAL_MARKET_VALUE_LOSS_CALCULATION_METHOD,
  REAL_MARKET_VALUE_LOSS_ELIGIBILITY,
  REAL_MARKET_VALUE_LOSS_REASON_CODES,
  REAL_MARKET_VALUE_LOSS_ROUNDING_RULE,
  REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR,
  REAL_MARKET_VALUE_LOSS_RULE_SET_ID,
  REAL_MARKET_VALUE_LOSS_RULE_VERSION,
  REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256,
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
  VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
} from '@hasarbotu/domain'
import { caseIdSchema, idSchema, localDateSchema, utcDateTimeSchema, userIdSchema } from '../../common/primitives.js'
import {
  trafficValueLossBasisPointsSchema,
  trafficValueLossCodeSchema,
  trafficValueLossDamagePartInputSchema,
  trafficValueLossExternalReferenceSchema,
  trafficValueLossMoneyMinorSchema,
  trafficValueLossRealMarketInputSchema,
} from './commands.js'

export const trafficValueLossParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const trafficValueLossVersionParamsSchema = z.strictObject({ caseId: caseIdSchema, versionId: idSchema })
export const trafficValueLossPartCatalogQuerySchema = z.strictObject({
  vehicleGroupCode: z.enum(['A', 'B', 'C', 'Ç', 'D', 'E', 'F']),
})

const trafficValueLossLegacyRuleSourceSchema = z.strictObject({
  code: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  sourceType: z.enum(['official_gazette', 'seddk_circular']),
  publishedAt: localDateSchema,
  effectiveFrom: z.literal(TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM),
  locator: z.string().min(1).max(300),
  url: z.string().url().max(500),
})

const trafficValueLossRealMarketRuleSourceSchema = z.strictObject({
  code: z.literal('PACKAGE66-NORMALIZED-SNAPSHOT'),
  title: z.string().min(1).max(300),
  sourceType: z.literal('normalized_rule_snapshot'),
  effectiveFrom: z.literal('2026-07-01'),
  locator: z.literal(REAL_MARKET_VALUE_LOSS_RULE_VERSION),
  sourceWorkbookSha256: z.literal(VALUE_LOSS_SOURCE_WORKBOOK_SHA256),
  normalizedSnapshotSha256: z.literal(REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256),
})

export const trafficValueLossRuleSourceSchema = z.union([
  trafficValueLossLegacyRuleSourceSchema,
  trafficValueLossRealMarketRuleSourceSchema,
])

const trafficValueLossLegacyUncertaintySchema = z.strictObject({
  code: z.enum(TRAFFIC_VALUE_LOSS_UNCERTAINTY_CODES),
  field: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  blocking: z.boolean(),
  requiresHumanReview: z.literal(true),
})

const trafficValueLossLegacyEvaluationSchema = z.strictObject({
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
  uncertainties: z.array(trafficValueLossLegacyUncertaintySchema).max(100),
  reasoning: z.array(z.string().min(1).max(500)).min(1).max(50),
  humanApprovalRequired: z.literal(true),
  canSubmitForApproval: z.boolean(),
})

const trafficValueLossExactRationalSchema = z.strictObject({
  numerator: z.string().regex(/^-?\d+$/),
  denominator: z.string().regex(/^[1-9]\d*$/),
  decimal: z.string().regex(/^-?\d+(?:\.\d+)?$/),
})

const trafficValueLossRealMarketReasonSchema = z.strictObject({
  code: z.enum(REAL_MARKET_VALUE_LOSS_REASON_CODES),
  field: z.string().min(1).max(200),
  message: z.string().min(1).max(500),
  kind: z.enum(['blocked', 'control_required']),
})

const trafficValueLossRealMarketEvaluationSchema = z.strictObject({
  ruleSetId: z.literal(REAL_MARKET_VALUE_LOSS_RULE_SET_ID),
  ruleVersion: z.literal(REAL_MARKET_VALUE_LOSS_RULE_VERSION),
  ruleIdentity: z.literal(REAL_MARKET_VALUE_LOSS_RULE_VERSION),
  effectiveFrom: z.literal('2026-07-01'),
  sourceWorkbookSha256: z.literal(VALUE_LOSS_SOURCE_WORKBOOK_SHA256),
  normalizedSnapshotSha256: z.literal(REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256),
  calculationMethod: z.literal(REAL_MARKET_VALUE_LOSS_CALCULATION_METHOD),
  roundingRule: z.literal(REAL_MARKET_VALUE_LOSS_ROUNDING_RULE),
  ruleSources: z.array(trafficValueLossRuleSourceSchema).length(1),
  eligibility: z.enum(REAL_MARKET_VALUE_LOSS_ELIGIBILITY),
  reasonCodes: z.array(z.enum(REAL_MARKET_VALUE_LOSS_REASON_CODES)).max(100),
  reasons: z.array(trafficValueLossRealMarketReasonSchema).max(100),
  eligibilityStatus: z.enum(['calculable', 'not_applicable', 'control_required']),
  ageCoefficient: trafficValueLossExactRationalSchema.nullable(),
  usageCoefficient: trafficValueLossExactRationalSchema.nullable(),
  generalModifiers: z.strictObject({
    commercialOrRental: trafficValueLossExactRationalSchema,
    previousDamage: trafficValueLossExactRationalSchema,
    lowerBandProximity: trafficValueLossExactRationalSchema,
    multiplier: trafficValueLossExactRationalSchema,
  }),
  partBreakdown: z.array(z.strictObject({
    stableRuleId: z.string().min(1).max(500),
    sourceTable: z.string().min(1).max(100),
    sourceRow: z.number().int().min(1),
    sourceLabel: z.string().min(1).max(300),
    operation: z.enum(['replacement', 'repair', 'paint']),
    repairClass: z.enum(['light', 'medium', 'heavy']).nullable(),
    coefficient: trafficValueLossExactRationalSchema,
    included: z.boolean(),
    exclusionReason: z.string().min(1).max(100).nullable(),
  })).max(500),
  partCoefficientPercentagePoints: trafficValueLossExactRationalSchema.nullable(),
  damageAmountContribution: trafficValueLossExactRationalSchema.nullable(),
  damageCoefficient: trafficValueLossExactRationalSchema.nullable(),
  vehicleMultiplier: trafficValueLossExactRationalSchema.nullable(),
  rawResultMinor: trafficValueLossExactRationalSchema.nullable(),
  capMinor: trafficValueLossExactRationalSchema.nullable(),
  cappedResultMinor: trafficValueLossExactRationalSchema.nullable(),
  capApplied: z.boolean(),
  roundingUnitMinor: z.literal(REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR),
  roundingResultMinor: trafficValueLossMoneyMinorSchema.nullable(),
  finalResultMinor: trafficValueLossMoneyMinorSchema.nullable(),
  grossValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
  faultAdjustedValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
  qualifyingPreComparableCount: z.number().int().min(0).max(100),
  qualifyingPostComparableCount: z.literal(0),
  uncertainties: z.array(z.strictObject({
    code: z.enum(REAL_MARKET_VALUE_LOSS_REASON_CODES),
    field: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    blocking: z.literal(true),
    requiresHumanReview: z.literal(true),
  })).max(100),
  reasoning: z.array(z.string().min(1).max(500)).min(1).max(50),
  humanApprovalRequired: z.literal(true),
  canSubmitForApproval: z.boolean(),
})

export const trafficValueLossUncertaintySchema = z.union([
  trafficValueLossLegacyUncertaintySchema,
  trafficValueLossRealMarketEvaluationSchema.shape.uncertainties.element,
])
export const trafficValueLossEvaluationSchema = z.union([
  trafficValueLossLegacyEvaluationSchema,
  trafficValueLossRealMarketEvaluationSchema,
])

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
  realMarket: trafficValueLossRealMarketInputSchema.nullable().default(null),
  inputOverrides: z.array(z.strictObject({
    field: z.string().min(1).max(100),
    originalValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
    newValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
    reason: z.string().min(1).max(500),
    changedBy: userIdSchema,
    changedAt: utcDateTimeSchema,
  })).max(100).default([]),
  ruleOverride: z.strictObject({
    ruleIdentity: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    authorizedBy: userIdSchema,
    authorizedAt: utcDateTimeSchema,
  }).nullable().default(null),
})

export const trafficValueLossVersionSchema = z.strictObject({
  id: idSchema,
  organizationId: idSchema,
  caseId: caseIdSchema,
  calculationId: idSchema,
  revisionId: idSchema,
  assessmentVersion: z.number().int().min(1),
  status: z.enum(TRAFFIC_VALUE_LOSS_STATUSES),
  ruleSetId: z.enum([TRAFFIC_VALUE_LOSS_RULE_SET_ID, REAL_MARKET_VALUE_LOSS_RULE_SET_ID]),
  ruleVersion: z.enum([TRAFFIC_VALUE_LOSS_RULE_VERSION, REAL_MARKET_VALUE_LOSS_RULE_VERSION]),
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
export const trafficValueLossCurrentApprovedResponseSchema = z.strictObject({
  version: trafficValueLossVersionSchema,
})
export const trafficValueLossPreviewResponseSchema = z.strictObject({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  ruleSetId: z.enum([TRAFFIC_VALUE_LOSS_RULE_SET_ID, REAL_MARKET_VALUE_LOSS_RULE_SET_ID]),
  ruleVersion: z.enum([TRAFFIC_VALUE_LOSS_RULE_VERSION, REAL_MARKET_VALUE_LOSS_RULE_VERSION]),
  input: trafficValueLossInputSnapshotSchema,
  evaluation: trafficValueLossEvaluationSchema,
})
export const trafficValueLossPartCatalogResponseSchema = z.strictObject({
  ruleIdentity: z.literal(REAL_MARKET_VALUE_LOSS_RULE_VERSION),
  vehicleGroupCode: z.enum(['A', 'B', 'C', 'Ç', 'D', 'E', 'F']),
  parts: z.array(z.strictObject({
    stableRuleId: z.string().min(1).max(500),
    label: z.string().min(1).max(300),
    sourceTable: z.string().min(1).max(100),
    sourceRow: z.number().int().min(1),
    supportedOperations: z.array(z.enum(['replacement', 'repair', 'paint'])).min(1).max(3),
    coefficients: z.strictObject({
      replacement: z.string().nullable(),
      repair: z.strictObject({
        light: z.string(),
        medium: z.string(),
        heavy: z.string(),
      }).nullable(),
      paint: z.strictObject({ full: z.string(), local: z.string() }).nullable(),
    }),
  })).max(200),
})

export type TrafficValueLossAssessmentDto = z.infer<typeof trafficValueLossAssessmentSchema>
export type TrafficValueLossVersionDto = z.infer<typeof trafficValueLossVersionSchema>
export type TrafficValueLossResponse = z.infer<typeof trafficValueLossResponseSchema>
export type TrafficValueLossVersionsResponse = z.infer<typeof trafficValueLossVersionsResponseSchema>
export type TrafficValueLossCurrentApprovedResponse = z.infer<typeof trafficValueLossCurrentApprovedResponseSchema>
export type TrafficValueLossPreviewResponse = z.infer<typeof trafficValueLossPreviewResponseSchema>
export type TrafficValueLossPartCatalogResponse = z.infer<typeof trafficValueLossPartCatalogResponseSchema>
