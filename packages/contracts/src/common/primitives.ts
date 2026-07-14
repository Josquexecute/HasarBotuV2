import { z } from 'zod'
import {
  CASE_STAGES,
  OPEN_CASE_STAGES,
  CASE_STATUSES,
  CASE_TYPES,
  isLocalDate,
  isUtcDateTime,
  parseOfficeCaseNumber,
  parsePlateNumber,
  parseRelativePath,
} from '@hasarbotu/domain'

/**
 * Ortak primitive sozlesme semalari.
 *
 * Bu semalar wire (JSON) sinirini dogrular. Domain paketindeki saf dogrulayicilarla
 * ayni kararli kodlari kullanir; ancak domain branded tipleriyle ayni sey degildir.
 * Domain brand'leri dogrudan DTO ciktisi yapilmaz; donusum yalnizca
 * `v1/cases/mappers.ts` icindeki saf mapper'larla yapilir.
 *
 * JSON Schema paritesi: mumkun olan her kural pattern/min/max olarak ifade edilir
 * ki `z.toJSONSchema` ciktisi runtime davranisiyla ortusun. Yalniz runtime'da
 * dogrulanabilen kurallar (takvim gecerliligi, plaka kanonikalizasyonu) semaya
 * `x-hasarbotu-runtime-validation` metadata'si ile isaretlenir. JSON Schema tek
 * basina guvenlik siniri DEGILDIR; kaynak dogruluk Zod runtime dogrulamasidir.
 */

export const MAX_ID_LENGTH = 128
export const MAX_REFERENCE_NUMBER_LENGTH = 128
export const MAX_PLATE_LENGTH = 32

/** En az bir gorunur (bosluk olmayan) karakter iceren string. */
export const nonEmptyStringSchema = z
  .string()
  .min(1)
  .regex(/\S/, { error: 'must_not_be_blank' })

/**
 * Dis kimlikler guvenli ASCII kumesiyle sinirlidir: harf, rakam, nokta, alt cizgi,
 * tire; 1..128 karakter. Yol ayraci (slash ve ters bolu), bosluk, kontrol karakteri
 * ve `..` dizisi reddedilir: kimlik hicbir zaman dosya yolu olamaz.
 */
const SAFE_ID_PATTERN = /^(?!.*[.][.])[A-Za-z0-9._-]{1,128}$/

export const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(SAFE_ID_PATTERN, { error: 'unsafe_identifier' })
export const caseIdSchema = idSchema
export const userIdSchema = idSchema
export const serviceIdSchema = idSchema
export const insurerIdSchema = idSchema

export const caseTypeSchema = z.enum(CASE_TYPES)
export const caseStatusSchema = z.enum(CASE_STATUSES)
export const caseStageSchema = z.enum(CASE_STAGES)
/** `closed` yalniz lifecycle saga'sinin server-side sonucudur. */
export const openCaseStageSchema = z.enum(OPEN_CASE_STAGES)

// Referans numaralari: kontrol karakteri (C0, DEL, C1) ve backslash yasak; slash
// gecerli (`11/18882475`); en az bir alfasayisal karakter zorunlu; 1..128 karakter.
// Karakter sinifi, kaynak dosyada gorunmez karakter bulundurmamak icin programatik kurulur.
const BACKSLASH = String.fromCharCode(92)
const CONTROL_RANGES =
  `${String.fromCharCode(0)}-${String.fromCharCode(31)}` +
  `${String.fromCharCode(127)}-${String.fromCharCode(159)}`
const REFERENCE_NUMBER_PATTERN = new RegExp(
  `^(?=.*[A-Za-z0-9])[^${BACKSLASH}${BACKSLASH}${CONTROL_RANGES}]{1,${MAX_REFERENCE_NUMBER_LENGTH}}$`,
)

/**
 * Ihbar formu ve sigorta hasar numaralari serbest bicimli dis referanslardir.
 * Slash icerebildikleri icin HICBIR ZAMAN dosya yolu veya path parcasi olarak
 * kullanilmamalidir; fiziksel yol kararlari File Agent sinirinin isidir.
 */
export const notificationFormNumberSchema = z
  .string()
  .min(1)
  .max(MAX_REFERENCE_NUMBER_LENGTH)
  .regex(REFERENCE_NUMBER_PATTERN, { error: 'invalid_reference_number' })
