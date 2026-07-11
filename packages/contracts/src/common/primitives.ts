import { z } from 'zod'
import {
  CASE_STAGES,
  CASE_STATUSES,
  CASE_TYPES,
  isLocalDate,
  isUtcDateTime,
  parseOfficeCaseNumber,
  parsePlateNumber,
} from '@hasarbotu/domain'

/**
 * Ortak primitive sozlesme semalari.
 *
 * Bu semalar wire (JSON) sinirini dogrular. Domain paketindeki saf dogrulayicilarla
 * ayni kararli kodlari kullanir; ancak domain branded tipleriyle ayni sey degildir.
 * Domain brand'leri dogrudan DTO ciktisi yapilmaz; donusum yalnizca
 * `v1/cases/mappers.ts` icindeki saf mapper'larla yapilir.
 */

/** Bosluk-olmayan, en az bir gorunur karakter iceren string. */
export const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, { error: 'must_not_be_blank' })

/** Dis kimlikler bos olmayan stringlerdir; ayni kabul sinirini paylasirlar. */
export const idSchema = nonEmptyStringSchema
export const caseIdSchema = nonEmptyStringSchema
export const userIdSchema = nonEmptyStringSchema
export const serviceIdSchema = nonEmptyStringSchema
export const insurerIdSchema = nonEmptyStringSchema

export const caseTypeSchema = z.enum(CASE_TYPES)
export const caseStatusSchema = z.enum(CASE_STATUSES)
export const caseStageSchema = z.enum(CASE_STAGES)

/** Ihbar formu ve sigorta hasar numaralari bos olmayan nominal stringlerdir. */
export const notificationFormNumberSchema = nonEmptyStringSchema
export const insurerClaimNumberSchema = nonEmptyStringSchema

/** Ofis dosya numarasi kanonik `YYYY/N` string bicimidir; yil 2000..9999. */
export const officeCaseNumberSchema = z
  .string()
  .regex(/^\d{4}\/[1-9]\d*$/, { error: 'invalid_office_case_number_format' })
  .refine((value) => parseOfficeCaseNumber(value).ok, { error: 'invalid_office_case_number' })

/** Kanonik plaka string'i; domain plaka dogrulayicisi ile ayni kabul sinirini kullanir. */
export const plateNumberSchema = z
  .string()
  .min(1)
  .refine((value) => parsePlateNumber(value).ok, { error: 'invalid_plate_number' })

const UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Kanonik `Z` sonekli UTC ISO tarih-saat; takvim gecerliligi domain ile dogrulanir. */
export const utcDateTimeSchema = z
  .string()
  .regex(UTC_DATE_TIME_PATTERN, { error: 'invalid_utc_date_time_format' })
  .refine((value) => isUtcDateTime(value), { error: 'invalid_utc_date_time' })

/** Yalniz tarih `YYYY-MM-DD`; takvim gecerliligi domain ile dogrulanir. */
export const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, { error: 'invalid_local_date_format' })
  .refine((value) => isLocalDate(value), { error: 'invalid_local_date' })

/** Optimistic locking icin 1'den baslayan pozitif guvenli tam sayi. */
export const entityVersionSchema = z.number().int().min(1)

export type CaseTypeDto = z.infer<typeof caseTypeSchema>
export type CaseStatusDto = z.infer<typeof caseStatusSchema>
export type CaseStageDto = z.infer<typeof caseStageSchema>
export type OfficeCaseNumberDto = z.infer<typeof officeCaseNumberSchema>
export type PlateNumberDto = z.infer<typeof plateNumberSchema>
export type UtcDateTimeDto = z.infer<typeof utcDateTimeSchema>
export type LocalDateDto = z.infer<typeof localDateSchema>
export type EntityVersionDto = z.infer<typeof entityVersionSchema>
