import { z } from 'zod'
import {
  entityVersionSchema,
  relativePathSchema,
  storageRootKeySchema,
} from '../../common/primitives.js'
import { locationSourceSchema } from './dto.js'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'

/**
 * Vaka konumu atama/değiştirme komutu (`PUT /api/v1/cases/:caseId/location`).
 * Strict; yalniz mantiksal rootKey + güvenli göreli yol taşınır (mutlak yol
 * reddedilir). İlk atamada `expectedVersion` verilmez; mevcut konumu
 * değiştirirken optimistic locking için ZORUNLUDUR. `verificationStatus`
 * istekle SET EDİLEMEZ (File Agent'ın işidir; atamada `pending` başlar).
 */
export const caseLocationAssignRequestSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
  relativePath: relativePathSchema,
  source: locationSourceSchema.default('manual'),
  expectedVersion: entityVersionSchema.optional(),
})
export type CaseLocationAssignRequest = z.infer<typeof caseLocationAssignRequestSchema>
export type CaseLocationAssignRequestInput = z.input<typeof caseLocationAssignRequestSchema>

/** Konum geçmişi sorgu sözleşmesi: yalnız sınırlı sayfalama. */
export const caseLocationHistoryQuerySchema = z.strictObject({
  page: pageWithDefaultSchema,
  pageSize: pageSizeWithDefaultSchema,
})
export type CaseLocationHistoryQuery = z.infer<typeof caseLocationHistoryQuerySchema>
export type CaseLocationHistoryQueryInput = z.input<typeof caseLocationHistoryQuerySchema>
