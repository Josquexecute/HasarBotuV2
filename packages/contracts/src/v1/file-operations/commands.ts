import { z } from 'zod'
import { entityVersionSchema, relativePathSchema, storageRootKeySchema } from '../../common/primitives.js'
import { fileOperationTypeSchema } from './dto.js'

export const fileOperationPlanRequestSchema = z.strictObject({
  operationType: fileOperationTypeSchema,
  destinationStorageRootKey: storageRootKeySchema,
  destinationRelativePath: relativePathSchema,
  expectedLocationVersion: entityVersionSchema,
})
export type FileOperationPlanRequest = z.infer<typeof fileOperationPlanRequestSchema>

export const fileOperationApproveRequestSchema = z.strictObject({ approved: z.literal(true) })
export type FileOperationApproveRequest = z.infer<typeof fileOperationApproveRequestSchema>

export const fileOperationCancelRequestSchema = z.strictObject({ cancelled: z.literal(true) })
export type FileOperationCancelRequest = z.infer<typeof fileOperationCancelRequestSchema>
