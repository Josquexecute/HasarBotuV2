import { z } from 'zod'
import {
  LABOR_WORKBOOK_APPLY_CONFLICT_CODES,
  LABOR_WORKBOOK_APPLY_RULE_VERSION,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  relativePathSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { sha256HexSchema } from '../documents/dto.js'

export const LABOR_WORKBOOK_APPLY_STATUSES = [
  'preview_pending',
  'preview_ready',
  'approved',
  'applying',
  'completed',
  'control_required',
  'failed',
] as const
export const laborWorkbookApplyStatusSchema = z.enum(
  LABOR_WORKBOOK_APPLY_STATUSES,
)

export const laborWorkbookApplyCaseParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})
export const laborWorkbookApplyParamsSchema =
  laborWorkbookApplyCaseParamsSchema.extend({ operationId: idSchema })

export const laborWorkbookApplyPreviewRowSchema = z.strictObject({
  lineOrdinal: z.number().int().min(1).max(5_000),
  rowNumber: z.number().int().min(2).max(1_048_576),
  cell: z.string().regex(/^D(?:[2-9]|[1-9]\d{1,5}|10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6])$/),
  sourceRowHash: sha256HexSchema,
  partCode: z.string().min(1).max(120).nullable(),
  partName: z.string().min(1).max(200),
  operationType: z.string().min(1).max(120),
  previousValue: z.string().max(240).nullable(),
  newValue: z.string().min(1).max(240),
  valueSource: z.literal('approved_final'),
  manuallyModified: z.boolean(),
  matchConfidence: z.enum(['exact_source_row', 'control_required']),
  conflictCodes: z.array(z.enum(LABOR_WORKBOOK_APPLY_CONFLICT_CODES))
    .max(LABOR_WORKBOOK_APPLY_CONFLICT_CODES.length),
})

export const laborWorkbookApplySchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  applicationId: idSchema,
  revisionId: idSchema,
  revisionVersion: entityVersionSchema,
  profileId: idSchema,
  workbookReference: relativePathSchema,
  sheetName: z.string().min(1).max(120),
  status: laborWorkbookApplyStatusSchema,
  version: entityVersionSchema,
  ruleVersion: z.literal(LABOR_WORKBOOK_APPLY_RULE_VERSION),
  approvedRevisionSnapshotHash: sha256HexSchema,
  sourceWorkbookHash: sha256HexSchema.nullable(),
  planHash: sha256HexSchema.nullable(),
  resultWorkbookHash: sha256HexSchema.nullable(),
  backupReference: z.string().min(1).max(255).nullable(),
  previousTotalMinor: z.number().int().min(0).safe().nullable(),
  newTotalMinor: z.number().int().min(0).safe(),
  changedRowCount: z.number().int().min(0),
  unchangedRowCount: z.number().int().min(0),
  controlRequiredRowCount: z.number().int().min(0),
  rows: z.array(laborWorkbookApplyPreviewRowSchema).max(5_000),
  approvedByUserId: idSchema.nullable(),
  approvedAt: utcDateTimeSchema.nullable(),
  jobId: idSchema.nullable(),
  safeErrorCode: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/).nullable(),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const laborWorkbookApplyResponseSchema = z.strictObject({
  operation: laborWorkbookApplySchema,
  permissions: z.strictObject({
    canPreview: z.boolean(),
    canApprove: z.boolean(),
  }),
})

export const laborWorkbookAppliesResponseSchema = z.strictObject({
  operations: z.array(laborWorkbookApplySchema).max(100),
  permissions: z.strictObject({
    canPreview: z.boolean(),
    canApprove: z.boolean(),
  }),
})

export type LaborWorkbookApply = z.infer<typeof laborWorkbookApplySchema>
export type LaborWorkbookApplyResponse =
  z.infer<typeof laborWorkbookApplyResponseSchema>
export type LaborWorkbookAppliesResponse =
  z.infer<typeof laborWorkbookAppliesResponseSchema>
export type LaborWorkbookApplyStatus =
  z.infer<typeof laborWorkbookApplyStatusSchema>
