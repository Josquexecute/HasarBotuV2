import { z } from 'zod'
import {
  entityVersionSchema,
  idSchema,
  insurerIdSchema,
  localDateSchema,
} from '../../common/primitives.js'
import {
  policyCodeSchema,
  policyConfidenceSchema,
  policyCoverageTypeSchema,
  policyLimitSchema,
  policyRuleConditionSchema,
  policyScenarioTypeSchema,
  policyShortTextSchema,
  policySourceCompletenessSchema,
  policySourceTypeSchema,
  policyTextSchema,
} from './dto.js'
import { SERVICE_TYPES } from '@hasarbotu/domain'

const sourceKeySchema = policyCodeSchema
export const policyExtractionLocatorInputSchema = z.strictObject({
  extractionId: idSchema,
  pageId: idSchema,
  segmentId: idSchema.nullable().default(null),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
}).superRefine((value, context) => {
  if (value.endOffset <= value.startOffset) context.addIssue({ code: 'custom', path: ['endOffset'], message: 'invalid_offset_range' })
})
export const policySourceReferenceInputSchema = z.strictObject({
  sourceKey: sourceKeySchema,
  documentId: idSchema,
  documentVersionId: idSchema,
  pageNumber: z.number().int().min(1).max(10_000),
  sectionHeading: policyShortTextSchema,
  clauseIdentifier: policyShortTextSchema,
  rawExcerpt: z.string().trim().min(1).max(1_000),
  locator: z.string().trim().min(1).max(300).nullable().default(null),
  sourceType: policySourceTypeSchema,
  confidence: policyConfidenceSchema,
  extractionLocator: policyExtractionLocatorInputSchema.nullable().default(null),
})

const evidenceKeysSchema = z.array(sourceKeySchema).min(1).max(20)

export const policyCoverageInputSchema = z.strictObject({
  code: policyCodeSchema,
  canonicalType: policyCoverageTypeSchema,
  originalHeading: policyShortTextSchema,
  originalWording: policyTextSchema,
  inclusion: z.enum(['included', 'excluded', 'conditional', 'unknown']),
  limit: policyLimitSchema.nullable().default(null),
  conditions: z.array(policyShortTextSchema).max(50).default([]),
  exceptions: z.array(policyShortTextSchema).max(50).default([]),
  requiredDocuments: z.array(policyCodeSchema).max(50).default([]),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
})

export const policyDeductibleInputSchema = z.strictObject({
  code: policyCodeSchema,
  type: z.enum(['general', 'conditional', 'uncontracted_service', 'unauthorized_service', 'glass_service', 'key_theft', 'previous_total_loss', 'betterment', 'age_usage', 'driver_condition', 'geographic', 'part_difference', 'claim_count', 'other']),
  trigger: policyShortTextSchema,
  conditions: z.array(policyShortTextSchema).max(50).default([]),
  calculationType: z.enum(['fixed', 'percentage', 'share', 'conditional', 'unknown']),
  fixedAmount: z.number().nonnegative().nullable().default(null),
  percentage: z.number().min(0).max(100).nullable().default(null),
  minimumAmount: z.number().nonnegative().nullable().default(null),
  maximumAmount: z.number().nonnegative().nullable().default(null),
  insurerShare: z.number().min(0).max(100).nullable().default(null),
  insuredShare: z.number().min(0).max(100).nullable().default(null),
  affectedCoverage: policyCoverageTypeSchema.nullable().default(null),
  affectedRepairMethod: z.string().trim().min(1).max(100).nullable().default(null),
  affectedServiceType: z.enum(SERVICE_TYPES).nullable().default(null),
  affectedPartRule: z.string().trim().min(1).max(100).nullable().default(null),
  exception: policyShortTextSchema.nullable().default(null),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
  approvalStatus: z.enum(['unreviewed', 'approved', 'rejected']).default('unreviewed'),
})

export const policyServiceRuleInputSchema = z.strictObject({
  code: policyCodeSchema,
  authorizedServiceRequirement: z.boolean().nullable().default(null),
  insurerContractedServiceRequirement: z.boolean().nullable().default(null),
  serviceFreedom: z.enum(['free', 'restricted', 'conditional', 'unknown']),
  glassNetwork: policyShortTextSchema.nullable().default(null),
  mobileRepairRestriction: policyShortTextSchema.nullable().default(null),
  miniRepairRestriction: policyShortTextSchema.nullable().default(null),
  towingDestination: policyShortTextSchema.nullable().default(null),
  laborRestriction: policyShortTextSchema.nullable().default(null),
  condition: policyShortTextSchema.nullable().default(null),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
})

