import { z } from 'zod'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  relativePathSchema,
  storageRootKeySchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { byteSizeSchema, sha256HexSchema } from '../documents/dto.js'

export const FILE_OPERATION_TYPES = ['rename_case_workspace', 'move_case_workspace'] as const
export type FileOperationType = (typeof FILE_OPERATION_TYPES)[number]
export const fileOperationTypeSchema = z.enum(FILE_OPERATION_TYPES)

export const FILE_OPERATION_STATUSES = [
  'planned',
  'approved',
  'queued',
  'applying',
  'verifying',
  'switching_location',
  'cleanup_pending',
  'ready',
  'failed',
  'stale',
  'cancelled',
  'manual_recovery_required',
] as const
export type FileOperationStatus = (typeof FILE_OPERATION_STATUSES)[number]
export const fileOperationStatusSchema = z.enum(FILE_OPERATION_STATUSES)

export const FILE_OPERATION_STRATEGIES = ['atomic_rename', 'staged_copy'] as const
export type FileOperationStrategy = (typeof FILE_OPERATION_STRATEGIES)[number]
export const fileOperationStrategySchema = z.enum(FILE_OPERATION_STRATEGIES)

export const FILE_OPERATION_CLEANUP_STATES = ['not_required', 'pending', 'completed', 'blocked'] as const
export type FileOperationCleanupState = (typeof FILE_OPERATION_CLEANUP_STATES)[number]
export const fileOperationCleanupStateSchema = z.enum(FILE_OPERATION_CLEANUP_STATES)

export const logicalStorageReferenceSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
})
export type LogicalStorageReference = z.infer<typeof logicalStorageReferenceSchema>

const safeReasonCodeSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/)
const safeCountSchema = z.number().int().min(0)

export const fileOperationSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  operationType: fileOperationTypeSchema,
  source: logicalStorageReferenceSchema,
  destination: logicalStorageReferenceSchema,
  expectedLocationVersion: entityVersionSchema,
  status: fileOperationStatusSchema,
  strategy: fileOperationStrategySchema,
  manifestHash: sha256HexSchema.nullable(),
  fileCount: safeCountSchema.nullable(),
  directoryCount: safeCountSchema.nullable(),
  totalBytes: byteSizeSchema.nullable(),
  cleanupState: fileOperationCleanupStateSchema,
  failureReasonCode: safeReasonCodeSchema.nullable(),
  version: entityVersionSchema,
  canApprove: z.boolean(),
  canCancel: z.boolean(),
  approvedAt: utcDateTimeSchema.nullable(),
  finalizedAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})
export type FileOperation = z.infer<typeof fileOperationSchema>

export const fileOperationResponseSchema = z.strictObject({ operation: fileOperationSchema })
export type FileOperationResponse = z.infer<typeof fileOperationResponseSchema>

export const fileOperationPlanParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const fileOperationParamsSchema = z.strictObject({ caseId: caseIdSchema, operationId: idSchema })
export type FileOperationPlanParams = z.infer<typeof fileOperationPlanParamsSchema>
export type FileOperationParams = z.infer<typeof fileOperationParamsSchema>
