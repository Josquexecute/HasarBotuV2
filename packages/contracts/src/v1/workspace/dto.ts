import { z } from 'zod'
import { CASE_WORKSPACE_SUBDIRECTORIES } from '@hasarbotu/domain'
import { caseIdSchema, idSchema, relativePathSchema, storageRootKeySchema, utcDateTimeSchema } from '../../common/primitives.js'

export const WORKSPACE_PROVISIONING_STATUSES = [
  'planned',
  'approved',
  'queued',
  'applying',
  'verifying',
  'ready',
  'failed',
  'cancelled',
  'stale',
] as const
export type WorkspaceProvisioningStatus = (typeof WORKSPACE_PROVISIONING_STATUSES)[number]
export const workspaceProvisioningStatusSchema = z.enum(WORKSPACE_PROVISIONING_STATUSES)

export const caseWorkspaceSubdirectoriesSchema = z.tuple(
  CASE_WORKSPACE_SUBDIRECTORIES.map((name) => z.literal(name)) as [
    z.ZodLiteral<'EVRAK'>,
    z.ZodLiteral<'HASAR'>,
    z.ZodLiteral<'OLAY YERİ'>,
    z.ZodLiteral<'ONARIM'>,
    z.ZodLiteral<'DEĞER KAYBI'>,
  ],
)

export const workspaceProvisioningSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  status: workspaceProvisioningStatusSchema,
  requiredSubdirectories: caseWorkspaceSubdirectoriesSchema,
  lastErrorCode: z.string().min(1).max(64).nullable(),
  canApprove: z.boolean(),
  canRetry: z.boolean(),
  approvedAt: utcDateTimeSchema.nullable(),
  readyAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})
export type WorkspaceProvisioning = z.infer<typeof workspaceProvisioningSchema>

export const workspaceProvisioningResponseSchema = z.strictObject({
  provisioning: workspaceProvisioningSchema,
})
export type WorkspaceProvisioningResponse = z.infer<typeof workspaceProvisioningResponseSchema>

export const workspacePlanParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const workspaceProvisioningParamsSchema = z.strictObject({ caseId: caseIdSchema, planId: idSchema })
export type WorkspacePlanParams = z.infer<typeof workspacePlanParamsSchema>
export type WorkspaceProvisioningParams = z.infer<typeof workspaceProvisioningParamsSchema>