export const policyPartRuleInputSchema = z.strictObject({
  code: policyCodeSchema,
  allowedPartTypes: z.array(z.enum(['original', 'equivalent', 'aftermarket', 'used'])).min(1),
  procurementRule: policyShortTextSchema.nullable().default(null),
  repairVsReplacementCondition: policyShortTextSchema.nullable().default(null),
  bettermentCondition: policyShortTextSchema.nullable().default(null),
  condition: policyShortTextSchema.nullable().default(null),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
})

export const policyReplacementVehicleRuleInputSchema = z.strictObject({
  code: policyCodeSchema,
  available: z.enum(['yes', 'no', 'conditional', 'unknown']),
  vehicleClass: z.string().trim().min(1).max(100).nullable().default(null),
  duration: z.string().trim().min(1).max(100).nullable().default(null),
  maximumDays: z.number().int().nonnegative().nullable().default(null),
  eventLimit: z.number().int().nonnegative().nullable().default(null),
  waitingPeriodDays: z.number().int().nonnegative().nullable().default(null),
  serviceCondition: policyShortTextSchema.nullable().default(null),
  exclusions: z.array(policyShortTextSchema).max(50).default([]),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
})

export const policyExclusionInputSchema = z.strictObject({
  code: policyCodeSchema,
  originalWording: policyTextSchema,
  trigger: policyShortTextSchema,
  affectedCoverage: policyCoverageTypeSchema.nullable().default(null),
  exceptionToExclusion: policyShortTextSchema.nullable().default(null),
  requiredDocuments: z.array(policyCodeSchema).max(50).default([]),
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
})

export const policyRequiredDocumentInputSchema = z.strictObject({
  code: policyCodeSchema,
  description: policyShortTextSchema,
  trigger: policyShortTextSchema.nullable().default(null),
  sourceKeys: evidenceKeysSchema,
})

export const policyScenarioRuleInputSchema = z.strictObject({
  ruleId: policyCodeSchema,
  ruleVersion: z.string().trim().min(1).max(64),
  scenarioType: policyScenarioTypeSchema,
  trigger: policyShortTextSchema,
  conditions: z.array(policyRuleConditionSchema).max(30).default([]),
  coverageOutcome: z.enum(['covered', 'excluded', 'conditional', 'unknown']),
  coverageCode: policyCodeSchema.nullable().default(null),
  deductibleCodes: z.array(policyCodeSchema).max(30).default([]),
  limit: policyShortTextSchema.nullable().default(null),
  exception: policyShortTextSchema.nullable().default(null),
  requiredDocuments: z.array(policyCodeSchema).max(50).default([]),
  serviceCondition: policyShortTextSchema.nullable().default(null),
  partCondition: policyShortTextSchema.nullable().default(null),
  action: policyShortTextSchema,
  sourceKeys: evidenceKeysSchema,
  confidence: policyConfidenceSchema,
  humanApprovalRequired: z.boolean().default(true),
  precedence: z.number().int().min(0).max(10_000),
  effectiveFrom: localDateSchema.nullable().default(null),
  effectiveTo: localDateSchema.nullable().default(null),
})

export const policyConflictInputSchema = z.strictObject({
  conflictType: z.string().trim().min(1).max(100),
  affectedTopic: z.string().trim().min(1).max(100),
  sourceAKey: sourceKeySchema,
  sourceBKey: sourceKeySchema,
  explanation: policyShortTextSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
})

