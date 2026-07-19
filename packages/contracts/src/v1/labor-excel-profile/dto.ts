import { z } from 'zod'
import {
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  LABOR_OPERATION_TYPES,
  MAX_LABOR_EXCEL_COLUMNS,
  MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH,
  MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH,
  MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH,
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
 * eşleme kullanıcı verisidir. Sabit olan tek şey kanonik operasyon türü
 * kümesidir; eşleme bu kümenin TAMAMINI kapsamak zorundadır.
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

/** Her kanonik tür zorunlu anahtardır; `null` "bilerek eşlenmedi" demektir. */
export const laborExcelMappingSchema = z.strictObject(
  Object.fromEntries(
    LABOR_OPERATION_TYPES.map((type) => [type, columnKeySchema.nullable()]),
  ) as Record<(typeof LABOR_OPERATION_TYPES)[number], z.ZodNullable<typeof columnKeySchema>>,
)

export const laborExcelProfileFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH),
  /** Profil bir sigorta şirketine bağlanabilir; bağlanmazsa genel şablondur. */
  insurerId: idSchema.nullable().default(null),
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
  schemaVersion: z.literal(LABOR_EXCEL_PROFILE_SCHEMA_VERSION),
  version: entityVersionSchema,
  current: laborExcelProfileVersionSchema,
  history: z.array(laborExcelProfileVersionSchema).max(100),
  createdByDisplayName: z.string().min(1).max(200),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const laborExcelProfileResponseSchema = z.strictObject({
  profile: laborExcelProfileSchema,
})

export const laborExcelProfilesResponseSchema = z.strictObject({
  profiles: z.array(laborExcelProfileSchema).max(200),
  permissions: z.strictObject({ canWrite: z.boolean() }),
})

export const laborExcelProjectionLineSchema = z.strictObject({
  lineOrdinal: z.number().int().min(1).max(MAX_LABOR_SHEET_ITEMS),
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  status: z.enum(['projected', 'manual_entry_required']),
  reviewRequired: z.boolean(),
  cells: z.record(columnKeySchema, amountMinorSchema),
  unmappedAmountMinor: amountMinorSchema,
  totalMinor: amountMinorSchema,
})

export const laborExcelProjectionResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  applicationId: idSchema,
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
export type LaborExcelProfileFields = z.infer<typeof laborExcelProfileFieldsSchema>
export type LaborExcelProfileSaveRequest = z.infer<typeof laborExcelProfileSaveRequestSchema>
export type LaborExcelProfileDto = z.infer<typeof laborExcelProfileSchema>
export type LaborExcelProfileResponse = z.infer<typeof laborExcelProfileResponseSchema>
export type LaborExcelProfilesResponse = z.infer<typeof laborExcelProfilesResponseSchema>
export type LaborExcelProjectionResponse = z.infer<typeof laborExcelProjectionResponseSchema>
