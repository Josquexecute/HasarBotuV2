import { z } from 'zod'
import { parseOriginalFileName } from '@hasarbotu/domain'
import {
  caseIdSchema,
  idSchema,
  relativePathSchema,
  storageRootKeySchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { pageInfoSchema } from '../../common/pagination.js'

/**
 * Belge/fotoğraf meta verisi sözleşmeleri (Paket 13). Yalnız METADATA; dosya
 * içeriği yoktur. Mutlak yol taşınmaz (rootKey + güvenli göreli yol). `status`
 * ve doğrulama alanları SUNUCU/File Agent tarafından yönetilir; istemci `ready`
 * veya doğrulama sonucunu belirleyemez.
 */

/** Meta verinin durumu. `ready` yalnız güvenilir doğrulama sonrası oluşabilir. */
export const DOCUMENT_STATUSES = ['pending', 'ready', 'failed', 'missing'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES)

/** Kaynak türü: nasıl geldi. */
export const SOURCE_TYPES = ['upload', 'email', 'scan', 'imported', 'manual'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]
export const sourceTypeSchema = z.enum(SOURCE_TYPES)

export const MAX_DOCUMENT_TYPE_LENGTH = 64
/** Belge türü: küçük-harf slug (ör. `ruhsat`, `police`, `deger_kaybi`). */
export const documentTypeSchema = z
  .string()
  .min(1)
  .max(MAX_DOCUMENT_TYPE_LENGTH)
  .regex(/^[a-z0-9_]+$/, { error: 'invalid_document_type' })

export const MAX_FILE_NAME_LENGTH = 255
export const MAX_DISPLAY_NAME_LENGTH = 200
export const MAX_MIME_TYPE_LENGTH = 128
/** 5 GiB üst sınır (metadata beyanı; içerik doğrulaması File Agent'ta). */
export const MAX_BYTE_SIZE = 5 * 1024 * 1024 * 1024

export const originalFileNameSchema = z
  .string()
  .min(1)
  .max(MAX_FILE_NAME_LENGTH)
  .refine((value) => parseOriginalFileName(value).ok, { error: 'unsafe_file_name' })
  .meta({ 'x-hasarbotu-runtime-validation': 'safe-file-name' })

export const displayNameSchema = z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH)
export const extensionSchema = z.string().min(1).max(16).regex(/^[a-z0-9]+$/, { error: 'invalid_extension' })
export const mimeTypeSchema = z
  .string()
  .min(3)
  .max(MAX_MIME_TYPE_LENGTH)
  .regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i, { error: 'invalid_mime_type' })
export const byteSizeSchema = z.number().int().min(0).max(MAX_BYTE_SIZE)
export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, { error: 'invalid_sha256' })

/** Belge sürümü (immutable kayıtlı gerçek + doğrulama durumu). */
export const documentVersionSchema = z.strictObject({
  id: idSchema,
  documentId: idSchema,
  caseId: caseIdSchema,
  versionNumber: z.number().int().min(1),
  previousVersionId: idSchema.nullable(),
  originalFileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  displayName: displayNameSchema,
  extension: extensionSchema.nullable(),
  mimeType: mimeTypeSchema,
  byteSize: byteSizeSchema,
  contentHash: sha256HexSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  sourceType: sourceTypeSchema,
  status: documentStatusSchema,
  hashVerified: z.boolean(),
  sizeVerified: z.boolean(),
  verifiedAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
})
export type DocumentVersion = z.infer<typeof documentVersionSchema>

/** Belge (mantıksal slot) liste öğesi. */
export const documentSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  documentType: documentTypeSchema,
  currentVersionId: idSchema.nullable(),
  currentVersionNumber: z.number().int().min(0),
  status: documentStatusSchema,
  version: z.number().int().min(1),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})
export type Document = z.infer<typeof documentSchema>

export const documentDetailSchema = documentSchema.extend({
  versions: z.array(documentVersionSchema),
})
export type DocumentDetail = z.infer<typeof documentDetailSchema>

/** Fotoğraf (bağımsız metadata kaydı). */
export const photoSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  originalFileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  displayName: displayNameSchema,
  extension: extensionSchema.nullable(),
  mimeType: mimeTypeSchema,
  byteSize: byteSizeSchema,
  contentHash: sha256HexSchema,
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  sourceType: sourceTypeSchema,
  status: documentStatusSchema,
  hashVerified: z.boolean(),
  sizeVerified: z.boolean(),
  verifiedAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
})
export type Photo = z.infer<typeof photoSchema>

/** Aynı içerik hash'i tespiti (vaka içi). Vakalar arası SESSİZ birleştirme yok. */
export const duplicateSignalSchema = z.strictObject({
  sameCaseVersionId: idSchema.nullable(),
  sameCasePhotoId: idSchema.nullable(),
  otherCaseCount: z.number().int().min(0),
})
export type DuplicateSignal = z.infer<typeof duplicateSignalSchema>

export const documentRegisterResponseSchema = z.strictObject({
  document: documentSchema,
  version: documentVersionSchema,
  duplicate: duplicateSignalSchema,
})
export type DocumentRegisterResponse = z.infer<typeof documentRegisterResponseSchema>

export const photoRegisterResponseSchema = z.strictObject({
  photo: photoSchema,
  duplicate: duplicateSignalSchema,
})
export type PhotoRegisterResponse = z.infer<typeof photoRegisterResponseSchema>

export const documentsListResponseSchema = z.strictObject({
  items: z.array(documentSchema),
  pageInfo: pageInfoSchema,
})
export type DocumentsListResponse = z.infer<typeof documentsListResponseSchema>

export const documentDetailResponseSchema = z.strictObject({
  document: documentDetailSchema,
})
export type DocumentDetailResponse = z.infer<typeof documentDetailResponseSchema>

export const photosListResponseSchema = z.strictObject({
  items: z.array(photoSchema),
  pageInfo: pageInfoSchema,
})
export type PhotosListResponse = z.infer<typeof photosListResponseSchema>

export const photoDetailResponseSchema = z.strictObject({
  photo: photoSchema,
})
export type PhotoDetailResponse = z.infer<typeof photoDetailResponseSchema>

/** Path parametreleri. */
export const caseScopedParamsSchema = z.strictObject({ caseId: caseIdSchema })
export type CaseScopedParams = z.infer<typeof caseScopedParamsSchema>
export const documentParamsSchema = z.strictObject({ documentId: idSchema })
export type DocumentParams = z.infer<typeof documentParamsSchema>
export const photoParamsSchema = z.strictObject({ photoId: idSchema })
export type PhotoParams = z.infer<typeof photoParamsSchema>
