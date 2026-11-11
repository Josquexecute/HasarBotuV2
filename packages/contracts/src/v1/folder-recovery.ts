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
