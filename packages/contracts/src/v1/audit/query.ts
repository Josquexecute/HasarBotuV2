import { z } from 'zod'
import { idSchema, userIdSchema, utcDateTimeSchema } from '../../common/primitives.js'
import { pageSizeWithDefaultSchema, pageWithDefaultSchema } from '../../common/pagination.js'

/**
 * Audit sorgu sozlesmesi (`GET /api/v1/audit-events`).
 * Strict: bilinmeyen sorgu alani reddedilir; coercion kullanilmaz.
 * Kiracı kapsami sunucudaki oturum organizasyonudur (istekte tasinmaz).
 */
export const MAX_AUDIT_ACTION_LENGTH = 64
export const MAX_AUDIT_ENTITY_TYPE_LENGTH = 64

/** Eylem ve varlik turu kararli, kucuk-harf nokta/alt-cizgi kodlaridir. */
export const auditActionSchema = z
  .string()
  .min(1)
  .max(MAX_AUDIT_ACTION_LENGTH)
  .regex(/^[a-z0-9._]+$/, { error: 'invalid_audit_action' })

export const auditEntityTypeSchema = z
  .string()
  .min(1)
  .max(MAX_AUDIT_ENTITY_TYPE_LENGTH)
  .regex(/^[a-z0-9._]+$/, { error: 'invalid_entity_type' })

const auditEventsQueryObject = z.strictObject({
  action: auditActionSchema.optional(),
  actorUserId: userIdSchema.optional(),
  entityType: auditEntityTypeSchema.optional(),
  entityId: idSchema.optional(),
  occurredFrom: utcDateTimeSchema.optional(),
  occurredTo: utcDateTimeSchema.optional(),
  page: pageWithDefaultSchema,
  pageSize: pageSizeWithDefaultSchema,
})

/**
 * `occurredFrom > occurredTo` gecersizdir. Kanonik `Z` sonekli ISO tarih-saat
 * karsilastirmasi leksikografiktir (ayni bicim/zaman dilimi); Date donusumu yok.
 */
export const auditEventsQuerySchema = auditEventsQueryObject.refine(
  (value) => {
    if (value.occurredFrom === undefined || value.occurredTo === undefined) return true
    return value.occurredFrom <= value.occurredTo
  },
  { error: 'occurred_range_invalid', path: ['occurredTo'] },
)

export type AuditEventsQuery = z.infer<typeof auditEventsQuerySchema>
export type AuditEventsQueryInput = z.input<typeof auditEventsQuerySchema>
