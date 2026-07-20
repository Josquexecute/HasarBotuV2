import { z } from 'zod'
import {
  LABOR_ALLOCATION_CATEGORIES,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSIONS,
  LABOR_EXCEL_MANUAL_ENTRY_REASONS,
  MAX_LABOR_EXCEL_COLUMNS,
  MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH,
  MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH,
  MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH,
  MAX_LABOR_EXCEL_TARGET_SHEET_LENGTH,
  LABOR_EXCEL_PROFILE_STATUSES,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  MAX_LABOR_REVISION_REASON_LENGTH,
  MAX_LABOR_SHEET_ITEMS,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

/**
 * Paket 60 — Excel şablon profili sözleşmesi.
 *
 * Hiçbir sigorta şirketinin kolon seti sözleşmeye GÖMÜLMEZ: sütunlar ve
 * eşleme kullanıcı verisidir. Sabit olan tek şey kanonik DAĞITIM KATEGORİSİ
 * kümesidir; eşleme bu kümenin TAMAMINI kapsamak zorundadır (P64: eksen
 * operasyon türünden kategoriye taşındı).
 */
const columnKeySchema = z.string().trim().min(1).max(MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH)
const amountMinorSchema = z.number().int().min(0)

export const laborExcelProfileParamsSchema = z.strictObject({ profileId: idSchema })

export const laborExcelProjectionParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  applicationId: idSchema,
})

export const laborExcelColumnSchema = z.strictObject({
  key: columnKeySchema,
  label: z.string().trim().min(1).max(MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH),
})

/**
 * P64: eşleme DAĞITIM KATEGORİSİ eksenindedir; operasyon türü doğrudan Excel
 * sütununa eşlenmez. Her kategori zorunlu anahtardır; `null` "bilerek
 * eşlenmedi" demektir.
 */
export const laborExcelMappingSchema = z.strictObject(
  Object.fromEntries(
    LABOR_ALLOCATION_CATEGORIES.map((category) => [category, columnKeySchema.nullable()]),
  ) as Record<(typeof LABOR_ALLOCATION_CATEGORIES)[number], z.ZodNullable<typeof columnKeySchema>>,
)

/**
 * Paket 63 — yazımdan ÖNCE hangi kimliklerin dosyada doğrulanacağı.
 * Bilerek yalnız "ne" tutulur, "nerede" değil; hücre koordinatı gerçek
 * şablon okunmadan uydurulmaz.
 */
export const laborExcelIdentityChecksSchema = z.strictObject({
  plate: z.boolean(),
  officeNumber: z.boolean(),
})

export const laborExcelProfileFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH),
  /** Profil bir sigorta şirketine bağlanabilir; bağlanmazsa genel şablondur. */
  insurerId: idSchema.nullable().default(null),
  /** Hedef Excel sayfası; tanımlanmadıysa null (yazım öncesi zorunlu olacak). */
  targetSheet: z.string().trim().min(1).max(MAX_LABOR_EXCEL_TARGET_SHEET_LENGTH)
    .nullable().default(null),
  identityChecks: laborExcelIdentityChecksSchema
    .default({ plate: false, officeNumber: false }),
  columns: z.array(laborExcelColumnSchema).min(1).max(MAX_LABOR_EXCEL_COLUMNS),
  mapping: laborExcelMappingSchema,
})

export const laborExcelProfileSaveRequestSchema = z.strictObject({
  fields: laborExcelProfileFieldsSchema,
  /** İlk kayıtta null; sonraki her sürümde mevcut sürüm ve gerekçe zorunlu. */
  expectedVersion: entityVersionSchema.nullable(),
  reason: z.string().trim().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  confirmed: z.literal(true),
})

export const laborExcelProfileVersionSchema = laborExcelProfileFieldsSchema.extend({
  id: idSchema,
  profileVersion: entityVersionSchema,
  revisionReason: z.string().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  createdAt: utcDateTimeSchema,
})