export const insurerClaimNumberSchema = notificationFormNumberSchema

/**
 * Ofis dosya numarasi kanonik `YYYY/N`: yil 2000..9999 (pattern: [2-9]\d{3}),
 * sira 1'den baslayan en cok 15 haneli tam sayi (guvenli tam sayi siniri icinde).
 * Pattern, runtime domain dogrulamasiyla ayni kume ile eslesir.
 */
export const officeCaseNumberSchema = z
  .string()
  .regex(/^[2-9]\d{3}\/[1-9]\d{0,14}$/, { error: 'invalid_office_case_number_format' })
  .refine((value) => parseOfficeCaseNumber(value).ok, { error: 'invalid_office_case_number' })

/**
 * Kanonik plaka string'i; 1..32 karakter. Kanonikalizasyon kabul kumesi (buyuk
 * harf, tek aralik) yalniz runtime'da domain dogrulayicisiyla garanti edilir.
 */
export const plateNumberSchema = z
  .string()
  .min(1)
  .max(MAX_PLATE_LENGTH)
  .refine((value) => parsePlateNumber(value).ok, { error: 'invalid_plate_number' })
  .meta({ 'x-hasarbotu-runtime-validation': 'plate-number-canonical-form' })

const UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Kanonik `Z` sonekli UTC ISO tarih-saat. Bicim pattern ile; gercek takvim
 * gecerliligi (ay/gun sinirlari, artik yil) yalniz runtime'da dogrulanir.
 */
export const utcDateTimeSchema = z
  .string()
  .regex(UTC_DATE_TIME_PATTERN, { error: 'invalid_utc_date_time_format' })
  .refine((value) => isUtcDateTime(value), { error: 'invalid_utc_date_time' })
  .meta({ 'x-hasarbotu-runtime-validation': 'calendar-date-validity' })

/**
 * Yalniz tarih `YYYY-MM-DD`. Bicim pattern ile; gercek takvim gecerliligi
 * yalniz runtime'da dogrulanir. Timezone tasimaz ve donusturulmez.
 */
export const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, { error: 'invalid_local_date_format' })
  .refine((value) => isLocalDate(value), { error: 'invalid_local_date' })
  .meta({ 'x-hasarbotu-runtime-validation': 'calendar-date-validity' })

/** Optimistic locking icin 1'den baslayan pozitif guvenli tam sayi. */
export const entityVersionSchema = z.number().int().min(1)

export const MAX_STORAGE_ROOT_KEY_LENGTH = 64
export const MAX_RELATIVE_PATH_LENGTH = 400

/**
 * Mantiksal depolama kok anahtari: kucuk-harf slug (`baran-global-primary`).
 * Mutlak yol, surucu harfi veya UNC DEGILDIR ve olamaz.
 */
export const storageRootKeySchema = z
  .string()
  .min(1)
  .max(MAX_STORAGE_ROOT_KEY_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'invalid_storage_root_key' })

/**
 * Guvenli POSIX GORELI yol. Tam guvenlik kurali (traversal `..`, absolute,
 * surucu on eki, UNC/backslash, kontrol karakteri, Windows yasak karakter/aygit
 * adi) domain `parseRelativePath` ile RUNTIME'da dogrulanir; JSON Schema tek
 * basina guvenlik siniri degildir (metadata ile isaretli).
 */
export const relativePathSchema = z
  .string()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine((value) => parseRelativePath(value).ok, { error: 'invalid_relative_path' })
  .meta({ 'x-hasarbotu-runtime-validation': 'safe-relative-path' })

export type CaseTypeDto = z.infer<typeof caseTypeSchema>
export type CaseStatusDto = z.infer<typeof caseStatusSchema>
export type CaseStageDto = z.infer<typeof caseStageSchema>
export type OpenCaseStageDto = z.infer<typeof openCaseStageSchema>
export type OfficeCaseNumberDto = z.infer<typeof officeCaseNumberSchema>
export type PlateNumberDto = z.infer<typeof plateNumberSchema>
export type UtcDateTimeDto = z.infer<typeof utcDateTimeSchema>
export type LocalDateDto = z.infer<typeof localDateSchema>
export type EntityVersionDto = z.infer<typeof entityVersionSchema>