export const policyAnalysisVersionPayloadSchema = z.strictObject({
  sourceDocumentId: idSchema,
  sourceDocumentVersionId: idSchema,
  insurerId: insurerIdSchema.nullable().default(null),
  policyNumber: z.string().trim().min(1).max(128).nullable().default(null),
  endorsementNumber: z.string().trim().min(1).max(128).nullable().default(null),
  productName: z.string().trim().min(1).max(200).nullable().default(null),
  productType: z.string().trim().min(1).max(100).nullable().default(null),
  insurerFormat: z.string().trim().min(1).max(100).nullable().default(null),
  policyStartDate: localDateSchema.nullable().default(null),
  policyEndDate: localDateSchema.nullable().default(null),
  issueDate: localDateSchema.nullable().default(null),
  insuredVehicleReference: z.string().trim().min(1).max(128).nullable().default(null),
  sourceCompleteness: policySourceCompletenessSchema,
  initialStatus: z.enum(['draft', 'extracted', 'control_required', 'awaiting_approval']).default('draft'),
  sourceReferences: z.array(policySourceReferenceInputSchema).min(1).max(500),
  coverages: z.array(policyCoverageInputSchema).max(200).default([]),
  deductibles: z.array(policyDeductibleInputSchema).max(200).default([]),
  serviceRules: z.array(policyServiceRuleInputSchema).max(100).default([]),
  partRules: z.array(policyPartRuleInputSchema).max(100).default([]),
  replacementVehicleRules: z.array(policyReplacementVehicleRuleInputSchema).max(50).default([]),
  exclusions: z.array(policyExclusionInputSchema).max(200).default([]),
  requiredDocuments: z.array(policyRequiredDocumentInputSchema).max(100).default([]),
  scenarioRules: z.array(policyScenarioRuleInputSchema).max(500).default([]),
  conflicts: z.array(policyConflictInputSchema).max(100).default([]),
}).superRefine((value, context) => {
  if (value.policyStartDate !== null && value.policyEndDate !== null && value.policyEndDate < value.policyStartDate) {
    context.addIssue({ code: 'custom', path: ['policyEndDate'], message: 'invalid_effective_range' })
  }
  const keys = new Set(value.sourceReferences.map((item) => item.sourceKey))
  const used = [
    ...value.coverages, ...value.deductibles, ...value.serviceRules, ...value.partRules,
    ...value.replacementVehicleRules, ...value.exclusions, ...value.requiredDocuments, ...value.scenarioRules,
  ].flatMap((item) => item.sourceKeys)
  for (const key of [...used, ...value.conflicts.flatMap((item) => [item.sourceAKey, item.sourceBKey])]) {
    if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['sourceReferences'], message: 'unknown_source_key' })
  }
})

export const policyAnalysisCreateRequestSchema = policyAnalysisVersionPayloadSchema
export const policyAnalysisVersionCreateRequestSchema = policyAnalysisVersionPayloadSchema.extend({ expectedVersion: entityVersionSchema })
export const policyAnalysisApprovalRequestSchema = z.strictObject({ expectedVersion: entityVersionSchema, reason: z.string().trim().min(1).max(500).nullable().default(null) })
export const policyAnalysisRejectRequestSchema = z.strictObject({ expectedVersion: entityVersionSchema, reason: z.string().trim().min(1).max(500) })
export const policyConflictResolutionRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  resolutionStatus: z.enum(['resolved_source_a', 'resolved_source_b', 'resolved_manual', 'not_applicable']),
  resolutionReason: z.string().trim().min(1).max(500),
})

export const policyScenarioEvaluateRequestSchema = z.strictObject({
  analysisId: idSchema,
  policyAnalysisVersion: z.number().int().min(1),
  scenarioType: policyScenarioTypeSchema,
  damageCategory: z.string().trim().min(1).max(100).nullable().default(null),
  repairMethod: z.string().trim().min(1).max(100).nullable().default(null),
  requestedOperation: z.string().trim().min(1).max(100),
  documentState: z.enum(['verified', 'unverified', 'missing']),
})

export type PolicyAnalysisCreateRequest = z.infer<typeof policyAnalysisCreateRequestSchema>
export type PolicyAnalysisVersionCreateRequest = z.infer<typeof policyAnalysisVersionCreateRequestSchema>
export type PolicyAnalysisApprovalRequest = z.infer<typeof policyAnalysisApprovalRequestSchema>
export type PolicyAnalysisRejectRequest = z.infer<typeof policyAnalysisRejectRequestSchema>
export type PolicyConflictResolutionRequest = z.infer<typeof policyConflictResolutionRequestSchema>
export type PolicyScenarioEvaluateRequest = z.infer<typeof policyScenarioEvaluateRequestSchema>
