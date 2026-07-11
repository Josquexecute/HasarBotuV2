import { z } from 'zod'
import {
  caseIdSchema,
  caseStageSchema,
  caseStatusSchema,
  caseTypeSchema,
  entityVersionSchema,
  insurerClaimNumberSchema,
  insurerIdSchema,
  localDateSchema,
  notificationFormNumberSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  serviceIdSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { pageInfoSchema } from '../../common/pagination.js'

/**
 * Wire DTO alan bicimi.
 *
 * - Zorunlu alanlar her zaman bulunur.
 * - Domainde `undefined` olan opsiyonel iliskiler wire'da tutarli sekilde `null` tasinir
 *   (alan her zaman bulunur, deger `null` olur). Donusum saf mapper'larla acik yapilir.
 * - Sunum alani veya Turkce sabit etiket yoktur.
 */
const caseDtoShape = {
  id: caseIdSchema,
  caseType: caseTypeSchema,
  officeCaseNumber: officeCaseNumberSchema,
  notificationFormNumber: notificationFormNumberSchema.nullable(),
  insurerClaimNumber: insurerClaimNumberSchema.nullable(),
  plate: plateNumberSchema,
  status: caseStatusSchema,
  stage: caseStageSchema,
  responsibleUserId: userIdSchema.nullable(),
  serviceId: serviceIdSchema.nullable(),
  insurerId: insurerIdSchema.nullable(),
  followUpDate: localDateSchema.nullable(),
  lastInterventionAt: utcDateTimeSchema.nullable(),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
  version: entityVersionSchema,
} as const

/** `GET /api/v1/cases` liste ogesi DTO'su. */
export const caseListItemSchema = z.strictObject(caseDtoShape)
export type CaseListItem = z.infer<typeof caseListItemSchema>

/**
 * `GET /api/v1/cases/:caseId` detay DTO'su.
 * Read-only Paket 03 kapsaminda yalniz CaseCore seviyesindeki temel alanlari tasir;
 * notes/tasks/documents/photos/labor/parts/value-loss/heavy-damage/email/audit
 * gecmisi henuz eklenmez.
 */
export const caseDetailSchema = z.strictObject(caseDtoShape)
export type CaseDetail = z.infer<typeof caseDetailSchema>

/** Liste yaniti govdesi: sayfalanmis ogeler + sayfa bilgisi. */
export const caseListResponseSchema = z.strictObject({
  items: z.array(caseListItemSchema),
  pageInfo: pageInfoSchema,
})
export type CaseListResponse = z.infer<typeof caseListResponseSchema>

/** Detay route path parametreleri. */
export const caseDetailParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})
export type CaseDetailParams = z.infer<typeof caseDetailParamsSchema>

/** Detay yaniti govdesi. */
export const caseDetailResponseSchema = z.strictObject({
  case: caseDetailSchema,
})
export type CaseDetailResponse = z.infer<typeof caseDetailResponseSchema>
