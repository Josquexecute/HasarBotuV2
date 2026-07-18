import { z } from 'zod'
import {
  MAX_OPERATIONAL_ALERTS,
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

export const operationalAlertsResponseSchema = z.strictObject({
  schemaVersion: z.literal(OPERATIONAL_ALERT_SCHEMA_VERSION),
  /** Sayaç yalnız döndürülen gerçek uyarılardan hesaplanır. */
  totalCount: z.number().int().min(0).max(MAX_OPERATIONAL_ALERTS),
  evaluatedAt: utcDateTimeSchema,
  alerts: z.array(operationalAlertSchema).max(MAX_OPERATIONAL_ALERTS),
})

export type OperationalAlertDto = z.infer<typeof operationalAlertSchema>
export type OperationalAlertsResponse = z.infer<typeof operationalAlertsResponseSchema>
