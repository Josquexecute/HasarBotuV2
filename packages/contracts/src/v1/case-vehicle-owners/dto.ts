import { z } from 'zod'
import { MAX_CASE_VEHICLE_OWNERS, MAX_OWNER_NAME_LENGTH, MAX_OWNER_PHONE_LENGTH } from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

/**
 * Dosya Envanteri — araç sahibi mini-yakalama sözleşmesi.
 *
 * Tam sürüm zinciri yoktur: liste tek seferde değiştirilir. `setVersion`
 * `null` ise dosya için hiç kaydedilmiş sahip listesi yoktur (henüz
 * `Eksik`); ilk kayıtta `expectedSetVersion` de `null` gönderilir.
 */
export const caseVehicleOwnersParamsSchema = z.strictObject({ caseId: caseIdSchema })

export const caseVehicleOwnerSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_OWNER_NAME_LENGTH),
  phone: z.string().trim().min(1).max(MAX_OWNER_PHONE_LENGTH).nullable(),
})

export const caseVehicleOwnersResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  setVersion: entityVersionSchema.nullable(),
  owners: z.array(caseVehicleOwnerSchema).max(MAX_CASE_VEHICLE_OWNERS),
  updatedByUserId: userIdSchema.nullable(),
  updatedAt: utcDateTimeSchema.nullable(),
  permissions: z.strictObject({ canEdit: z.boolean() }),
})

export type CaseVehicleOwnerDto = z.infer<typeof caseVehicleOwnerSchema>
export type CaseVehicleOwnersResponse = z.infer<typeof caseVehicleOwnersResponseSchema>
