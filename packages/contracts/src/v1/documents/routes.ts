import { API_V1_BASE } from '../../common/routes.js'

/** Surumlu belge/fotoğraf metadata route sabitleri. */
export const DOCUMENTS_ROUTE = `${API_V1_BASE}/cases/:caseId/documents` as const
export const DOCUMENT_DETAIL_ROUTE = `${API_V1_BASE}/documents/:documentId` as const
export const PHOTOS_ROUTE = `${API_V1_BASE}/cases/:caseId/photos` as const
export const PHOTO_DETAIL_ROUTE = `${API_V1_BASE}/photos/:photoId` as const

/** Idempotency scope sabitleri (Paket 09 idempotency_keys tablosuyla). */
export const DOCUMENT_REGISTER_SCOPE = 'documents.register' as const
export const PHOTO_REGISTER_SCOPE = 'photos.register' as const
