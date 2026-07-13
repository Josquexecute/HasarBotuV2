import { z } from 'zod'
import { entityVersionSchema, idSchema, relativePathSchema, storageRootKeySchema } from '../../common/primitives.js'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'
import {
  byteSizeSchema,
  displayNameSchema,
  documentTypeSchema,
  mimeTypeSchema,
  originalFileNameSchema,
  sha256HexSchema,
  sourceTypeSchema,
} from './dto.js'

/**
 * Metadata registration sınırı (Paket 13). Strict; güvenli metadata beyanı.
 *
 * - `extension` istemciden ALINMAZ; sunucu `originalFileName`'den türetir ve
 *   `mimeType` ile tutarlılığı doğrular (uyuşmazlık reddi).
 * - `status`, `hashVerified`, `sizeVerified`, `verifiedAt` istekle SET EDİLEMEZ;
 *   kayıt daima `pending` başlar. `ready` yalnız güvenilir doğrulama sonrası
 *   (File Agent) oluşabilir.
 * - `contentHash` istemci BEYANIDIR; doğrulanmış hash değildir.
 */
export const registerDocumentRequestSchema = z.strictObject({
  documentType: documentTypeSchema,
  sourceType: sourceTypeSchema,
  originalFileName: originalFileNameSchema,
  displayName: displayNameSchema.optional(),
  mimeType: mimeTypeSchema,
  byteSize: byteSizeSchema,
  contentHash: sha256HexSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  /** Verilirse mevcut belgeye yeni sürüm eklenir (optimistic locking için `expectedVersion` zorunlu). */
  documentId: idSchema.optional(),
  expectedVersion: entityVersionSchema.optional(),
})
export type RegisterDocumentRequest = z.infer<typeof registerDocumentRequestSchema>
export type RegisterDocumentRequestInput = z.input<typeof registerDocumentRequestSchema>

export const registerPhotoRequestSchema = z.strictObject({
  sourceType: sourceTypeSchema,
  originalFileName: originalFileNameSchema,
  displayName: displayNameSchema.optional(),
  mimeType: mimeTypeSchema,
  byteSize: byteSizeSchema,
  contentHash: sha256HexSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
})
export type RegisterPhotoRequest = z.infer<typeof registerPhotoRequestSchema>
export type RegisterPhotoRequestInput = z.input<typeof registerPhotoRequestSchema>

/** Liste sorgusu: sınırlı sayfalama (+ opsiyonel durum filtresi). */
export const metadataListQuerySchema = z.strictObject({
  page: pageWithDefaultSchema,
  pageSize: pageSizeWithDefaultSchema,
})
export type MetadataListQuery = z.infer<typeof metadataListQuerySchema>
export type MetadataListQueryInput = z.input<typeof metadataListQuerySchema>
