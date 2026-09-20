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
import { serviceReferenceSchema } from '../references/dto.js'
import { eksistCaseDataSchema } from '../eksist-case.js'

/**
 * Wire DTO alan bicimi.
 *
 * - Zorunlu alanlar her zaman bulunur.
 * - Domainde `undefined` olan opsiyonel iliskiler wire'da tutarli sekilde `null` tasinir
 *   (alan her zaman bulunur, deger `null` olur). Donusum saf mapper'larla acik yapilir.
 * - Sunum alani veya Turkce sabit etiket yoktur.
 */
const caseDtoShape = {
  eksist: eksistCaseDataSchema.optional(),
  id: caseIdSchema,
  caseType: caseTypeSchema,
  officeCaseNumber: officeCaseNumberSchema,
  notificationFormNumber: notificationFormNumberSchema.nullable(),
  insurerClaimNumber: insurerClaimNumberSchema.nullable(),
  plate: plateNumberSchema,
  status: caseStatusSchema,
  stage: caseStageSchema,
  responsibleUserId: userIdSchema.nullable(),
  expertUserId: userIdSchema.nullable(),
  serviceId: serviceIdSchema.nullable(),
  serviceProfile: serviceReferenceSchema.nullable(),
  insurerId: insurerIdSchema.nullable(),
  followUpDate: localDateSchema.nullable(),
  lossDate: localDateSchema.nullable(),
  notificationDate: localDateSchema.nullable(),
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

const legacyReferenceNameSchema = z.string().trim().min(1).max(160)

/**
 * V1 aktariminda immutable source revision icinde korunmus tarihsel referanslar.
 * Diziler, ayni case'e bagli birden fazla gercek V1 source varsa veri kaybini
 * engeller. First-class V2 iliskileri bu alanlarla doldurulmaz.
 */
export const caseLegacyReferencesSchema = z.strictObject({
  responsibleNames: z.array(legacyReferenceNameSchema).max(20),
  expertNames: z.array(legacyReferenceNameSchema).max(20),
  serviceNames: z.array(legacyReferenceNameSchema).max(20),
})
export type CaseLegacyReferences = z.infer<typeof caseLegacyReferencesSchema>

/**
 * Opt-in detail sozlesmesi. Varsayilan detail yaniti eski strict istemciler
 * icin degismez; yeni istemci `includeLegacyReferences=true` ile bunu ister.
 */
export const caseDetailWithLegacyReferencesSchema = caseDetailSchema.extend({
  legacyReferences: caseLegacyReferencesSchema,
})
export type CaseDetailWithLegacyReferences = z.infer<typeof caseDetailWithLegacyReferencesSchema>

export const caseDetailQuerySchema = z.strictObject({
  includeLegacyReferences: z.literal('true').optional(),
  includeEksist: z.literal('true').optional(),
})
export type CaseDetailQuery = z.infer<typeof caseDetailQuerySchema>

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

export const caseDetailWithLegacyReferencesResponseSchema = z.strictObject({
  case: caseDetailWithLegacyReferencesSchema,
})
export type CaseDetailWithLegacyReferencesResponse = z.infer<typeof caseDetailWithLegacyReferencesResponseSchema>
