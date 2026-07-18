import { z } from 'zod'
import {
  MAX_OPERATIONAL_ALERTS,
  MAX_OPERATIONAL_ALERT_CASE_FILTER,
  MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH,
  OPERATIONAL_ALERT_SCHEMA_VERSION,
  OPERATIONAL_ALERT_SEVERITIES,
  OPERATIONAL_ALERT_TYPES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  localDateSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

/**
 * Operasyonel uyarılar salt okunurdur ve mevcut kaynak veriden türetilir.
 * Bu yüzden istek gövdesi, yazma DTO'su veya kullanıcı durumu (okundu/ertelendi)
 * alanı yoktur.
 */
export const operationalAlertTypeSchema = z.enum(OPERATIONAL_ALERT_TYPES)
export const operationalAlertSeveritySchema = z.enum(OPERATIONAL_ALERT_SEVERITIES)

export const operationalAlertSchema = z.strictObject({
  dedupeKey: z.string().min(1).max(300),
  type: operationalAlertTypeSchema,
  severity: operationalAlertSeveritySchema,
  caseId: caseIdSchema,
  plate: plateNumberSchema,
  officeNumber: officeCaseNumberSchema,
  summary: z.string().min(1).max(MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH),
  sourceDate: localDateSchema,
  caseDetailPath: z.string().min(1).max(300).regex(/^\/dosyalar\/[A-Za-z0-9._-]{1,128}$/, {
    error: 'invalid_case_detail_path',
  }),
})

/**
 * Dosya kimliği filtresi. Yalnız Dosyalar ekranındaki görünür satırlar için
 * kullanılır ve sözleşme seviyesinde sınırlıdır. Kimlikler UUID biçiminde
 * olmalıdır; tenant sınırı istemciden gelen kimliklere göre DEĞİL, sunucudaki
 * organization kapsamıyla uygulanır.
 */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export const operationalAlertsQuerySchema = z.strictObject({
  caseIds: z
    .array(z.string().regex(UUID_PATTERN, { error: 'invalid_case_id' }))
    .min(1)
    .max(MAX_OPERATIONAL_ALERT_CASE_FILTER)
    .refine((value) => new Set(value).size === value.length, { error: 'duplicate_case_id' })
    .optional(),
})

/**
 * Dosya başına özet. Yalnız `caseIds` filtresi verildiğinde döner ve istenen
 * her erişilebilir dosya için (uyarısı olmasa bile) bir kayıt içerir. Özet,
 * `alerts` listesindeki 200 kırpmasından ÖNCE hesaplanır; bu yüzden görünür
 * satırlar arasında yanlış negatif üretmez.
 */
export const operationalAlertCaseSummarySchema = z.strictObject({
  caseId: caseIdSchema,
  totalCount: z.number().int().min(0),
  byType: z.strictObject({
    overdue_task: z.number().int().min(0),
    overdue_follow_up: z.number().int().min(0),
    missing_required_document: z.number().int().min(0),
  }),
})

export const operationalAlertsResponseSchema = z.strictObject({
  schemaVersion: z.literal(OPERATIONAL_ALERT_SCHEMA_VERSION),
  /** Sayaç yalnız döndürülen gerçek uyarılardan hesaplanır. */
  totalCount: z.number().int().min(0).max(MAX_OPERATIONAL_ALERTS),
  evaluatedAt: utcDateTimeSchema,
  alerts: z.array(operationalAlertSchema).max(MAX_OPERATIONAL_ALERTS),
  caseSummaries: z
    .array(operationalAlertCaseSummarySchema)
    .max(MAX_OPERATIONAL_ALERT_CASE_FILTER)
    .optional(),
})

export type OperationalAlertDto = z.infer<typeof operationalAlertSchema>
export type OperationalAlertsQuery = z.infer<typeof operationalAlertsQuerySchema>
export type OperationalAlertCaseSummaryDto = z.infer<typeof operationalAlertCaseSummarySchema>
export type OperationalAlertsResponse = z.infer<typeof operationalAlertsResponseSchema>