export const laborExcelProfileSchema = z.strictObject({
  id: idSchema,
  /** P64: eski (1.0.0) profiller OKUNABİLİR; yalnız yazıma uygun değildir. */
  schemaVersion: z.enum(LABOR_EXCEL_PROFILE_SCHEMA_VERSIONS),
  /** Fiziksel Excel yazımına uygun mu; yalnız kategori eksenli profiller. */
  writable: z.boolean(),
  version: entityVersionSchema,
  /** P63: pasif profil YENİ projeksiyonda seçilemez, eski kayıtta okunur. */
  status: z.enum(LABOR_EXCEL_PROFILE_STATUSES),
  deactivatedAt: utcDateTimeSchema.nullable(),
  statusReason: z.string().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  current: laborExcelProfileVersionSchema,
  history: z.array(laborExcelProfileVersionSchema).max(100),
  createdByDisplayName: z.string().min(1).max(200),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

/** Profili pasifleştirme/yeniden etkinleştirme; açık kullanıcı eylemidir. */
export const laborExcelProfileStatusRequestSchema = z.strictObject({
  status: z.enum(LABOR_EXCEL_PROFILE_STATUSES),
  expectedVersion: entityVersionSchema,
  reason: z.string().trim().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  confirmed: z.literal(true),
})

export const laborExcelProfileResponseSchema = z.strictObject({
  profile: laborExcelProfileSchema,
})

export const laborExcelProfilesResponseSchema = z.strictObject({
  profiles: z.array(laborExcelProfileSchema).max(200),
  permissions: z.strictObject({ canWrite: z.boolean() }),
})

/**
 * Paket 63 — dosya için seçilebilir profiller.
 *
 * Bu yanıt bir PROFİL ÖNERİSİDİR; gerçek şablon dosyası okunmadığı için
 * "şablon eşleşmesi" DEĞİLDİR. `templateVerified` literal `false` bu iddiayı
 * sözleşme seviyesinde imkânsız kılar.
 */
export const laborExcelProfileCandidateSchema = z.strictObject({
  profileId: idSchema,
  profileVersion: entityVersionSchema,
  name: z.string().min(1).max(MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH),
  scope: z.enum(['insurer', 'generic']),
  insurerId: idSchema.nullable(),
  insurerName: z.string().min(1).max(200).nullable(),
  targetSheet: z.string().min(1).max(MAX_LABOR_EXCEL_TARGET_SHEET_LENGTH).nullable(),
  identityChecks: laborExcelIdentityChecksSchema,
  columns: z.array(laborExcelColumnSchema).min(1).max(MAX_LABOR_EXCEL_COLUMNS),
  mapping: laborExcelMappingSchema,
  /** Hiçbir sütuna eşlenmemiş kategoriler; tutarları sütuna yazılamaz. */
  unmappedCategories: z.array(z.enum(LABOR_ALLOCATION_CATEGORIES))
    .max(LABOR_ALLOCATION_CATEGORIES.length),
  /** Profil fiziksel yazıma uygun mu (yalnız kategori eksenli profiller). */
  writable: z.boolean(),
})

export const laborExcelProfileCandidatesResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  insurerId: idSchema.nullable(),
  insurerName: z.string().min(1).max(200).nullable(),
  candidates: z.array(laborExcelProfileCandidateSchema).max(200),
  /** Yalnız ÖNERİ; kullanıcı seçmeden hiçbir projeksiyon kesinleşmez. */
  suggestedProfileId: idSchema.nullable(),
  reason: z.enum([
    'single_insurer_profile',
    'selection_required',
    'no_candidates',
    'insurer_unknown',
  ]),
  /**
   * Gerçek Excel dosyası HENÜZ okunmadı. Literal `false`, otomatik profil
   * önerisinin "şablon doğrulandı" diye sunulmasını imkânsız kılar.
   */
  templateVerified: z.literal(false),
})

export const laborExcelProjectionLineSchema = z.strictObject({
  lineOrdinal: z.number().int().min(1).max(MAX_LABOR_SHEET_ITEMS),
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  status: z.enum(['projected', 'manual_entry_required']),
  reviewRequired: z.boolean(),
  cells: z.record(columnKeySchema, amountMinorSchema),
  unmappedAmountMinor: amountMinorSchema,
  totalMinor: amountMinorSchema,
  /**
   * Paket 64 — satırın neden elle girilmesi gerektiği. Kapalı kümedir:
   * serbest metin, kullanıcıya "neden yazılamadı" sorusunu cevaplayamaz ve
   * makine tarafından da denetlenemezdi.
   */
  manualEntryReasons: z.array(z.enum(LABOR_EXCEL_MANUAL_ENTRY_REASONS))
    .max(LABOR_EXCEL_MANUAL_ENTRY_REASONS.length),
})

export const laborExcelProjectionResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  applicationId: idSchema,
  /** Projeksiyonun dayandığı föy sürümü ve dosyanın YÜRÜRLÜKTEKİ sürümü. */
  applicationTargetSheetVersion: entityVersionSchema,
  currentSheetVersion: entityVersionSchema,
  /**
   * Föy bu uygulamadan sonra tekrar sürümlendiyse önizleme bayattır ve
   * fiziksel yazıma uygun sayılmaz.
   */
  stale: z.boolean(),
  /**
   * Yazılabilirlik: yalnız güncel şema sürümündeki profil ve bayat olmayan
   * önizleme. Eski profiller OKUNABİLİR kalır ama yazılamaz.
   */
  writable: z.boolean(),
  profileId: idSchema,
  profileVersion: entityVersionSchema,
  schemaVersion: z.literal(LABOR_EXCEL_PROFILE_SCHEMA_VERSION),
  columns: z.array(laborExcelColumnSchema).min(1).max(MAX_LABOR_EXCEL_COLUMNS),
  lines: z.array(laborExcelProjectionLineSchema).max(MAX_LABOR_SHEET_ITEMS),
  columnTotals: z.record(columnKeySchema, amountMinorSchema),
  projectedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  manualEntryLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  reviewRequiredLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  unmappedTotalMinor: amountMinorSchema,
  /**
   * Bu uç hiçbir dosyaya yazmaz. Literal `false`, sözleşme seviyesinde
   * "Excel'e yazıldı" iddiasını imkânsız kılar.
   */
  written: z.literal(false),
})

export type LaborExcelColumnDto = z.infer<typeof laborExcelColumnSchema>
export type LaborExcelIdentityChecksDto = z.infer<typeof laborExcelIdentityChecksSchema>
export type LaborExcelProfileFields = z.infer<typeof laborExcelProfileFieldsSchema>
export type LaborExcelProfileSaveRequest = z.infer<typeof laborExcelProfileSaveRequestSchema>
export type LaborExcelProfileStatusRequest = z.infer<typeof laborExcelProfileStatusRequestSchema>
export type LaborExcelProfileDto = z.infer<typeof laborExcelProfileSchema>
export type LaborExcelProfileResponse = z.infer<typeof laborExcelProfileResponseSchema>
export type LaborExcelProfilesResponse = z.infer<typeof laborExcelProfilesResponseSchema>
export type LaborExcelProfileCandidateDto = z.infer<typeof laborExcelProfileCandidateSchema>
export type LaborExcelProfileCandidatesResponse =
  z.infer<typeof laborExcelProfileCandidatesResponseSchema>
export type LaborExcelProjectionResponse = z.infer<typeof laborExcelProjectionResponseSchema>
