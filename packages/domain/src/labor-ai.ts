import { sha256Text } from './pdf-text-extraction.js'
import {
  minimizePolicyAiSources,
  type PolicyAiPiiCategory,
} from './policy-ai-privacy.js'
import { detectPolicyAiPromptInjection } from './policy-ai.js'
import type { CaseType } from './case-type.js'
import {
  MAX_LABOR_SHEET_ITEMS,
  MAX_LABOR_SHEET_TOTAL_MINOR,
  isValidLaborAmountMinor,
  normalizeLaborText,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  type NormalizedLaborItem,
} from './labor-sheet.js'

/**
 * Paket 44 — kanıtlı AI işçilik önerisi domain sınırı.
 *
 * Öneri girdisi kullanıcının bounded hasar tarifi ve mevcut föy kalemleridir;
 * plaka, ofis numarası veya başka vaka kimliği dış sağlayıcıya çıkmaz. Çıktı
 * yalnız insan incelemeli taslak satır önerisidir; föye otomatik yazılamaz.
 */
export const LABOR_AI_PROMPT_TEMPLATE_VERSION = 'labor-ai-draft/1.0.0' as const
export const LABOR_AI_OUTPUT_SCHEMA_VERSION = 'labor-ai-suggestion/1.0.0' as const
export const LABOR_AI_PRIVACY_POLICY_VERSION = 'labor-ai-pii-redaction/1.0.0' as const
export const LABOR_AI_LOCAL_PRIVACY_POLICY_VERSION = 'labor-ai-pii/local-only' as const
export const LABOR_AI_PROVIDER_IDS = [
  'deterministic-success',
  'deterministic-invalid-schema',
  'deterministic-timeout',
  'deterministic-failure',
  'gemini-generate-content',
] as const
export const LABOR_AI_RUN_STATUSES = [
  'provider_disabled',
  'budget_blocked',
  'running',
  'review_required',
  'failed',
  'outcome_unknown',
] as const
export const MAX_LABOR_AI_DAMAGE_DESCRIPTION_LENGTH = 2_000
export const MAX_LABOR_AI_SUGGESTED_ITEMS = 50
export const LABOR_AI_MAX_REASONING_LENGTH = 500
export const LABOR_AI_MAX_WARNINGS = 10

export type LaborAiProviderId = (typeof LABOR_AI_PROVIDER_IDS)[number]
export type LaborAiRunStatus = (typeof LABOR_AI_RUN_STATUSES)[number]

export interface LaborAiPlanContext {
  readonly organizationId: string
  readonly caseId: string
  readonly caseVersion: number
  readonly caseType: CaseType
  readonly baseSheetVersion: number | null
  readonly damageDescription: string
  readonly currentItems: readonly NormalizedLaborItem[]
  readonly providerId: LaborAiProviderId
  readonly providerVersion: string
  readonly modelId: string
  readonly externalProvider: boolean
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
}

export interface LaborAiOutboundItem {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
}

export interface LaborAiOutboundContext {
  readonly context: {
    readonly caseType: CaseType
    readonly damageDescription: string
    readonly currentItems: readonly LaborAiOutboundItem[]
  }
  readonly privacyPolicyVersion:
    | typeof LABOR_AI_PRIVACY_POLICY_VERSION
    | typeof LABOR_AI_LOCAL_PRIVACY_POLICY_VERSION
  readonly outboundPayloadHash: string | null
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly PolicyAiPiiCategory[]
  readonly warnings: readonly string[]
}

export interface LaborAiSuggestedItem {
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
}

export interface LaborAiSuggestionInput {
  readonly schemaVersion: typeof LABOR_AI_OUTPUT_SCHEMA_VERSION
  readonly items: readonly LaborAiSuggestedItem[]
  readonly reasoning: string
  readonly warnings: readonly string[]
  readonly confidence: number
  readonly requiresHumanReview: true
}

