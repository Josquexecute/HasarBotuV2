import { sha256Text } from './pdf-text-extraction.js'
import {
  minimizePolicyAiSources,
  type PolicyAiPiiCategory,
} from './policy-ai-privacy.js'
import { detectPolicyAiPromptInjection } from './policy-ai.js'
import type { CaseType } from './case-type.js'
import type { EmailDraftType } from './email-draft.js'

export const EMAIL_AI_PROMPT_TEMPLATE_VERSION = 'email-ai-draft/1.0.0' as const
export const EMAIL_AI_OUTPUT_SCHEMA_VERSION = 'email-ai-suggestion/1.0.0' as const
export const EMAIL_AI_PRIVACY_POLICY_VERSION = 'email-ai-pii-redaction/1.0.0' as const
export const EMAIL_AI_LOCAL_PRIVACY_POLICY_VERSION = 'email-ai-pii/local-only' as const
export const EMAIL_AI_PROVIDER_IDS = [
  'deterministic-success',
  'deterministic-invalid-schema',
  'deterministic-timeout',
  'deterministic-failure',
  'gemini-generate-content',
] as const
export const EMAIL_AI_RUN_STATUSES = [
  'provider_disabled',
  'budget_blocked',
  'running',
  'review_required',
  'failed',
  'outcome_unknown',
] as const
export const EMAIL_AI_MAX_SUBJECT_SUFFIX_LENGTH = 120
export const EMAIL_AI_MAX_BODY_LENGTH = 20_000
export const EMAIL_AI_MAX_REASONING_LENGTH = 500
export const EMAIL_AI_MAX_WARNINGS = 10

export type EmailAiProviderId = (typeof EMAIL_AI_PROVIDER_IDS)[number]
export type EmailAiRunStatus = (typeof EMAIL_AI_RUN_STATUSES)[number]

export interface EmailAiPlanContext {
  readonly organizationId: string
  readonly caseId: string
  readonly caseVersion: number
  readonly caseType: CaseType
  readonly draftType: EmailDraftType
  readonly previewHash: string
  readonly baseBody: string
  readonly instruction: string | null
  readonly sourceRule: string
  readonly missingRequirementCodes: readonly string[]
  readonly controlRequiredRequirementCodes: readonly string[]
  readonly providerId: EmailAiProviderId
  readonly providerVersion: string
  readonly modelId: string
  readonly externalProvider: boolean
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
}

export interface EmailAiOutboundContext {
  readonly context: {
    readonly caseType: CaseType
    readonly draftType: EmailDraftType
    readonly sourceRule: string
    readonly baseBody: string
    readonly instruction: string | null
    readonly missingRequirementCodes: readonly string[]
    readonly controlRequiredRequirementCodes: readonly string[]
  }
  readonly privacyPolicyVersion:
    | typeof EMAIL_AI_PRIVACY_POLICY_VERSION
    | typeof EMAIL_AI_LOCAL_PRIVACY_POLICY_VERSION
  readonly outboundPayloadHash: string | null
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly PolicyAiPiiCategory[]
  readonly warnings: readonly string[]
}

export interface EmailAiSuggestionInput {
  readonly schemaVersion: typeof EMAIL_AI_OUTPUT_SCHEMA_VERSION
  readonly subjectSuffix: string
  readonly body: string
  readonly reasoning: string
  readonly warnings: readonly string[]
  readonly confidence: number
  readonly requiresHumanReview: true
}

export type EmailAiSuggestionValidation =
  | { readonly allowed: true; readonly suggestion: EmailAiSuggestionInput }
  | {
      readonly allowed: false
      readonly code:
        | 'AI_OUTPUT_SCHEMA_INVALID'
        | 'AI_OUTPUT_PII_UNSAFE'
        | 'AI_OUTPUT_PLACEHOLDER_UNSAFE'
        | 'AI_OUTPUT_EXTERNAL_REFERENCE_UNSAFE'
        | 'AI_OUTPUT_PATH_UNSAFE'
    }

function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non_finite_number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  throw new Error('unsupported_canonical_value')
}

