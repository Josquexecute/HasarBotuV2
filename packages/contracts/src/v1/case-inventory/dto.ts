import { z } from 'zod'
import { CASE_STATUSES, CASE_TYPES } from '@hasarbotu/domain'

/**
 * Dosya Envanteri — liste önizleme ve export sözleşmesi.
 *
 * Önizleme uç noktası PII TAŞIMAZ: yalnız sayım döner. Gerçek satırlar
 * (telefon dahil) yalnız export (.xlsx indirme) yolunda üretilir ve asla
 * JSON gövdesine yazılmaz — export'un kendisi tek PII taşıyıcısıdır.
 */
export const CASE_INVENTORY_MAX_ROWS = 5_000 as const

export const caseInventoryQuerySchema = z.strictObject({
  caseType: z.enum(CASE_TYPES).optional(),
  status: z.enum(CASE_STATUSES).optional(),
})

export const caseInventoryPreviewResponseSchema = z.strictObject({
  totalCount: z.number().int().min(0),
  maxRows: z.literal(CASE_INVENTORY_MAX_ROWS),
  truncated: z.boolean(),
  includesPhones: z.boolean(),
})

export type CaseInventoryQuery = z.infer<typeof caseInventoryQuerySchema>
export type CaseInventoryPreviewResponse = z.infer<typeof caseInventoryPreviewResponseSchema>
