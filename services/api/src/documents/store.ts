import type pg from 'pg'
import {
  documentDetailSchema,
  documentSchema,
  documentVersionSchema,
  photoSchema,
  type Document,
  type DocumentDetail,
  type DocumentRegisterResponse,
  type DocumentVersion,
  type MetadataListQuery,
  type Photo,
  type PhotoRegisterResponse,
  type RegisterDocumentRequest,
  type RegisterPhotoRequest,
} from '@hasarbotu/contracts'
import {
  extractExtension,
  fileCategoryOf,
  isMimeExtensionConsistent,
  toSafeDisplayName,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent, isIdempotencyRace } from '../db/idempotency.js'

/**
 * Belge/fotoğraf metadata katmanı (Paket 13). Yalnız METADATA; dosya içeriği
 * yoktur. Kayıt DAİMA `pending` başlar — istemci `ready`/doğrulama sonucunu
 * belirleyemez. Mutlak yol saklanmaz/dönülmez/audit'e yazılmaz. Kayıt tek
 * transaction'da: (belge+)sürüm + merkezi audit + idempotency atomik. Aynı
 * içerik hash'i tespit edilir ama vakalar arası SESSİZ birleştirme YAPILMAZ.
 */
interface VersionRow {
  id: string
  document_id: string
  case_id: string
  version_number: number
  previous_version_id: string | null
  original_file_name: string
  display_name: string
  extension: string | null
  mime_type: string
  byte_size: string
  content_hash: string
  storage_root_key: string
  relative_path: string
  source_type: string
  status: string
  hash_verified: boolean
  size_verified: boolean
  verified_at: Date | null
  created_at: Date
}
interface DocumentRow {
  id: string
  case_id: string
  document_type: string
  current_version_id: string | null
  current_version_number: number
  status: string
  version: number
  created_at: Date
  updated_at: Date
}
type PhotoRow = Omit<VersionRow, 'document_id' | 'version_number' | 'previous_version_id'>

const VERSION_FIELDS = `id, document_id, case_id, version_number, previous_version_id, original_file_name,
  display_name, extension, mime_type, byte_size, content_hash, storage_root_key, relative_path,
  source_type, status, hash_verified, size_verified, verified_at, created_at`
const DOCUMENT_FIELDS = `id, case_id, document_type, current_version_id, current_version_number, status, version, created_at, updated_at`
const PHOTO_FIELDS = `id, case_id, original_file_name, display_name, extension, mime_type, byte_size,
  content_hash, storage_root_key, relative_path, source_type, status, hash_verified, size_verified, verified_at, created_at`

