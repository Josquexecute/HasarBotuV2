import { z } from 'zod'
import {
  MAX_TRAFFIC_VALUE_LOSS_REPORT_NOTE_LENGTH,
  TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION,
  TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION,
  TRAFFIC_VALUE_LOSS_REPORT_TITLE,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  idSchema,
  localDateSchema,
  utcDateTimeSchema,
  userIdSchema,
} from '../../common/primitives.js'
import {
  trafficValueLossBasisPointsSchema,
  trafficValueLossCodeSchema,
  trafficValueLossExternalReferenceSchema,
  trafficValueLossMoneyMinorSchema,
} from './commands.js'
import {
  trafficValueLossRuleSourceSchema,
  trafficValueLossUncertaintySchema,
} from './dto.js'

export const trafficValueLossReportVersionParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  versionId: idSchema,
})
export const trafficValueLossReportParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  reportId: idSchema,
})

export const trafficValueLossReportPreviewRequestSchema = z.strictObject({
  expectedAssessmentVersion: z.number().int().min(1),
  reportNote: z.string().trim().min(1).max(MAX_TRAFFIC_VALUE_LOSS_REPORT_NOTE_LENGTH).nullable().default(null),
})
export const trafficValueLossReportGenerateRequestSchema = trafficValueLossReportPreviewRequestSchema.extend({
  confirmed: z.literal(true),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
})

const trafficValueLossReportDamagePartSchema = z.strictObject({
  partCode: trafficValueLossCodeSchema,
  partName: z.string().min(1).max(200),
  repairAction: z.enum(['repair_paint', 'replace_paint', 'paint', 'replace', 'paintless_repair']),
  priorDamage: z.enum(['yes', 'no', 'unknown']),
})

