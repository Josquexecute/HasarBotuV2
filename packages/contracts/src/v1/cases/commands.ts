import { z } from 'zod'
import {
  openCaseStageSchema,
  caseTypeSchema,
  entityVersionSchema,
  idSchema,
  insurerClaimNumberSchema,
  insurerIdSchema,
  localDateSchema,
  notificationFormNumberSchema,
  plateNumberSchema,
  serviceIdSchema,
  userIdSchema,
} from '../../common/primitives.js'

/**
 * Cases yazma komut sozlesmeleri (Paket 09).
 *
 * - Ofis numarasi SUNUCU tarafindan atanir; istekte tasinamaz.
 * - lifecycle_status, plaka ve dosya turu bu komutlarla degistirilemez
 *   (kapanis/yeniden acma ayri kritik islemdir; plaka fiziksel klasor
 *   kimligidir ve File Agent kapsamindadir).
 * - Guncelleme PATCH semantigi: alan yoksa degismez; nullable alanda `null`
 *   degeri temizler. `expectedVersion` optimistic locking icin zorunludur.
 */

/** Kritik POST komutlarinda zorunlu idempotency basligi. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
export const idempotencyKeySchema = idSchema

export const caseCreateRequestSchema = z.strictObject({
  caseType: caseTypeSchema,
  plate: plateNumberSchema,
  workflowStage: openCaseStageSchema.default('new_notification'),
  notificationFormNumber: notificationFormNumberSchema.optional(),
  insurerClaimNumber: insurerClaimNumberSchema.optional(),
  responsibleUserId: userIdSchema.optional(),
  expertUserId: userIdSchema.optional(),
  serviceId: serviceIdSchema.optional(),
  insurerId: insurerIdSchema.optional(),
  followUpDate: localDateSchema.optional(),
  lossDate: localDateSchema.optional(),
  notificationDate: localDateSchema.optional(),
})
export type CaseCreateRequest = z.infer<typeof caseCreateRequestSchema>
export type CaseCreateRequestInput = z.input<typeof caseCreateRequestSchema>

const caseUpdateFields = z.strictObject({
  expectedVersion: entityVersionSchema,
  workflowStage: openCaseStageSchema.optional(),
  followUpDate: localDateSchema.nullable().optional(),
  notificationFormNumber: notificationFormNumberSchema.nullable().optional(),
  insurerClaimNumber: insurerClaimNumberSchema.nullable().optional(),
  responsibleUserId: userIdSchema.nullable().optional(),
  expertUserId: userIdSchema.nullable().optional(),
  serviceId: serviceIdSchema.nullable().optional(),
  insurerId: insurerIdSchema.nullable().optional(),
  lossDate: localDateSchema.nullable().optional(),
  notificationDate: localDateSchema.nullable().optional(),
})

export const CASE_UPDATABLE_FIELDS = [
  'workflowStage',
  'followUpDate',
  'notificationFormNumber',
  'insurerClaimNumber',
  'responsibleUserId',
  'expertUserId',
  'serviceId',
  'insurerId',
  'lossDate',
  'notificationDate',
] as const

export const caseUpdateRequestSchema = caseUpdateFields.refine(
  (value) => CASE_UPDATABLE_FIELDS.some((field) => value[field] !== undefined),
  { error: 'at_least_one_field_required' },
)
export type CaseUpdateRequest = z.infer<typeof caseUpdateRequestSchema>
