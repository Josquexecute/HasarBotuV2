import { z } from 'zod'
import {
  CASE_LIFECYCLE_OPERATION_STATUSES,
  CASE_LIFECYCLE_OPERATION_TYPES,
  CLOSURE_REQUIREMENT_STATUSES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  caseStageSchema,
  caseStatusSchema,
  entityVersionSchema,
  idSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { requirementStatusSchema } from '../document-requirements/index.js'
import { logicalStorageReferenceSchema, fileOperationStatusSchema } from '../file-operations/index.js'
import { closeModeSchema } from './commands.js'

export const lifecycleOperationTypeSchema = z.enum(CASE_LIFECYCLE_OPERATION_TYPES)
export const lifecycleOperationStatusSchema = z.enum(CASE_LIFECYCLE_OPERATION_STATUSES)
export const closureRequirementStatusSchema = z.enum(CLOSURE_REQUIREMENT_STATUSES)

export const lifecycleRequirementItemSchema = z.strictObject({
  requirementCode: z.string().min(1).max(100),
  sourceType: z.enum(['document', 'photo']),
  canonicalType: z.string().min(1).max(100),
  status: closureRequirementStatusSchema,
  reason: z.string().min(1).max(500),
  matchedMetadataIds: z.array(idSchema),
  relatedMetadataStatuses: z.array(z.strictObject({
    metadataId: idSchema,
    status: z.enum(['pending', 'ready', 'failed', 'missing']),
  })),
  requiresHumanReview: z.boolean(),
})

export const lifecycleRequirementSummarySchema = z.strictObject({
  documentRuleVersion: z.string().min(1).max(64),
  documentOverallStatus: requirementStatusSchema,
  closureRuleVersion: z.string().min(1).max(64),
  missingCount: z.number().int().min(0),
  controlRequiredCount: z.number().int().min(0),
  requirements: z.array(lifecycleRequirementItemSchema),
})

export const linkedFileOperationSchema = z.strictObject({
  id: idSchema,
  status: fileOperationStatusSchema,
}).nullable()

export const caseLifecycleOperationSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  operationType: lifecycleOperationTypeSchema,
  status: lifecycleOperationStatusSchema,
  version: entityVersionSchema,
  expectedCaseVersion: entityVersionSchema,
  expectedLocationVersion: entityVersionSchema,
  source: logicalStorageReferenceSchema,
  destination: logicalStorageReferenceSchema,
  closeMode: closeModeSchema.nullable(),
  reason: z.string().min(1).max(500).nullable(),
  previousLifecycleStatus: caseStatusSchema,
  targetLifecycleStatus: caseStatusSchema,
  previousWorkflowStage: caseStageSchema,
  targetWorkflowStage: caseStageSchema,
  requirementSummary: lifecycleRequirementSummarySchema,
  blockers: z.array(z.string().min(1).max(100)),
  warnings: z.array(z.string().min(1).max(100)),
  linkedFileOperation: linkedFileOperationSchema,
  failureReasonCode: z.string().min(1).max(100).nullable(),
  canApprove: z.boolean(),
  canCancel: z.boolean(),
  approvedAt: utcDateTimeSchema.nullable(),
  finalizedAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const caseLifecycleOperationResponseSchema = z.strictObject({ operation: caseLifecycleOperationSchema })
export const caseLifecycleOperationsResponseSchema = z.strictObject({ items: z.array(caseLifecycleOperationSchema) })
export const lifecycleCaseParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const lifecycleOperationParamsSchema = z.strictObject({ caseId: caseIdSchema, operationId: idSchema })

export type LifecycleRequirementItem = z.infer<typeof lifecycleRequirementItemSchema>
export type LifecycleRequirementSummary = z.infer<typeof lifecycleRequirementSummarySchema>
export type CaseLifecycleOperation = z.infer<typeof caseLifecycleOperationSchema>
export type CaseLifecycleOperationResponse = z.infer<typeof caseLifecycleOperationResponseSchema>
export type CaseLifecycleOperationsResponse = z.infer<typeof caseLifecycleOperationsResponseSchema>
export type LifecycleCaseParams = z.infer<typeof lifecycleCaseParamsSchema>
export type LifecycleOperationParams = z.infer<typeof lifecycleOperationParamsSchema>
