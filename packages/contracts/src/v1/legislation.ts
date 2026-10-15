import { z } from 'zod'
import { localDateSchema, idSchema } from '../common/primitives.js'

export const legislationKindSchema = z.enum(['Kanun', 'Genel Şartlar', 'Değişiklik'])
export const legislationSourceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/), title: z.string(), kind: legislationKindSchema,
  publisher: z.string(), url: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && ['www.mevzuat.gov.tr', 'seddk.gov.tr', 'www.resmigazete.gov.tr'].includes(url.hostname)
  }),
  format: z.enum(['pdf', 'docx_archive']).default('pdf'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), verifiedAt: z.iso.datetime(),
  effectiveFrom: localDateSchema.nullable(), applicability: z.literal('snapshot_requires_date_review'), pageCount: z.number().int().positive(),
})
export const legislationLibrarySchema = z.strictObject({ version: z.string(), aiEnabled: z.boolean(), sources: z.array(legislationSourceSchema) })
export const legislationPageSchema = z.strictObject({ source: legislationSourceSchema, page: z.number().int().positive(), text: z.string() })
export const legislationQuestionSchema = z.strictObject({
  question: z.string().trim().min(3).max(2000), mode: z.enum(['sources', 'ai']),
  eventDate: localDateSchema.nullable(), sourceIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(10).default([]),
  caseId: idSchema.nullable().default(null),
})
export const legislationCitationSchema = z.strictObject({ id: z.string(), sourceId: z.string(), title: z.string(), url: z.url(), page: z.number().int().positive(), locatorKind: z.enum(['page', 'annex']), contentHash: z.string(), excerpt: z.string() })
export const legislationAnswerSchema = z.strictObject({
  id: idSchema, mode: z.enum(['sources', 'ai']), createdAt: z.iso.datetime(), question: z.string(),
  eventDate: localDateSchema.nullable(), caseId: idSchema.nullable(), libraryVersion: z.string(),
  provider: z.strictObject({ name: z.literal('gemini'), model: z.string() }).nullable(),
  statements: z.array(z.strictObject({ text: z.string(), citationIds: z.array(z.string()).min(1) })),
  citations: z.array(legislationCitationSchema), missingInformation: z.array(z.string()), requiresReview: z.literal(true),
})
export const legislationHistorySchema = z.strictObject({ items: z.array(legislationAnswerSchema) })
export const legislationAiSettingsSchema = z.strictObject({ organizationId: idSchema, version: z.number().int().nonnegative(), configured: z.boolean(), enabled: z.boolean(), model: z.string(), canConfigure: z.boolean(), encryptionAvailable: z.boolean() })
// Auth keys issued by AI Studio can contain periods and exceed legacy key lengths.
export const legislationAiSettingsUpdateSchema = z.strictObject({ expectedOrganizationId: idSchema, expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(), model: z.string().trim().regex(/^gemini-[a-z0-9.-]{1,70}$/), apiKey: z.string().trim().min(20).max(4096).regex(/^[A-Za-z0-9._-]+$/).optional() })
export type LegislationSource = z.infer<typeof legislationSourceSchema>
export type LegislationAnswer = z.infer<typeof legislationAnswerSchema>
export type LegislationQuestion = z.infer<typeof legislationQuestionSchema>