export function buildEmailAiOutboundContext(input: EmailAiPlanContext): EmailAiOutboundContext {
  const rawSources = [
    { sourceAnchorId: 'template-body', text: input.baseBody },
    ...(input.instruction === null
      ? []
      : [{ sourceAnchorId: 'user-instruction', text: input.instruction }]),
  ]
  const injectionWarnings = rawSources.flatMap((source) => (
    detectPolicyAiPromptInjection(source.text).map((warning) => `${source.sourceAnchorId}:${warning}`)
  ))
  if (!input.externalProvider) {
    const context = {
      caseType: input.caseType,
      draftType: input.draftType,
      sourceRule: input.sourceRule,
      baseBody: input.baseBody,
      instruction: input.instruction,
      missingRequirementCodes: [...input.missingRequirementCodes],
      controlRequiredRequirementCodes: [...input.controlRequiredRequirementCodes],
    }
    return {
      context,
      privacyPolicyVersion: EMAIL_AI_LOCAL_PRIVACY_POLICY_VERSION,
      outboundPayloadHash: null,
      outboundInputCharacters: canonical(context).length,
      redactedValueCount: 0,
      redactedCategories: [],
      warnings: injectionWarnings,
    }
  }
  const minimized = minimizePolicyAiSources(rawSources)
  const minimizedMap = new Map(minimized.sources.map((source) => [source.sourceAnchorId, source.text]))
  const context = {
    caseType: input.caseType,
    draftType: input.draftType,
    sourceRule: input.sourceRule,
    baseBody: minimizedMap.get('template-body') ?? '',
    instruction: input.instruction === null ? null : (minimizedMap.get('user-instruction') ?? ''),
    missingRequirementCodes: [...input.missingRequirementCodes],
    controlRequiredRequirementCodes: [...input.controlRequiredRequirementCodes],
  }
  return {
    context,
    privacyPolicyVersion: EMAIL_AI_PRIVACY_POLICY_VERSION,
    outboundPayloadHash: sha256Text(`email-ai-outbound/1|${canonical(context)}`),
    outboundInputCharacters: canonical(context).length,
    redactedValueCount: minimized.redactedValueCount,
    redactedCategories: minimized.redactedCategories,
    warnings: injectionWarnings,
  }
}

export function buildEmailAiPlanHash(input: EmailAiPlanContext, outbound: EmailAiOutboundContext): string {
  return sha256Text(canonical({
    schemaVersion: EMAIL_AI_OUTPUT_SCHEMA_VERSION,
    promptTemplateVersion: EMAIL_AI_PROMPT_TEMPLATE_VERSION,
    organizationId: input.organizationId,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    draftType: input.draftType,
    previewHash: input.previewHash,
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    modelId: input.modelId,
    retentionMode: input.retentionMode,
    pricingVersion: input.pricingVersion,
    privacyPolicyVersion: outbound.privacyPolicyVersion,
    outboundPayloadHash: outbound.outboundPayloadHash,
    outboundContext: outbound.context,
  }))
}

function isValidSuggestionShape(value: unknown): value is EmailAiSuggestionInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => ![
    'schemaVersion',
    'subjectSuffix',
    'body',
    'reasoning',
    'warnings',
    'confidence',
    'requiresHumanReview',
  ].includes(key))) return false
  return item.schemaVersion === EMAIL_AI_OUTPUT_SCHEMA_VERSION
    && typeof item.subjectSuffix === 'string'
    && item.subjectSuffix.trim().length >= 1
    && item.subjectSuffix.trim().length <= EMAIL_AI_MAX_SUBJECT_SUFFIX_LENGTH
    && typeof item.body === 'string'
    && item.body.trim().length >= 1
    && item.body.trim().length <= EMAIL_AI_MAX_BODY_LENGTH
    && typeof item.reasoning === 'string'
    && item.reasoning.trim().length >= 1
    && item.reasoning.trim().length <= EMAIL_AI_MAX_REASONING_LENGTH
    && Array.isArray(item.warnings)
    && item.warnings.length <= EMAIL_AI_MAX_WARNINGS
    && item.warnings.every((warning) => typeof warning === 'string' && warning.trim().length >= 1 && warning.trim().length <= 200)
    && typeof item.confidence === 'number'
    && Number.isFinite(item.confidence)
    && item.confidence >= 0
    && item.confidence <= 1
    && item.requiresHumanReview === true
}

export function validateEmailAiSuggestion(value: unknown): EmailAiSuggestionValidation {
  if (!isValidSuggestionShape(value)) return { allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' }
  const suggestion: EmailAiSuggestionInput = {
    ...value,
    subjectSuffix: value.subjectSuffix.trim(),
    body: value.body.trim(),
    reasoning: value.reasoning.trim(),
    warnings: value.warnings.map((warning) => warning.trim()),
  }
  const combined = `${suggestion.subjectSuffix}\n${suggestion.body}\n${suggestion.reasoning}\n${suggestion.warnings.join('\n')}`
  if (/\[PII:[A-Z_]+_\d+\]/u.test(combined)) {
    return { allowed: false, code: 'AI_OUTPUT_PLACEHOLDER_UNSAFE' }
  }
  if (/https?:\/\/|www\./iu.test(combined)) {
    return { allowed: false, code: 'AI_OUTPUT_EXTERNAL_REFERENCE_UNSAFE' }
  }
  if (/(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\)|(?:^|[\s("'`])\.\.[\\/]/u.test(combined)) {
    return { allowed: false, code: 'AI_OUTPUT_PATH_UNSAFE' }
  }
  const pii = minimizePolicyAiSources([{ sourceAnchorId: 'provider-output', text: combined }])
  if (pii.redactedValueCount > 0) return { allowed: false, code: 'AI_OUTPUT_PII_UNSAFE' }
  return { allowed: true, suggestion }
}

export function composeEmailAiSubject(
  officeNumber: string,
  plate: string,
  subjectSuffix: string,
): string {
  return `${officeNumber} · ${plate} · ${subjectSuffix.trim()}`
}
