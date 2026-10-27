import { z } from 'zod'
import { idSchema, relativePathSchema, storageRootKeySchema } from '../common/primitives.js'

export const FIELD_PHOTO_MAX_BYTES = 40 * 1024 * 1024
export const FIELD_PHOTO_CHUNK_BYTES = 256 * 1024
export const FIELD_PHOTO_MIN_JPEG_BYTES = 100 * 1024
export const FIELD_PHOTO_MAX_JPEG_BYTES = 600 * 1024
export const fieldPhotoKindSchema = z.enum(['damage', 'chassis', 'odometer', 'gear'])
export type FieldPhotoKind = z.infer<typeof fieldPhotoKindSchema>
export const fieldUploadInitSchema = z.strictObject({
  clientKey: z.uuid(),
  fileName: z.string().min(1).max(240).refine(value => ![...value].some(char => char === '/' || char === '\\' || char.codePointAt(0)! < 32)),
  kind: fieldPhotoKindSchema,
  byteSize: z.number().int().min(1).max(FIELD_PHOTO_MAX_BYTES),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
})
export const fieldUploadSchema = z.strictObject({
  id: idSchema, caseId: idSchema, kind: fieldPhotoKindSchema,
  fileName: z.string(), byteSize: z.number().int().nonnegative(), receivedBytes: z.number().int().nonnegative(),
  status: z.enum(['receiving', 'queued', 'processing', 'ready', 'failed']),
  outputFileName: z.string().nullable(), outputBytes: z.number().int().nullable(),
  errorCode: z.string().nullable(), createdAt: z.string(), uploadedBy: z.string(), uploadedByUserId: idSchema,
})
export type FieldUpload = z.infer<typeof fieldUploadSchema>
export const fieldPhotoJobSchema = z.strictObject({
  id: idSchema, caseId: idSchema, kind: fieldPhotoKindSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().positive().max(FIELD_PHOTO_MAX_BYTES),
  storageRootKey: storageRootKeySchema, relativePath: relativePathSchema, leaseToken: z.uuid(),
  outputFileName: z.string().nullable(),
})
export type FieldPhotoJob = z.infer<typeof fieldPhotoJobSchema>
export const fieldPhotoResultSchema = z.strictObject({
  leaseToken: z.uuid(), fileName: z.string().regex(/^(HASAR [1-9]\d*|ŞASE(?: [1-9]\d*)?|KM(?: [1-9]\d*)?|VİTES(?: [1-9]\d*)?)\.jpg$/u),
  byteSize: z.number().int().min(FIELD_PHOTO_MIN_JPEG_BYTES).max(FIELD_PHOTO_MAX_JPEG_BYTES),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(), height: z.number().int().positive(),
})