function documentToDto(row: DocumentRow): Document {
  return documentSchema.parse({
    id: row.id,
    caseId: row.case_id,
    documentType: row.document_type,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}
function versionToDto(row: VersionRow): DocumentVersion {
  return documentVersionSchema.parse({
    id: row.id,
    documentId: row.document_id,
    caseId: row.case_id,
    versionNumber: row.version_number,
    previousVersionId: row.previous_version_id,
    originalFileName: row.original_file_name,
    displayName: row.display_name,
    extension: row.extension,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    contentHash: row.content_hash,
    storageRootKey: row.storage_root_key,
    relativePath: row.relative_path,
    sourceType: row.source_type,
    status: row.status,
    hashVerified: row.hash_verified,
    sizeVerified: row.size_verified,
    verifiedAt: row.verified_at === null ? null : row.verified_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  })
}
function photoToDto(row: PhotoRow): Photo {
  return photoSchema.parse({
    id: row.id,
    caseId: row.case_id,
    originalFileName: row.original_file_name,
    displayName: row.display_name,
    extension: row.extension,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    contentHash: row.content_hash,
    storageRootKey: row.storage_root_key,
    relativePath: row.relative_path,
    sourceType: row.source_type,
    status: row.status,
    hashVerified: row.hash_verified,
    sizeVerified: row.size_verified,
    verifiedAt: row.verified_at === null ? null : row.verified_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  })
}

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}
interface IdempotencyContext {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

export type RegisterDocumentOutcome =
  | { readonly kind: 'ok'; readonly response: DocumentRegisterResponse }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'idempotency_conflict' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_reference'; readonly field: string }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'validation'; readonly field: string; readonly code: string }

export type RegisterPhotoOutcome =
  | { readonly kind: 'ok'; readonly response: PhotoRegisterResponse }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'idempotency_conflict' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_reference'; readonly field: string }
  | { readonly kind: 'validation'; readonly field: string; readonly code: string }

export interface ListResult<T> {
  readonly items: readonly T[]
  readonly totalItems: number
}

async function caseInOrg(client: pg.PoolClient, organizationId: string, caseId: string): Promise<boolean> {
  const res = await client.query('SELECT 1 FROM cases WHERE id::text = $1 AND organization_id = $2', [caseId, organizationId])
  return (res.rowCount ?? 0) > 0
}
async function activeRootInOrg(client: pg.PoolClient, organizationId: string, rootKey: string): Promise<boolean> {
  const res = await client.query(
    'SELECT 1 FROM storage_roots WHERE organization_id = $1 AND root_key = $2 AND is_active = true',
    [organizationId, rootKey],
  )
  return (res.rowCount ?? 0) > 0
}

export function createDocumentsStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    async registerDocument(
      actor: ActorContext,
      caseId: string,
      input: RegisterDocumentRequest,
      idem: IdempotencyContext,
    ): Promise<RegisterDocumentOutcome> {
      const extension = extractExtension(input.originalFileName)
      if (!isMimeExtensionConsistent(extension, input.mimeType)) {
        return { kind: 'validation', field: 'mimeType', code: 'mime_extension_mismatch' }
      }
      if (fileCategoryOf(extension) !== 'document') {
        return { kind: 'validation', field: 'originalFileName', code: 'not_a_document_type' }
      }
      const displayName = toSafeDisplayName(input.displayName ?? input.originalFileName)

      const replay = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
      if (replay !== undefined) {
        if (replay.requestHash !== idem.requestHash) return { kind: 'idempotency_conflict' }
        return { kind: 'replay', status: replay.responseStatus, body: replay.responseBody }
      }

      try {
        return await withTransaction(pool, async (client): Promise<RegisterDocumentOutcome> => {
          if (!(await caseInOrg(client, actor.organizationId, caseId))) return { kind: 'not_found' }
          if (!(await activeRootInOrg(client, actor.organizationId, input.storageRootKey))) {
            return { kind: 'unknown_reference', field: 'storageRootKey' }
          }

          let documentId: string
          let versionNumber: number
          let previousVersionId: string | null
          let isNewDocument: boolean

          if (input.documentId !== undefined) {
            const doc = await client.query(
              `SELECT id, current_version_id, current_version_number, version FROM documents
               WHERE id::text = $1 AND organization_id = $2 AND case_id::text = $3 AND document_type = $4 FOR UPDATE`,
              [input.documentId, actor.organizationId, caseId, input.documentType],
            )
            const existing = doc.rows[0] as
              | { id: string; current_version_id: string | null; current_version_number: number; version: number }
              | undefined
            if (existing === undefined) return { kind: 'unknown_reference', field: 'documentId' }
            if (input.expectedVersion !== existing.version) return { kind: 'version_conflict' }
            documentId = existing.id
            versionNumber = existing.current_version_number + 1
            previousVersionId = existing.current_version_id
            isNewDocument = false
          } else {
            documentId = uuidv7()
            await client.query(
              `INSERT INTO documents (id, organization_id, case_id, document_type) VALUES ($1, $2, $3, $4)`,
              [documentId, actor.organizationId, caseId, input.documentType],
            )
            versionNumber = 1
            previousVersionId = null
            isNewDocument = true
          }

          // Aynı içerik hash'i tespiti (vaka içi + diğer vaka sayısı). Birleştirme YOK.
          const dupSame = await client.query(
            'SELECT id FROM document_versions WHERE organization_id = $1 AND case_id::text = $2 AND content_hash = $3 ORDER BY created_at LIMIT 1',
            [actor.organizationId, caseId, input.contentHash],
          )
          const dupOther = await client.query(
            'SELECT count(*)::int AS n FROM document_versions WHERE organization_id = $1 AND content_hash = $2 AND case_id::text <> $3',
            [actor.organizationId, input.contentHash, caseId],
          )
          const duplicate = {
            sameCaseVersionId: (dupSame.rows[0] as { id: string } | undefined)?.id ?? null,
            sameCasePhotoId: null,
            otherCaseCount: (dupOther.rows[0] as { n: number }).n,
          }

          const versionId = uuidv7()
          const insertedVersion = await client.query(
            `INSERT INTO document_versions
               (id, organization_id, document_id, case_id, version_number, previous_version_id,
                original_file_name, display_name, extension, mime_type, byte_size, content_hash,
                storage_root_key, relative_path, source_type, status, registered_by_user_id, request_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17)
             RETURNING ${VERSION_FIELDS}`,
            [
              versionId,
              actor.organizationId,
              documentId,
              caseId,
              versionNumber,
              previousVersionId,
              input.originalFileName,
              displayName,
              extension,
              input.mimeType,
              input.byteSize,
              input.contentHash,
              input.storageRootKey,
              input.relativePath,
              input.sourceType,
              actor.actorUserId,
              actor.requestId,
            ],
          )
          const versionRow = insertedVersion.rows[0] as VersionRow

          const updatedDoc = await client.query(
            `UPDATE documents
             SET current_version_id = $1, current_version_number = $2, status = 'pending',
                 version = version + $3, updated_at = now()
             WHERE id = $4
             RETURNING ${DOCUMENT_FIELDS}`,
            [versionId, versionNumber, isNewDocument ? 0 : 1, documentId],
          )
          const documentRow = updatedDoc.rows[0] as DocumentRow

          const response: DocumentRegisterResponse = {
            document: documentToDto(documentRow),
            version: versionToDto(versionRow),
            duplicate,
          }

          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: isNewDocument ? 'document.registered' : 'document.version_registered',
            entityType: 'case',
            entityId: caseId,
            details: {
              documentId,
              documentType: input.documentType,
              versionNumber,
              storageRootKey: input.storageRootKey,
              relativePath: input.relativePath,
              byteSize: input.byteSize,
              mimeType: input.mimeType,
              status: 'pending',
              duplicateInSameCase: duplicate.sameCaseVersionId !== null,
              duplicateOtherCaseCount: duplicate.otherCaseCount,
            },
          })

          await insertIdempotent(client, {
            organizationId: actor.organizationId,
            scope: idem.scope,
            key: idem.key,
            requestHash: idem.requestHash,
            responseStatus: 201,
            responseBody: response,
            caseId,
          })

          return { kind: 'ok', response }
        })
      } catch (error) {
        if (isIdempotencyRace(error)) {
          const raced = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
          if (raced !== undefined && raced.requestHash === idem.requestHash) {
            return { kind: 'replay', status: raced.responseStatus, body: raced.responseBody }
          }
          return { kind: 'idempotency_conflict' }
        }
        throw error
      }
    },

    async registerPhoto(
      actor: ActorContext,
      caseId: string,
      input: RegisterPhotoRequest,
      idem: IdempotencyContext,
    ): Promise<RegisterPhotoOutcome> {
      const extension = extractExtension(input.originalFileName)
      if (!isMimeExtensionConsistent(extension, input.mimeType)) {
        return { kind: 'validation', field: 'mimeType', code: 'mime_extension_mismatch' }
      }
      if (fileCategoryOf(extension) !== 'photo') {
        return { kind: 'validation', field: 'originalFileName', code: 'not_a_photo_type' }
      }
      const displayName = toSafeDisplayName(input.displayName ?? input.originalFileName)

      const replay = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
      if (replay !== undefined) {
        if (replay.requestHash !== idem.requestHash) return { kind: 'idempotency_conflict' }
        return { kind: 'replay', status: replay.responseStatus, body: replay.responseBody }
      }

      try {
        return await withTransaction(pool, async (client): Promise<RegisterPhotoOutcome> => {
          if (!(await caseInOrg(client, actor.organizationId, caseId))) return { kind: 'not_found' }
          if (!(await activeRootInOrg(client, actor.organizationId, input.storageRootKey))) {
            return { kind: 'unknown_reference', field: 'storageRootKey' }
          }

          const dupSame = await client.query(
            'SELECT id FROM photos WHERE organization_id = $1 AND case_id::text = $2 AND content_hash = $3 ORDER BY created_at LIMIT 1',
            [actor.organizationId, caseId, input.contentHash],
          )
          const dupOther = await client.query(
            'SELECT count(*)::int AS n FROM photos WHERE organization_id = $1 AND content_hash = $2 AND case_id::text <> $3',
            [actor.organizationId, input.contentHash, caseId],
          )
          const duplicate = {
            sameCaseVersionId: null,
            sameCasePhotoId: (dupSame.rows[0] as { id: string } | undefined)?.id ?? null,
            otherCaseCount: (dupOther.rows[0] as { n: number }).n,
          }

          const photoId = uuidv7()
          const inserted = await client.query(
            `INSERT INTO photos
               (id, organization_id, case_id, original_file_name, display_name, extension, mime_type,
                byte_size, content_hash, storage_root_key, relative_path, source_type, status,
                registered_by_user_id, request_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14)
             RETURNING ${PHOTO_FIELDS}`,
            [
              photoId,
              actor.organizationId,
              caseId,
              input.originalFileName,
              displayName,
              extension,
              input.mimeType,
              input.byteSize,
              input.contentHash,
              input.storageRootKey,
              input.relativePath,
              input.sourceType,
              actor.actorUserId,
              actor.requestId,
            ],
          )
          const response: PhotoRegisterResponse = { photo: photoToDto(inserted.rows[0] as PhotoRow), duplicate }

          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: 'photo.registered',
            entityType: 'case',
            entityId: caseId,
            details: {
              photoId,
              storageRootKey: input.storageRootKey,
              relativePath: input.relativePath,
              byteSize: input.byteSize,
              mimeType: input.mimeType,
              status: 'pending',
              duplicateInSameCase: duplicate.sameCasePhotoId !== null,
              duplicateOtherCaseCount: duplicate.otherCaseCount,
            },
          })

          await insertIdempotent(client, {
            organizationId: actor.organizationId,
            scope: idem.scope,
            key: idem.key,
            requestHash: idem.requestHash,
            responseStatus: 201,
            responseBody: response,
            caseId,
          })

          return { kind: 'ok', response }
        })
      } catch (error) {
        if (isIdempotencyRace(error)) {
          const raced = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
          if (raced !== undefined && raced.requestHash === idem.requestHash) {
            return { kind: 'replay', status: raced.responseStatus, body: raced.responseBody }
          }
          return { kind: 'idempotency_conflict' }
        }
        throw error
      }
    },

    async listDocuments(
      organizationId: string,
      caseId: string,
      query: MetadataListQuery,
    ): Promise<ListResult<Document>> {
      const countRes = await pool.query(
        'SELECT count(*)::int AS total FROM documents WHERE organization_id = $1 AND case_id::text = $2',
        [organizationId, caseId],
      )
      const totalItems = (countRes.rows[0] as { total: number }).total
      const offset = (query.page - 1) * query.pageSize
      const res = await pool.query(
        `SELECT ${DOCUMENT_FIELDS} FROM documents WHERE organization_id = $1 AND case_id::text = $2
         ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [organizationId, caseId, query.pageSize, offset],
      )
      return { items: (res.rows as DocumentRow[]).map(documentToDto), totalItems }
    },

    async getDocumentDetail(organizationId: string, documentId: string): Promise<DocumentDetail | undefined> {
      const docRes = await pool.query(
        `SELECT ${DOCUMENT_FIELDS} FROM documents WHERE organization_id = $1 AND id::text = $2`,
        [organizationId, documentId],
      )
      const docRow = docRes.rows[0] as DocumentRow | undefined
      if (docRow === undefined) return undefined
      const versionsRes = await pool.query(
        `SELECT ${VERSION_FIELDS} FROM document_versions WHERE organization_id = $1 AND document_id::text = $2
         ORDER BY version_number DESC`,
        [organizationId, documentId],
      )
      const versions = (versionsRes.rows as VersionRow[]).map(versionToDto)
      return documentDetailSchema.parse({ ...documentToDto(docRow), versions })
    },

    async listPhotos(organizationId: string, caseId: string, query: MetadataListQuery): Promise<ListResult<Photo>> {
      const countRes = await pool.query(
        'SELECT count(*)::int AS total FROM photos WHERE organization_id = $1 AND case_id::text = $2',
        [organizationId, caseId],
      )
      const totalItems = (countRes.rows[0] as { total: number }).total
      const offset = (query.page - 1) * query.pageSize
      const res = await pool.query(
        `SELECT ${PHOTO_FIELDS} FROM photos WHERE organization_id = $1 AND case_id::text = $2
         ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [organizationId, caseId, query.pageSize, offset],
      )
      return { items: (res.rows as PhotoRow[]).map(photoToDto), totalItems }
    },

    async getPhoto(organizationId: string, photoId: string): Promise<Photo | undefined> {
      const res = await pool.query(
        `SELECT ${PHOTO_FIELDS} FROM photos WHERE organization_id = $1 AND id::text = $2`,
        [organizationId, photoId],
      )
      const row = res.rows[0] as PhotoRow | undefined
      return row === undefined ? undefined : photoToDto(row)
    },
  }
}

export type DocumentsStore = ReturnType<typeof createDocumentsStore>
