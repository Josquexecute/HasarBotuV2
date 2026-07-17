import { z } from 'zod'
import {
  LABOR_AI_LOCAL_PRIVACY_POLICY_VERSION,
  LABOR_AI_MAX_REASONING_LENGTH,
  LABOR_AI_MAX_WARNINGS,
  LABOR_AI_OUTPUT_SCHEMA_VERSION,
  LABOR_AI_PRIVACY_POLICY_VERSION,
  LABOR_AI_PROMPT_TEMPLATE_VERSION,
  LABOR_AI_PROVIDER_IDS,
  LABOR_AI_RUN_STATUSES,
  MAX_LABOR_AI_SUGGESTED_ITEMS,
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
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
const amountMinorSchema = z.number().int().min(0).max(MAX_LABOR_AMOUNT_MINOR)

export const laborAiCaseParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const laborAiRunParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  runId: idSchema,
})

export const laborAiSuggestedItemSchema = z.strictObject({
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  partAmountMinor: amountMinorSchema,
  laborAmountMinor: amountMinorSchema,
})

export const laborAiSuggestionSchema = z.strictObject({
  schemaVersion: z.literal(LABOR_AI_OUTPUT_SCHEMA_VERSION),
  items: z.array(laborAiSuggestedItemSchema).min(1).max(MAX_LABOR_AI_SUGGESTED_ITEMS),
  reasoning: z.string().min(1).max(LABOR_AI_MAX_REASONING_LENGTH),
  warnings: z.array(z.string().min(1).max(200)).max(LABOR_AI_MAX_WARNINGS),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.literal(true),
})

export const laborAiPrivacySchema = z.strictObject({
  externalProvider: z.boolean(),
  policyVersion: z.enum([
    LABOR_AI_PRIVACY_POLICY_VERSION,
    LABOR_AI_LOCAL_PRIVACY_POLICY_VERSION,
  ]),
  outboundPayloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  outboundInputCharacters: z.number().int().min(1).max(200_000),
  redactedValueCount: z.number().int().min(0).max(10_000),
  redactedCategories: z.array(z.enum(POLICY_AI_PII_CATEGORIES)).max(POLICY_AI_PII_CATEGORIES.length),
  retentionMode: z.enum(['local_only', 'store_false', 'free_tier_product_improvement']),
  warnings: z.array(z.string().min(1).max(200)).max(20),
})

export const laborAiBudgetSchema = z.strictObject({
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

export const laborAiPlanResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  baseSheetVersion: entityVersionSchema.nullable(),
  providerId: z.enum(LABOR_AI_PROVIDER_IDS),
  providerVersion: providerTextSchema.nullable(),
  modelId: providerTextSchema.nullable(),
  promptTemplateVersion: z.literal(LABOR_AI_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(LABOR_AI_OUTPUT_SCHEMA_VERSION),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  privacy: laborAiPrivacySchema,
  budget: laborAiBudgetSchema,
  canStart: z.boolean(),
  requiresExplicitEgressConfirmation: z.boolean(),
  requiresHumanReview: z.literal(true),
})

export const laborAiRunSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  status: z.enum(LABOR_AI_RUN_STATUSES),
  providerId: z.enum(LABOR_AI_PROVIDER_IDS),
  providerVersion: providerTextSchema,
  modelId: providerTextSchema,
  promptTemplateVersion: z.literal(LABOR_AI_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(LABOR_AI_OUTPUT_SCHEMA_VERSION),
  baseSheetVersion: entityVersionSchema.nullable(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: entityVersionSchema,
  privacy: laborAiPrivacySchema,
  budget: laborAiBudgetSchema,
  suggestion: laborAiSuggestionSchema.nullable(),
  safeErrorCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).nullable(),
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
})

export const laborAiRunResponseSchema = z.strictObject({
  run: laborAiRunSchema,
})

export const laborAiRunsResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  items: z.array(laborAiRunSchema).max(1_000),
  permissions: z.strictObject({
    canStart: z.boolean(),
  }),
})

export type LaborAiSuggestedItemDto = z.infer<typeof laborAiSuggestedItemSchema>
export type LaborAiSuggestion = z.infer<typeof laborAiSuggestionSchema>
export type LaborAiPrivacy = z.infer<typeof laborAiPrivacySchema>
export type LaborAiBudget = z.infer<typeof laborAiBudgetSchema>
export type LaborAiPlanResponse = z.infer<typeof laborAiPlanResponseSchema>
export type LaborAiRun = z.infer<typeof laborAiRunSchema>
export type LaborAiRunResponse = z.infer<typeof laborAiRunResponseSchema>
export type LaborAiRunsResponse = z.infer<typeof laborAiRunsResponseSchema>
