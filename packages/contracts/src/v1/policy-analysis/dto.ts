import { z } from 'zod'
import {
  MAX_POLICY_EXCERPT_LENGTH,
  POLICY_ANALYSIS_STATUSES,
  POLICY_CONFLICT_RESOLUTION_STATUSES,
  POLICY_COVERAGE_TYPES,
  POLICY_SCENARIO_RESULTS,
  POLICY_SCENARIO_TYPES,
  POLICY_SOURCE_TYPES,
  SERVICE_TYPES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  insurerIdSchema,
  localDateSchema,
  utcDateTimeSchema,
  userIdSchema,
} from '../../common/primitives.js'

export const policyAnalysisStatusSchema = z.enum(POLICY_ANALYSIS_STATUSES)
export const policySourceTypeSchema = z.enum(POLICY_SOURCE_TYPES)
export const policyCoverageTypeSchema = z.enum(POLICY_COVERAGE_TYPES)
export const policyScenarioTypeSchema = z.enum(POLICY_SCENARIO_TYPES)
export const policyScenarioResultCodeSchema = z.enum(POLICY_SCENARIO_RESULTS)
export const policyConflictResolutionStatusSchema = z.enum(POLICY_CONFLICT_RESOLUTION_STATUSES)
export const policySourceCompletenessSchema = z.enum(['complete', 'partial', 'unknown'])
export const policyHumanApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export const policyConfidenceSchema = z.number().min(0).max(1)
export const policyTextSchema = z.string().trim().min(1).max(2_000)
export const policyShortTextSchema = z.string().trim().min(1).max(300)
export const policyCodeSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/)

export const policySourceReferenceSchema = z.strictObject({
  id: idSchema,
  documentId: idSchema,
  documentVersionId: idSchema,
  pageNumber: z.number().int().min(1).max(10_000),
  sectionHeading: policyShortTextSchema,
  clauseIdentifier: policyShortTextSchema,
  rawExcerpt: z.string().trim().min(1).max(MAX_POLICY_EXCERPT_LENGTH),
  excerptHash: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().trim().min(1).max(300).nullable(),
  sourceType: policySourceTypeSchema,
  confidence: policyConfidenceSchema,
})
export type PolicySourceReferenceDto = z.infer<typeof policySourceReferenceSchema>

export const policyLimitSchema = z.strictObject({
  type: z.enum(['none', 'amount', 'percentage', 'event_count', 'duration', 'other']),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/).nullable(),
  sublimit: z.number().nonnegative().nullable(),
  waitingPeriodDays: z.number().int().nonnegative().nullable(),
  geographicScope: z.string().trim().min(1).max(300).nullable(),
})

export const policyCoverageSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  canonicalType: policyCoverageTypeSchema,
  originalHeading: policyShortTextSchema,
  originalWording: policyTextSchema,
  inclusion: z.enum(['included', 'excluded', 'conditional', 'unknown']),
  limit: policyLimitSchema.nullable(),
  conditions: z.array(policyShortTextSchema).max(50),
  exceptions: z.array(policyShortTextSchema).max(50),
  requiredDocuments: z.array(policyCodeSchema).max(50),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
})
export type PolicyCoverageDto = z.infer<typeof policyCoverageSchema>

export const policyDeductibleSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  type: z.enum([
    'general', 'conditional', 'uncontracted_service', 'unauthorized_service', 'glass_service',
    'key_theft', 'previous_total_loss', 'betterment', 'age_usage', 'driver_condition',
    'geographic', 'part_difference', 'claim_count', 'other',
  ]),
  trigger: policyShortTextSchema,
  conditions: z.array(policyShortTextSchema).max(50),
  calculationType: z.enum(['fixed', 'percentage', 'share', 'conditional', 'unknown']),
  fixedAmount: z.number().nonnegative().nullable(),
  percentage: z.number().min(0).max(100).nullable(),
  minimumAmount: z.number().nonnegative().nullable(),
  maximumAmount: z.number().nonnegative().nullable(),
  insurerShare: z.number().min(0).max(100).nullable(),
  insuredShare: z.number().min(0).max(100).nullable(),
  affectedCoverage: policyCoverageTypeSchema.nullable(),
  affectedRepairMethod: z.string().trim().min(1).max(100).nullable(),
  affectedServiceType: z.enum(SERVICE_TYPES).nullable(),
  affectedPartRule: z.string().trim().min(1).max(100).nullable(),
  exception: policyShortTextSchema.nullable(),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
  approvalStatus: z.enum(['unreviewed', 'approved', 'rejected']),
})
export type PolicyDeductibleDto = z.infer<typeof policyDeductibleSchema>

