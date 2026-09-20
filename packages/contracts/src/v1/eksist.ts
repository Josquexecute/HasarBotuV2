import { z } from 'zod'
import { caseCreateRequestSchema } from './cases/commands.js'
import { caseVehicleProfileFieldsSchema } from './case-vehicle-profile/dto.js'
import { idSchema, localDateSchema } from '../common/primitives.js'

export const eksistUploadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().trim().min(1).max(200_000) }),
  z.strictObject({ kind: z.enum(['pdf', 'image']), name: z.string().trim().min(1).max(200), base64: z.string().min(1).max(14_000_000) }),
])
export const quickCaseCreateSchema = z.strictObject({
  case: caseCreateRequestSchema.extend({ notificationDate: localDateSchema }),
  storageRootKey: z.string().trim().min(1).max(100),
  source: z.strictObject({
    id: idSchema,
    reference: z.string().trim().regex(/^[A-Za-z0-9/-]{1,80}$/),
    serviceRevision: z.strictObject({ name: z.string().trim().min(1).max(500) }).optional(),
    expertReview: z.strictObject({ name: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).optional(),
    vehicleDraft: z.strictObject({ brand: z.string().max(500), model: z.string().max(500), modelYear: z.string().max(50), vehicleClass: z.string().max(100) }).optional(),
  }).optional(),
  vehicle: caseVehicleProfileFieldsSchema.optional(),
})
export type QuickCaseCreate = z.input<typeof quickCaseCreateSchema>
