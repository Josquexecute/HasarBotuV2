import { z } from 'zod'
import {
  CASE_VEHICLE_PROFILE_SCHEMA_VERSION,
  MAX_LABOR_REVISION_REASON_LENGTH,
  MAX_VEHICLE_CHASSIS_PREFIX_LENGTH,
  MAX_VEHICLE_EVIDENCE_REFERENCE_LENGTH,
  MAX_VEHICLE_MODEL_YEAR,
  MAX_VEHICLE_TEXT_LENGTH,
  MIN_VEHICLE_MODEL_YEAR,
  VEHICLE_CLASSES,
  VEHICLE_EVIDENCE_SOURCES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

/**
 * Paket 56 — dosya düzeyinde araç profili sözleşmesi.
 *
 * Tam şasi numarası ve plaka bu sözleşmede YOKTUR: yalnız şasi prefix'i taşınır
 * ve uzunluk sınırı tam VIN'i imkânsız kılar.
 */
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)

export const caseVehicleProfileParamsSchema = z.strictObject({ caseId: caseIdSchema })

export const caseVehicleProfileFieldsSchema = z.strictObject({
  brand: boundedText(MAX_VEHICLE_TEXT_LENGTH),
  model: boundedText(MAX_VEHICLE_TEXT_LENGTH),
  modelYear: z.number().int().min(MIN_VEHICLE_MODEL_YEAR).max(MAX_VEHICLE_MODEL_YEAR),
  variant: boundedText(MAX_VEHICLE_TEXT_LENGTH).nullable().default(null),
  vehicleClass: z.enum(VEHICLE_CLASSES),
  /** Yalnız PREFIX; 17 haneli tam VIN sözleşme seviyesinde reddedilir. */
  chassisPrefix: z.string().trim().min(3).max(MAX_VEHICLE_CHASSIS_PREFIX_LENGTH).nullable().default(null),
  engineCode: z.string().trim().min(2).max(24).nullable().default(null),
  evidenceSource: z.enum(VEHICLE_EVIDENCE_SOURCES),
  evidenceReference: boundedText(MAX_VEHICLE_EVIDENCE_REFERENCE_LENGTH).nullable().default(null),
})

export const caseVehicleProfileSaveRequestSchema = z.strictObject({
  fields: caseVehicleProfileFieldsSchema,
  /** İlk sürümde null; sonraki sürümlerde beklenen mevcut sürüm. */
  expectedVersion: entityVersionSchema.nullable().default(null),
  reason: boundedText(MAX_LABOR_REVISION_REASON_LENGTH).nullable().default(null),
  confirmed: z.literal(true),
})

export const caseVehicleProfileVersionSchema = z.strictObject({
  id: idSchema,
  profileVersion: entityVersionSchema,
  previousVersionId: idSchema.nullable(),
  schemaVersion: z.literal(CASE_VEHICLE_PROFILE_SCHEMA_VERSION),
  brand: z.string().min(1).max(MAX_VEHICLE_TEXT_LENGTH),
  model: z.string().min(1).max(MAX_VEHICLE_TEXT_LENGTH),
  modelYear: z.number().int().min(MIN_VEHICLE_MODEL_YEAR).max(MAX_VEHICLE_MODEL_YEAR),
  variant: z.string().min(1).max(MAX_VEHICLE_TEXT_LENGTH).nullable(),
  vehicleClass: z.enum(VEHICLE_CLASSES),
  chassisPrefix: z.string().min(3).max(MAX_VEHICLE_CHASSIS_PREFIX_LENGTH).nullable(),
  engineCode: z.string().min(2).max(24).nullable(),
  evidenceSource: z.enum(VEHICLE_EVIDENCE_SOURCES),
  evidenceReference: z.string().min(1).max(MAX_VEHICLE_EVIDENCE_REFERENCE_LENGTH).nullable(),
  revisionReason: z.string().min(1).max(MAX_LABOR_REVISION_REASON_LENGTH).nullable(),
  createdByUserId: userIdSchema,
  createdAt: utcDateTimeSchema,
})

export const caseVehicleProfileResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  profileId: idSchema.nullable(),
  version: entityVersionSchema.nullable(),
  current: caseVehicleProfileVersionSchema.nullable(),
  history: z.array(caseVehicleProfileVersionSchema).max(200),
  permissions: z.strictObject({ canEdit: z.boolean() }),
})

export type CaseVehicleProfileFields = z.infer<typeof caseVehicleProfileFieldsSchema>
export type CaseVehicleProfileSaveRequest = z.infer<typeof caseVehicleProfileSaveRequestSchema>
export type CaseVehicleProfileVersionDto = z.infer<typeof caseVehicleProfileVersionSchema>
export type CaseVehicleProfileResponse = z.infer<typeof caseVehicleProfileResponseSchema>