export const policyServiceRuleSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  authorizedServiceRequirement: z.boolean().nullable(),
  insurerContractedServiceRequirement: z.boolean().nullable(),
  serviceFreedom: z.enum(['free', 'restricted', 'conditional', 'unknown']),
  glassNetwork: policyShortTextSchema.nullable(),
  mobileRepairRestriction: policyShortTextSchema.nullable(),
  miniRepairRestriction: policyShortTextSchema.nullable(),
  towingDestination: policyShortTextSchema.nullable(),
  laborRestriction: policyShortTextSchema.nullable(),
  condition: policyShortTextSchema.nullable(),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
})
export type PolicyServiceRuleDto = z.infer<typeof policyServiceRuleSchema>

export const policyPartRuleSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  allowedPartTypes: z.array(z.enum(['original', 'equivalent', 'aftermarket', 'used'])).min(1),
  procurementRule: policyShortTextSchema.nullable(),
  repairVsReplacementCondition: policyShortTextSchema.nullable(),
  bettermentCondition: policyShortTextSchema.nullable(),
  condition: policyShortTextSchema.nullable(),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
})
export type PolicyPartRuleDto = z.infer<typeof policyPartRuleSchema>

export const policyReplacementVehicleRuleSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  available: z.enum(['yes', 'no', 'conditional', 'unknown']),
  vehicleClass: z.string().trim().min(1).max(100).nullable(),
  duration: z.string().trim().min(1).max(100).nullable(),
  maximumDays: z.number().int().nonnegative().nullable(),
  eventLimit: z.number().int().nonnegative().nullable(),
  waitingPeriodDays: z.number().int().nonnegative().nullable(),
  serviceCondition: policyShortTextSchema.nullable(),
  exclusions: z.array(policyShortTextSchema).max(50),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
})
export type PolicyReplacementVehicleRuleDto = z.infer<typeof policyReplacementVehicleRuleSchema>

export const policyExclusionSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  originalWording: policyTextSchema,
  trigger: policyShortTextSchema,
  affectedCoverage: policyCoverageTypeSchema.nullable(),
  exceptionToExclusion: policyShortTextSchema.nullable(),
  requiredDocuments: z.array(policyCodeSchema).max(50),
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
})
export type PolicyExclusionDto = z.infer<typeof policyExclusionSchema>

export const policyRequiredDocumentSchema = z.strictObject({
  id: idSchema,
  code: policyCodeSchema,
  description: policyShortTextSchema,
  trigger: policyShortTextSchema.nullable(),
  sourceReferenceIds: z.array(idSchema).min(1),
})

export const policyRuleConditionSchema = z.strictObject({
  field: z.enum(['damageCategory', 'repairMethod', 'requestedOperation', 'serviceType', 'insurerAgreementStatus', 'documentState']),
  operator: z.enum(['equals', 'not_equals', 'in']),
  value: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(20)]),
})

export const policyScenarioRuleSchema = z.strictObject({
  id: idSchema,
  ruleId: policyCodeSchema,
  ruleVersion: z.string().trim().min(1).max(64),
  scenarioType: policyScenarioTypeSchema,
  trigger: policyShortTextSchema,
  conditions: z.array(policyRuleConditionSchema).max(30),
  coverageOutcome: z.enum(['covered', 'excluded', 'conditional', 'unknown']),
  coverageCode: policyCodeSchema.nullable(),
  deductibleCodes: z.array(policyCodeSchema).max(30),
  limit: policyShortTextSchema.nullable(),
  exception: policyShortTextSchema.nullable(),
  requiredDocuments: z.array(policyCodeSchema).max(50),
  serviceCondition: policyShortTextSchema.nullable(),
  partCondition: policyShortTextSchema.nullable(),
  action: policyShortTextSchema,
  sourceReferenceIds: z.array(idSchema).min(1),
  confidence: policyConfidenceSchema,
  humanApprovalRequired: z.boolean(),
  precedence: z.number().int().min(0).max(10_000),
  effectiveFrom: localDateSchema.nullable(),
  effectiveTo: localDateSchema.nullable(),
})
export type PolicyScenarioRuleDto = z.infer<typeof policyScenarioRuleSchema>

export const policyConflictSchema = z.strictObject({
  id: idSchema,
  conflictType: z.string().trim().min(1).max(100),
  affectedTopic: z.string().trim().min(1).max(100),
  sourceAId: idSchema,
  sourceBId: idSchema,
  explanation: policyShortTextSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  resolutionStatus: policyConflictResolutionStatusSchema,
  resolvedBy: userIdSchema.nullable(),
  resolvedAt: utcDateTimeSchema.nullable(),
  resolutionReason: policyShortTextSchema.nullable(),
  version: entityVersionSchema,
})
export type PolicyConflictDto = z.infer<typeof policyConflictSchema>