const trafficValueLossReportEvidenceSchema = z.strictObject({
  id: idSchema,
  evidenceKey: trafficValueLossCodeSchema,
  sourceType: z.enum(['document_version', 'market_comparable', 'sbm_history', 'expert_observation']),
  documentId: idSchema.nullable(),
  documentVersionId: idSchema.nullable(),
  externalReference: trafficValueLossExternalReferenceSchema.nullable(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: localDateSchema.nullable(),
  supports: z.array(z.enum([
    'vehicle_identity',
    'mileage',
    'usage_type',
    'damage_parts',
    'prior_damage',
    'pre_accident_market_value',
    'post_repair_market_value',
    'fault_rate',
    'heavy_damage_status',
  ])).min(1).max(20),
  verificationStatus: z.enum(['verified', 'control_required']),
  conflict: z.boolean(),
  notes: z.string().min(1).max(500).nullable(),
})

const trafficValueLossReportComparableSchema = z.strictObject({
  id: idSchema,
  comparableKey: trafficValueLossCodeSchema,
  side: z.enum(['pre_accident', 'post_repair']),
  amountMinor: trafficValueLossMoneyMinorSchema,
  mileage: z.number().int().min(0).max(10_000_000).nullable(),
  observedAt: localDateSchema,
  evidenceId: idSchema,
  evidenceKey: trafficValueLossCodeSchema,
  sourceReference: trafficValueLossExternalReferenceSchema.nullable(),
  excluded: z.boolean(),
  exclusionReason: z.string().min(1).max(500).nullable(),
})

export const trafficValueLossReportContentSchema = z.strictObject({
  schemaVersion: z.literal(TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION),
  templateVersion: z.literal(TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION),
  title: z.literal(TRAFFIC_VALUE_LOSS_REPORT_TITLE),
  caseReference: z.strictObject({
    caseId: caseIdSchema,
    officeNumber: z.string().min(1).max(32),
    plate: z.string().min(1).max(20),
    caseType: z.literal('traffic'),
    lossDate: localDateSchema.nullable(),
    notificationDate: localDateSchema.nullable(),
  }),
  assessment: z.strictObject({
    assessmentId: idSchema,
    versionId: idSchema,
    assessmentVersion: z.number().int().min(1),
    status: z.enum(['approved', 'superseded']),
    humanApprovalStatus: z.literal('approved'),
    approvedBy: userIdSchema,
    approvedAt: utcDateTimeSchema,
    approvalReason: z.string().min(1).max(500).nullable(),
  }),
  vehicle: z.strictObject({
    make: z.string().min(1).max(100).nullable(),
    model: z.string().min(1).max(100).nullable(),
    variant: z.string().min(1).max(150).nullable(),
    modelYear: z.number().int().min(1900).max(2200).nullable(),
    mileage: z.number().int().min(0).max(10_000_000).nullable(),
    usageType: z.string().min(1).max(100).nullable(),
  }),
  damageParts: z.array(trafficValueLossReportDamagePartSchema).max(500),
  calculation: z.strictObject({
    eligibilityStatus: z.enum(['calculable', 'no_value_loss', 'not_applicable', 'control_required']),
    calculationMethod: z.enum(['market_value_difference', 'real_market_analysis']),
    roundingRule: z.enum(['half_up_minor_unit', 'ceil_500_try']),
    preAccidentMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
    postRepairMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
    grossValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
    faultRateBasisPoints: trafficValueLossBasisPointsSchema.nullable(),
    faultAdjustedValueLossMinor: trafficValueLossMoneyMinorSchema.nullable(),
    qualifyingPreComparableCount: z.number().int().min(0).max(100),
    qualifyingPostComparableCount: z.number().int().min(0).max(100),
    reasoning: z.array(z.string().min(1).max(500)).min(1).max(50),
  }),
  evidence: z.array(trafficValueLossReportEvidenceSchema).min(1).max(200),
  comparables: z.array(trafficValueLossReportComparableSchema).max(100),
  uncertainties: z.array(trafficValueLossUncertaintySchema).max(100),
  rule: z.strictObject({
    ruleSetId: z.string().min(1).max(120),
    ruleVersion: z.string().min(1).max(80),
    effectiveFrom: localDateSchema,
    sources: z.array(trafficValueLossRuleSourceSchema).min(1).max(20),
  }),
  reportNote: z.string().min(1).max(MAX_TRAFFIC_VALUE_LOSS_REPORT_NOTE_LENGTH).nullable(),
})

export const trafficValueLossReportPreviewResponseSchema = z.strictObject({
  content: trafficValueLossReportContentSchema,
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewedAt: utcDateTimeSchema,
})

export const trafficValueLossReportSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  assessmentId: idSchema,
  assessmentVersionId: idSchema,
  assessmentVersion: z.number().int().min(1),
  status: z.literal('ready'),
  format: z.literal('pdf'),
  schemaVersion: z.literal(TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION),
  templateVersion: z.literal(TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION),
  ruleVersion: z.string().min(1).max(80),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  pdfHash: z.string().regex(/^[a-f0-9]{64}$/),
  pdfByteSize: z.number().int().min(1).max(10_000_000),
  content: trafficValueLossReportContentSchema,
  generatedBy: userIdSchema,
  generatedAt: utcDateTimeSchema,
  version: z.number().int().min(1),
})
export const trafficValueLossReportResponseSchema = z.strictObject({
  report: trafficValueLossReportSchema,
})
export const trafficValueLossReportsResponseSchema = z.strictObject({
  reports: z.array(trafficValueLossReportSchema),
})

export type TrafficValueLossReportPreviewRequest = z.infer<typeof trafficValueLossReportPreviewRequestSchema>
export type TrafficValueLossReportGenerateRequest = z.infer<typeof trafficValueLossReportGenerateRequestSchema>
export type TrafficValueLossReportContentDto = z.infer<typeof trafficValueLossReportContentSchema>
export type TrafficValueLossReportPreviewResponse = z.infer<typeof trafficValueLossReportPreviewResponseSchema>
export type TrafficValueLossReportDto = z.infer<typeof trafficValueLossReportSchema>
export type TrafficValueLossReportResponse = z.infer<typeof trafficValueLossReportResponseSchema>
export type TrafficValueLossReportsResponse = z.infer<typeof trafficValueLossReportsResponseSchema>
