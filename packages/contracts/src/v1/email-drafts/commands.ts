import { z } from 'zod'
import {
  EMAIL_DRAFT_TYPES,
  MAX_EMAIL_DRAFT_ATTACHMENTS,
  MAX_EMAIL_DRAFT_BODY_LENGTH,
  MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH,
  MAX_EMAIL_DRAFT_RECIPIENTS,
  MAX_EMAIL_DRAFT_SUBJECT_LENGTH,
} from '@hasarbotu/domain'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'
import { MAX_EMAIL_LENGTH } from '../auth/index.js'

const normalizedText = (maximum: number) => z.string().trim().min(1).max(maximum)
const emailInputSchema = z.string().trim().toLowerCase().min(3).max(MAX_EMAIL_LENGTH)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: 'invalid_email_format' })
const emailListSchema = z.array(emailInputSchema).max(MAX_EMAIL_DRAFT_RECIPIENTS)

export const emailDraftAttachmentReferenceSchema = z.strictObject({
  resourceType: z.enum(['document_version', 'photo']),
  resourceId: idSchema,
})

export const emailDraftPreviewRequestSchema = z.strictObject({
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  instruction: z.string().trim().max(MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH).nullable().default(null),
})

export const emailDraftCreateRequestSchema = z.strictObject({
  expectedCaseVersion: entityVersionSchema,
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  instruction: z.string().trim().max(MAX_EMAIL_DRAFT_INSTRUCTION_LENGTH).nullable().default(null),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  to: emailListSchema.min(1),
  cc: emailListSchema.default([]),
  subject: normalizedText(MAX_EMAIL_DRAFT_SUBJECT_LENGTH),
  body: normalizedText(MAX_EMAIL_DRAFT_BODY_LENGTH),
  attachments: z.array(emailDraftAttachmentReferenceSchema).max(MAX_EMAIL_DRAFT_ATTACHMENTS).default([]),
  confirmed: z.literal(true),
})

export const emailDraftReviseRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  to: emailListSchema.min(1),
  cc: emailListSchema.default([]),
  subject: normalizedText(MAX_EMAIL_DRAFT_SUBJECT_LENGTH),
  body: normalizedText(MAX_EMAIL_DRAFT_BODY_LENGTH),
  attachments: z.array(emailDraftAttachmentReferenceSchema).max(MAX_EMAIL_DRAFT_ATTACHMENTS).default([]),
  reason: normalizedText(500),
  confirmed: z.literal(true),
})

export const emailDraftHandoffRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  confirmed: z.literal(true),
})

export type EmailDraftAttachmentReference = z.infer<typeof emailDraftAttachmentReferenceSchema>
export type EmailDraftPreviewRequest = z.infer<typeof emailDraftPreviewRequestSchema>
export type EmailDraftCreateRequest = z.infer<typeof emailDraftCreateRequestSchema>
export type EmailDraftReviseRequest = z.infer<typeof emailDraftReviseRequestSchema>
export type EmailDraftHandoffRequest = z.infer<typeof emailDraftHandoffRequestSchema>