export const policyAnalysisVersionSchema = z.strictObject({
  id: idSchema,
  analysisVersion: z.number().int().min(1),
  analysisStatus: policyAnalysisStatusSchema,
  sourceDocumentId: idSchema,
  sourceDocumentVersionId: idSchema,
  policyNumber: z.string().trim().min(1).max(128).nullable(),
  endorsementNumber: z.string().trim().min(1).max(128).nullable(),
  productName: z.string().trim().min(1).max(200).nullable(),
  productType: z.string().trim().min(1).max(100).nullable(),
  insurerFormat: z.string().trim().min(1).max(100).nullable(),
  policyStartDate: localDateSchema.nullable(),
  policyEndDate: localDateSchema.nullable(),
  issueDate: localDateSchema.nullable(),
  insuredVehicleReference: z.string().trim().min(1).max(128).nullable(),
  sourceCompleteness: policySourceCompletenessSchema,
  humanApprovalStatus: policyHumanApprovalStatusSchema,
  approvedBy: userIdSchema.nullable(),
  approvedAt: utcDateTimeSchema.nullable(),
  isActive: z.boolean(),
  version: entityVersionSchema,
  createdAt: utcDateTimeSchema,
  sourceReferences: z.array(policySourceReferenceSchema),
  coverages: z.array(policyCoverageSchema),
  deductibles: z.array(policyDeductibleSchema),
  serviceRules: z.array(policyServiceRuleSchema),
  partRules: z.array(policyPartRuleSchema),
  replacementVehicleRules: z.array(policyReplacementVehicleRuleSchema),
  exclusions: z.array(policyExclusionSchema),
  requiredDocuments: z.array(policyRequiredDocumentSchema),
  scenarioRules: z.array(policyScenarioRuleSchema),
  conflicts: z.array(policyConflictSchema),
})
export type PolicyAnalysisVersionDto = z.infer<typeof policyAnalysisVersionSchema>

export const policyAnalysisSummarySchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  insurerId: insurerIdSchema.nullable(),
  sourceDocumentId: idSchema,
  sourceDocumentVersionId: idSchema,
  currentAnalysisVersion: z.number().int().min(1),
  currentStatus: policyAnalysisStatusSchema,
  version: entityVersionSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})
export type PolicyAnalysisSummaryDto = z.infer<typeof policyAnalysisSummarySchema>

export const policyAnalysisDetailSchema = policyAnalysisSummarySchema.extend({ currentVersion: policyAnalysisVersionSchema })
export type PolicyAnalysisDetailDto = z.infer<typeof policyAnalysisDetailSchema>

export const policyAnalysesListResponseSchema = z.strictObject({ items: z.array(policyAnalysisSummarySchema) })
export const policyAnalysisResponseSchema = z.strictObject({ analysis: policyAnalysisDetailSchema })
export const policyAnalysisVersionsResponseSchema = z.strictObject({ versions: z.array(policyAnalysisVersionSchema) })
export const policyConflictsResponseSchema = z.strictObject({ items: z.array(policyConflictSchema) })

export const policyAnalysisParamsSchema = z.strictObject({ caseId: caseIdSchema, analysisId: idSchema })
export const policyCaseParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const policyConflictParamsSchema = z.strictObject({ caseId: caseIdSchema, conflictId: idSchema })

export const policyOperationalRecommendationSchema = z.strictObject({
  procurementStatus: z.enum(['continue', 'pause', 'control_required']),
  mobileRepairStatus: z.enum(['continue', 'pause', 'control_required']),
  caseOwnerNotificationRequired: z.boolean(),
  serviceNotificationRequired: z.boolean(),
  availableAlternatives: z.array(z.string()),
  sourceReferences: z.array(policySourceReferenceSchema),
  approvalRequired: z.boolean(),
})

export const policyScenarioEvaluationSchema = z.strictObject({
  evaluationId: idSchema,
  analysisId: idSchema,
  evaluatedAt: utcDateTimeSchema,
  result: policyScenarioResultCodeSchema,
  reasoning: z.array(z.string()),
  applicableCoverage: z.array(z.string()),
  deductibles: z.array(policyDeductibleSchema),
  limit: z.string().nullable(),
  insuredShare: z.number().min(0).max(100).nullable(),
  insurerShare: z.number().min(0).max(100).nullable(),
  serviceCondition: z.array(z.string()),
  partCondition: z.array(z.string()),
  requiredAction: z.array(z.string()),
  requiredDocuments: z.array(z.string()),
  sourceReferences: z.array(policySourceReferenceSchema),
  conflicts: z.array(policyConflictSchema),
  missingInformation: z.array(z.string()),
  confidence: policyConfidenceSchema,
  humanApprovalRequired: z.boolean(),
  policyAnalysisVersion: z.number().int().min(1),
  ruleVersion: z.string().min(1).max(64),
  operationalRecommendation: policyOperationalRecommendationSchema,
})
export const policyScenarioEvaluationResponseSchema = z.strictObject({ evaluation: policyScenarioEvaluationSchema })
export type PolicyScenarioEvaluationDto = z.infer<typeof policyScenarioEvaluationSchema>
