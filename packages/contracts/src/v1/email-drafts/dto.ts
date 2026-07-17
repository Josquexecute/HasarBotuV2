import { z } from 'zod'
import {
  EMAIL_DRAFT_SOURCE_TYPES,
  EMAIL_DRAFT_TEMPLATE_VERSION,
  EMAIL_DRAFT_TYPES,
  EMAIL_HANDOFF_PROVIDERS,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  utcDateTimeSchema,
  userIdSchema,
} from '../../common/primitives.js'
import { emailSchema } from '../auth/index.js'

const displayNameSchema = z.string().min(1).max(200)

export const emailDraftParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const emailDraftResourceParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  draftId: idSchema,
})

export const emailDraftAttachmentOptionSchema = z.strictObject({
  resourceType: z.enum(['document_version', 'photo']),
  resourceId: idSchema,
  documentType: z.string().min(1).max(64).nullable(),
  displayName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(128),
  byteSize: z.number().int().min(0),
  preferred: z.boolean(),
  status: z.literal('ready'),
})

export const emailDraftAttachmentSchema = emailDraftAttachmentOptionSchema.omit({
  preferred: true,
})

export const emailDraftPreviewResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  templateVersion: z.literal(EMAIL_DRAFT_TEMPLATE_VERSION),
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(20_000),
  sourceRule: z.string().min(1).max(100),
  recipientStatus: z.literal('control_required'),
  recipientReason: z.string().min(1).max(500),
  missingRequirementCodes: z.array(z.string().min(1).max(100)).max(100),
  controlRequiredRequirementCodes: z.array(z.string().min(1).max(100)).max(100),
  attachmentOptions: z.array(emailDraftAttachmentOptionSchema).max(1_000),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  requiresHumanReview: z.literal(true),
})

export const emailDraftVersionSchema = z.strictObject({
  id: idSchema,
  draftVersion: entityVersionSchema,
  previousVersionId: idSchema.nullable(),
  to: z.array(emailSchema).min(1).max(10),
  cc: z.array(emailSchema).max(10),
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(20_000),
  attachments: z.array(emailDraftAttachmentSchema).max(20),
  templateVersion: z.literal(EMAIL_DRAFT_TEMPLATE_VERSION),
  sourceType: z.enum(EMAIL_DRAFT_SOURCE_TYPES),
  emailAiSuggestionRunId: idSchema.nullable(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  revisionReason: z.string().min(1).max(500).nullable(),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
})

export const emailDraftHandoffSchema = z.strictObject({
  id: idSchema,
  draftVersionId: idSchema,
  provider: z.enum(EMAIL_HANDOFF_PROVIDERS),
  preparedByUserId: userIdSchema,
  preparedByDisplayName: displayNameSchema,
  preparedAt: utcDateTimeSchema,
})

export const emailDraftSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  version: entityVersionSchema,
  currentVersion: emailDraftVersionSchema,
  versions: z.array(emailDraftVersionSchema).min(1).max(1_000),
  handoffs: z.array(emailDraftHandoffSchema).max(1_000),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const emailDraftPermissionsSchema = z.strictObject({
  canWrite: z.boolean(),
  canPrepareHandoff: z.boolean(),
})

export const emailDraftWorkspaceResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  lifecycleStatus: z.enum(['open', 'closed']),
  drafts: z.array(emailDraftSchema).max(1_000),
  permissions: emailDraftPermissionsSchema,
})

export const emailDraftResponseSchema = z.strictObject({
  draft: emailDraftSchema,
})

export const emailDraftHandoffResponseSchema = z.strictObject({
  draft: emailDraftSchema,
  handoff: emailDraftHandoffSchema,
  compose: z.strictObject({
    to: z.array(emailSchema).min(1).max(10),
    cc: z.array(emailSchema).max(10),
    subject: z.string().min(1).max(240),
    body: z.string().min(1).max(20_000),
    attachments: z.array(emailDraftAttachmentSchema).max(20),
  }),
  deliveryStatus: z.literal('not_sent'),
})

export type EmailDraftParams = z.infer<typeof emailDraftParamsSchema>
export type EmailDraftResourceParams = z.infer<typeof emailDraftResourceParamsSchema>
export type EmailDraftAttachmentOption = z.infer<typeof emailDraftAttachmentOptionSchema>
export type EmailDraftAttachment = z.infer<typeof emailDraftAttachmentSchema>
export type EmailDraftPreviewResponse = z.infer<typeof emailDraftPreviewResponseSchema>
export type EmailDraftVersion = z.infer<typeof emailDraftVersionSchema>
export type EmailDraftHandoff = z.infer<typeof emailDraftHandoffSchema>
export type EmailDraft = z.infer<typeof emailDraftSchema>
export type EmailDraftWorkspaceResponse = z.infer<typeof emailDraftWorkspaceResponseSchema>
export type EmailDraftResponse = z.infer<typeof emailDraftResponseSchema>
export type EmailDraftHandoffResponse = z.infer<typeof emailDraftHandoffResponseSchema>
