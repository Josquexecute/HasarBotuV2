import { z } from 'zod'
import { idSchema, relativePathSchema } from '../common/primitives.js'

export const folderRecoveryQuerySchema = z.strictObject({ search: z.string().trim().min(1).max(120) })
export const folderCheckSchema = z.strictObject({
  id: idSchema,
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  repaired: z.number().int().nonnegative().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
})
export const folderRecoveryResponseSchema = z.strictObject({
  items: z.array(z.strictObject({
    caseId: idSchema, plate: z.string(), officeNumber: z.string(),
    relativePath: relativePathSchema.nullable(),
    status: z.enum(['verified', 'needs_check', 'manually_archived']),
  })).max(50),
  latestCheck: folderCheckSchema.nullable(),
})
export type FolderRecoveryResponse = z.infer<typeof folderRecoveryResponseSchema>
export type FolderCheck = z.infer<typeof folderCheckSchema>

export const folderManagementQuerySchema = folderRecoveryQuerySchema.extend({
  includeRemoved: z.enum(['true', 'false']).default('false'),
})
export const folderManagementDecisionSchema = z.strictObject({
  action: z.enum(['remove', 'recover', 'dispute']),
  expectedVersion: z.number().int().positive(),
  expectedLocationVersion: z.number().int().positive().nullable(),
  reason: z.enum(['missing_folder', 'duplicate', 'wrong_link', 'other']),
  explanation: z.string().trim().min(3).max(1000),
})
export const folderManagementResponseSchema = z.strictObject({
  items: z.array(folderRecoveryResponseSchema.shape.items.element.extend({
    version: z.number().int().positive(),
    locationVersion: z.number().int().positive().nullable(),
    archived: z.boolean(),
    lifecycleStatus: z.enum(['open', 'closed']),
    caseType: z.enum(['traffic', 'casco']).nullable(),
    insurerClaimNumber: z.string().nullable(),
    lossDate: z.string().nullable(),
    storageRootKey: z.string().nullable(),
    sourceFolderId: z.string().nullable(),
    locationUpdatedAt: z.string().datetime().nullable(),
    disposition: z.enum(['removed', 'recovery_requested']).nullable(),
    explanation: z.string().nullable(),
    hasActiveOperations: z.boolean(),
    documentCount: z.number().int().nonnegative(),
    noteCount: z.number().int().nonnegative(),
  })).max(50),
  truncated: z.boolean(),
  latestCheck: folderCheckSchema.nullable(),
})
export type FolderManagementResponse = z.infer<typeof folderManagementResponseSchema>
export type FolderManagementDecision = z.infer<typeof folderManagementDecisionSchema>
