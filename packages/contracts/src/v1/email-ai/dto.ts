import { z } from 'zod'
import {
  EMAIL_AI_LOCAL_PRIVACY_POLICY_VERSION,
  EMAIL_AI_MAX_BODY_LENGTH,
  EMAIL_AI_MAX_REASONING_LENGTH,
  EMAIL_AI_MAX_WARNINGS,
  EMAIL_AI_OUTPUT_SCHEMA_VERSION,
  EMAIL_AI_PRIVACY_POLICY_VERSION,
  EMAIL_AI_PROMPT_TEMPLATE_VERSION,
  EMAIL_AI_PROVIDER_IDS,
  EMAIL_AI_RUN_STATUSES,
  EMAIL_DRAFT_TYPES,
  POLICY_AI_PII_CATEGORIES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const providerTextSchema = z.string().min(1).max(80)

export const emailAiCaseParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const emailAiRunParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  runId: idSchema,
})

export const emailAiSuggestionSchema = z.strictObject({
  schemaVersion: z.literal(EMAIL_AI_OUTPUT_SCHEMA_VERSION),
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(EMAIL_AI_MAX_BODY_LENGTH),
  reasoning: z.string().min(1).max(EMAIL_AI_MAX_REASONING_LENGTH),
  warnings: z.array(z.string().min(1).max(200)).max(EMAIL_AI_MAX_WARNINGS),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.literal(true),
})

export const emailAiPrivacySchema = z.strictObject({
  externalProvider: z.boolean(),
  policyVersion: z.enum([
    EMAIL_AI_PRIVACY_POLICY_VERSION,
    EMAIL_AI_LOCAL_PRIVACY_POLICY_VERSION,
  ]),
  outboundPayloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  outboundInputCharacters: z.number().int().min(1).max(200_000),
  redactedValueCount: z.number().int().min(0).max(10_000),
  redactedCategories: z.array(z.enum(POLICY_AI_PII_CATEGORIES)).max(POLICY_AI_PII_CATEGORIES.length),
  retentionMode: z.enum(['local_only', 'store_false', 'free_tier_product_improvement']),
  warnings: z.array(z.string().min(1).max(200)).max(20),
})

export const emailAiBudgetSchema = z.strictObject({
  enabled: z.boolean(),
  providerAvailable: z.boolean(),
  providerAllowed: z.boolean(),
  estimatedCostMinor: safeIntegerSchema,
  currentMonthCostMinor: safeIntegerSchema,
  monthlyBudgetMinor: safeIntegerSchema,
  perRequestBudgetMinor: safeIntegerSchema,
  allowed: z.boolean(),
  reasonCode: z.enum([
    'AI_PROVIDER_DISABLED',
    'AI_BUDGET_EXCEEDED',
    'AI_PROVIDER_NOT_CONFIGURED',
  ]).nullable(),
})

export const emailAiPlanResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  providerId: z.enum(EMAIL_AI_PROVIDER_IDS),
  providerVersion: providerTextSchema.nullable(),
  modelId: providerTextSchema.nullable(),
  promptTemplateVersion: z.literal(EMAIL_AI_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(EMAIL_AI_OUTPUT_SCHEMA_VERSION),
  basePreview: z.strictObject({
    subject: z.string().min(1).max(240),
    body: z.string().min(1).max(EMAIL_AI_MAX_BODY_LENGTH),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  privacy: emailAiPrivacySchema,
  budget: emailAiBudgetSchema,
  canStart: z.boolean(),
  requiresExplicitEgressConfirmation: z.boolean(),
  requiresHumanReview: z.literal(true),
})

export const emailAiRunSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  draftType: z.enum(EMAIL_DRAFT_TYPES),
  status: z.enum(EMAIL_AI_RUN_STATUSES),
  providerId: z.enum(EMAIL_AI_PROVIDER_IDS),
  providerVersion: providerTextSchema,
  modelId: providerTextSchema,
  promptTemplateVersion: z.literal(EMAIL_AI_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(EMAIL_AI_OUTPUT_SCHEMA_VERSION),
  basePreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: entityVersionSchema,
  privacy: emailAiPrivacySchema,
  budget: emailAiBudgetSchema,
  suggestion: emailAiSuggestionSchema.nullable(),
  safeErrorCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).nullable(),
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
})

export const emailAiRunResponseSchema = z.strictObject({
  run: emailAiRunSchema,
})

export const emailAiRunsResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  items: z.array(emailAiRunSchema).max(1_000),
  permissions: z.strictObject({
    canStart: z.boolean(),
  }),
})

export type EmailAiSuggestion = z.infer<typeof emailAiSuggestionSchema>
export type EmailAiPrivacy = z.infer<typeof emailAiPrivacySchema>
export type EmailAiBudget = z.infer<typeof emailAiBudgetSchema>
export type EmailAiPlanResponse = z.infer<typeof emailAiPlanResponseSchema>
export type EmailAiRun = z.infer<typeof emailAiRunSchema>
export type EmailAiRunResponse = z.infer<typeof emailAiRunResponseSchema>
export type EmailAiRunsResponse = z.infer<typeof emailAiRunsResponseSchema>