export type LaborAiSuggestionValidation =
  | { readonly allowed: true; readonly suggestion: LaborAiSuggestionInput }
  | {
      readonly allowed: false
      readonly code:
        | 'AI_OUTPUT_SCHEMA_INVALID'
        | 'AI_OUTPUT_ITEMS_INVALID'
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

export function buildLaborAiOutboundContext(input: LaborAiPlanContext): LaborAiOutboundContext {
  const rawSources = [
    { sourceAnchorId: 'damage-description', text: input.damageDescription },
    ...input.currentItems.flatMap((item, index) => [
      { sourceAnchorId: `item-${index + 1}-description`, text: item.description },
      { sourceAnchorId: `item-${index + 1}-action`, text: item.action },
    ]),
  ]
  const injectionWarnings = rawSources.flatMap((source) => (
    detectPolicyAiPromptInjection(source.text).map((warning) => `${source.sourceAnchorId}:${warning}`)
  ))
  if (!input.externalProvider) {
    const context = {
      caseType: input.caseType,
      damageDescription: input.damageDescription,
      currentItems: input.currentItems.map((item) => ({ ...item })),
    }
    return {
      context,
      privacyPolicyVersion: LABOR_AI_LOCAL_PRIVACY_POLICY_VERSION,
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
    damageDescription: minimizedMap.get('damage-description') ?? '',
    currentItems: input.currentItems.map((item, index) => ({
      description: minimizedMap.get(`item-${index + 1}-description`) ?? '',
      action: minimizedMap.get(`item-${index + 1}-action`) ?? '',
      partAmountMinor: item.partAmountMinor,
      laborAmountMinor: item.laborAmountMinor,
    })),
  }
  return {
    context,
    privacyPolicyVersion: LABOR_AI_PRIVACY_POLICY_VERSION,
    outboundPayloadHash: sha256Text(`labor-ai-outbound/1|${canonical(context)}`),
    outboundInputCharacters: canonical(context).length,
    redactedValueCount: minimized.redactedValueCount,
    redactedCategories: minimized.redactedCategories,
    warnings: injectionWarnings,
  }
}

export function buildLaborAiPlanHash(input: LaborAiPlanContext, outbound: LaborAiOutboundContext): string {
  return sha256Text(canonical({
    schemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
    promptTemplateVersion: LABOR_AI_PROMPT_TEMPLATE_VERSION,
    organizationId: input.organizationId,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    baseSheetVersion: input.baseSheetVersion,
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

function isValidSuggestedItemShape(value: unknown): value is LaborAiSuggestedItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => ![
    'description',
    'action',
    'partAmountMinor',
    'laborAmountMinor',
  ].includes(key))) return false
  return typeof item.description === 'string'
    && typeof item.action === 'string'
    && typeof item.partAmountMinor === 'number'
    && typeof item.laborAmountMinor === 'number'
}

function isValidSuggestionShape(value: unknown): value is LaborAiSuggestionInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => ![
    'schemaVersion',
    'items',
    'reasoning',
    'warnings',
    'confidence',
    'requiresHumanReview',
  ].includes(key))) return false
  return item.schemaVersion === LABOR_AI_OUTPUT_SCHEMA_VERSION
    && Array.isArray(item.items)
    && item.items.length >= 1
    && item.items.length <= MAX_LABOR_AI_SUGGESTED_ITEMS
    && item.items.every(isValidSuggestedItemShape)
    && typeof item.reasoning === 'string'
    && item.reasoning.trim().length >= 1
    && item.reasoning.trim().length <= LABOR_AI_MAX_REASONING_LENGTH
    && Array.isArray(item.warnings)
    && item.warnings.length <= LABOR_AI_MAX_WARNINGS
    && item.warnings.every((warning) => typeof warning === 'string' && warning.trim().length >= 1 && warning.trim().length <= 200)
    && typeof item.confidence === 'number'
    && Number.isFinite(item.confidence)
    && item.confidence >= 0
    && item.confidence <= 1
    && item.requiresHumanReview === true
}

/**
 * Provider çıktısını strict doğrular: bilinmeyen alan, kalem/tutar sınırı
 * ihlali, PII placeholder, URL, dosya yolu veya PII içeren metin taslak
 * önerisi sayılmaz. Kalem metinleri Paket 43 normalize kurallarından geçer.
 */
export function validateLaborAiSuggestion(value: unknown): LaborAiSuggestionValidation {
  if (!isValidSuggestionShape(value)) return { allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' }
  const normalizedItems: LaborAiSuggestedItem[] = []
  let totalMinor = 0
  for (const item of value.items) {
    const description = normalizeLaborText(item.description, MAX_LABOR_ITEM_DESCRIPTION_LENGTH)
    const action = normalizeLaborText(item.action, MAX_LABOR_ITEM_ACTION_LENGTH)
    if (description === null || action === null) {
      return { allowed: false, code: 'AI_OUTPUT_ITEMS_INVALID' }
    }
    if (!isValidLaborAmountMinor(item.partAmountMinor) || !isValidLaborAmountMinor(item.laborAmountMinor)) {
      return { allowed: false, code: 'AI_OUTPUT_ITEMS_INVALID' }
    }
    if (item.partAmountMinor + item.laborAmountMinor === 0) {
      return { allowed: false, code: 'AI_OUTPUT_ITEMS_INVALID' }
    }
    totalMinor += item.partAmountMinor + item.laborAmountMinor
    normalizedItems.push({
      description,
      action,
      partAmountMinor: item.partAmountMinor,
      laborAmountMinor: item.laborAmountMinor,
    })
  }
  if (normalizedItems.length > MAX_LABOR_SHEET_ITEMS || totalMinor > MAX_LABOR_SHEET_TOTAL_MINOR) {
    return { allowed: false, code: 'AI_OUTPUT_ITEMS_INVALID' }
  }
  const suggestion: LaborAiSuggestionInput = {
    schemaVersion: value.schemaVersion,
    items: normalizedItems,
    reasoning: value.reasoning.trim(),
    warnings: value.warnings.map((warning) => warning.trim()),
    confidence: value.confidence,
    requiresHumanReview: true,
  }
  const combined = [
    ...suggestion.items.flatMap((item) => [item.description, item.action]),
    suggestion.reasoning,
    ...suggestion.warnings,
  ].join('\n')
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
