import { z } from 'zod'
import {
  caseIdSchema,
  idSchema,
  relativePathSchema,
  storageRootKeySchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { pageInfoSchema } from '../../common/pagination.js'

/**
 * Konum doğrulama durumu (File Agent tarafından güncellenir; bu pakette yalniz
 * atama sonrasi `pending` uretilir): fiziksel varlik henuz dogrulanmadi /
 * dogrulandi / bulunamadi.
 */
export const LOCATION_VERIFICATION_STATUSES = ['pending', 'verified', 'missing'] as const
export type LocationVerificationStatus = (typeof LOCATION_VERIFICATION_STATUSES)[number]
export const locationVerificationStatusSchema = z.enum(LOCATION_VERIFICATION_STATUSES)

/** Konumun kaynagi: kullanici (manuel), sistem atamasi veya V1 aktarimi. */
export const LOCATION_SOURCES = ['manual', 'system', 'imported'] as const
export type LocationSource = (typeof LOCATION_SOURCES)[number]
export const locationSourceSchema = z.enum(LOCATION_SOURCES)

/** Mantiksal depolama kok tanimi (org bazli). Mutlak yol ASLA tasinmaz. */
export const storageRootSchema = z.strictObject({
  rootKey: storageRootKeySchema,
  label: z.string().min(1).max(200),
  isActive: z.boolean(),
})
export type StorageRoot = z.infer<typeof storageRootSchema>

export const storageRootsResponseSchema = z.strictObject({
  items: z.array(storageRootSchema),
})
export type StorageRootsResponse = z.infer<typeof storageRootsResponseSchema>

/** Vaka güncel konumu. Yalniz rootKey + göreli yol; mutlak yol yoktur. */
export const caseLocationSchema = z.strictObject({
  caseId: caseIdSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  verificationStatus: locationVerificationStatusSchema,
  source: locationSourceSchema,
  version: z.number().int().min(1),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})
export type CaseLocation = z.infer<typeof caseLocationSchema>

export const caseLocationResponseSchema = z.strictObject({
  location: caseLocationSchema,
})
export type CaseLocationResponse = z.infer<typeof caseLocationResponseSchema>

/** Konum path parametreleri. */
export const caseLocationParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})
export type CaseLocationParams = z.infer<typeof caseLocationParamsSchema>

/** Konum geçmişi öğesi (append-only). Mutlak yol yoktur. */
export const caseLocationHistoryItemSchema = z.strictObject({
  id: idSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  previousRelativePath: relativePathSchema.nullable(),
  verificationStatus: locationVerificationStatusSchema,
  source: locationSourceSchema,
  changedByUserId: idSchema.nullable(),
  occurredAt: utcDateTimeSchema,
})
export type CaseLocationHistoryItem = z.infer<typeof caseLocationHistoryItemSchema>

export const caseLocationHistoryResponseSchema = z.strictObject({
  items: z.array(caseLocationHistoryItemSchema),
  pageInfo: pageInfoSchema,
})
export type CaseLocationHistoryResponse = z.infer<typeof caseLocationHistoryResponseSchema>
