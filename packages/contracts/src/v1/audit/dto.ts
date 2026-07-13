import { z } from 'zod'
import { idSchema, utcDateTimeSchema } from '../../common/primitives.js'
import { pageInfoSchema } from '../../common/pagination.js'

/**
 * Audit olayi wire DTO'su (salt okunur). Alanlar mevcut `audit_events`
 * tablosuna birebir eslesir: entityType=resource_type, entityId=resource_id,
 * occurredAt=occurred_at. `details` redaksiyondan gecmis serbest JSON nesnesidir
 * (parola/token/PII icermez). Read modeli, gelecekteki eylem adlarina karsi
 * hosgorulu tutulur (siki bicim yalniz sorgu FILTRESINDE uygulanir).
 */
export const auditEventSchema = z.strictObject({
  id: idSchema,
  organizationId: idSchema.nullable(),
  actorUserId: idSchema.nullable(),
  action: z.string().min(1).max(128),
  entityType: z.string().min(1).max(128).nullable(),
  entityId: z.string().min(1).max(256).nullable(),
  requestId: z.string().min(1).max(256).nullable(),
  occurredAt: utcDateTimeSchema,
  details: z.record(z.string(), z.unknown()),
})
export type AuditEvent = z.infer<typeof auditEventSchema>

/** Liste yaniti: sayfalanmis audit olaylari + sayfa bilgisi. */
export const auditEventsResponseSchema = z.strictObject({
  items: z.array(auditEventSchema),
  pageInfo: pageInfoSchema,
})
export type AuditEventsResponse = z.infer<typeof auditEventsResponseSchema>
