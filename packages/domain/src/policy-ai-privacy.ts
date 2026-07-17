import { sha256Text } from './pdf-text-extraction.js'

export const POLICY_AI_PII_POLICY_VERSION = 'policy-ai-pii-redaction/1.0.0' as const
export const POLICY_AI_LOCAL_PRIVACY_POLICY_VERSION = 'policy-ai-pii/local-only' as const

export const POLICY_AI_PII_CATEGORIES = [
  'address',
  'email',
  'iban',
  'name',
  'phone',
  'plate',
  'reference_number',
  'tax_identity',
  'turkish_identity',
  'vehicle_identity',
] as const

export type PolicyAiPiiCategory = (typeof POLICY_AI_PII_CATEGORIES)[number]

export interface PolicyAiPrivacySource {
  readonly sourceAnchorId: string
  readonly text: string
}

export interface PolicyAiRedactionSummary {
  readonly policyVersion: typeof POLICY_AI_PII_POLICY_VERSION
  readonly outboundPayloadHash: string
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly PolicyAiPiiCategory[]
  readonly sources: readonly PolicyAiPrivacySource[]
}

interface PatternRule {
  readonly category: PolicyAiPiiCategory
  readonly pattern: RegExp
  readonly valueGroup?: number
}

const RULES: readonly PatternRule[] = [
  { category: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
  { category: 'iban', pattern: /\bTR\d{2}(?:[\s-]?\d){22}\b/giu },
  { category: 'phone', pattern: /(?<!\d)(?:\+?90[\s().-]?)?(?:0?[2-5]\d{2})[\s().-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/gu },
  { category: 'turkish_identity', pattern: /(?<!\d)[1-9]\d{10}(?!\d)/gu },
  { category: 'tax_identity', pattern: /(?<!\d)\d{10}(?!\d)/gu },
  { category: 'vehicle_identity', pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/giu },
  { category: 'plate', pattern: /(?<![A-Z0-9])(?:0[1-9]|[1-7]\d|8[01])[\s-]?[A-ZÇĞİÖŞÜ]{1,3}[\s-]?\d{2,4}(?![A-Z0-9])/giu },
  { category: 'reference_number', pattern: /\b((?:poliçe|police|hasar\s+dosya|ihbar|müşteri|musteri)\s*(?:no|numarası|numarasi)?\s*[:#-]\s*)([A-Z0-9][A-Z0-9./-]{2,79})/giu, valueGroup: 2 },
  { category: 'vehicle_identity', pattern: /\b((?:şasi|sasi|motor)\s*(?:no|numarası|numarasi)?\s*[:#-]\s*)([A-Z0-9][A-Z0-9./-]{4,79})/giu, valueGroup: 2 },
  { category: 'name', pattern: /\b((?:sigortalı|sigortali|sigorta\s+ettiren|ad\s+soyad|adı\s+soyadı|adi\s+soyadi)\s*:\s*)([^\r\n]{2,120})/giu, valueGroup: 2 },
  {
    category: 'name',
    pattern: /\b((?:sigortalı|sigortali|sigorta\s+ettiren|ad\s+soyad|adı\s+soyadı|adi\s+soyadi)(?!\s*:)\s+)([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+){1,3})(?=[,.;\r\n]|$)/giu,
    valueGroup: 2,
  },
  { category: 'address', pattern: /\b((?:adres|ikametgah)\s*:\s*)([^\r\n]{4,240})/giu, valueGroup: 2 },
] as const

function replaceRule(
  text: string,
  rule: PatternRule,
  counters: Map<PolicyAiPiiCategory, number>,
): { readonly text: string; readonly count: number } {
  let count = 0
  const next = text.replace(rule.pattern, (...parts: unknown[]) => {
    const match = String(parts[0])
    const valueGroup = rule.valueGroup
    const current = (counters.get(rule.category) ?? 0) + 1
    counters.set(rule.category, current)
    count += 1
    const placeholder = `[PII:${rule.category.toUpperCase()}_${current}]`
    if (valueGroup === undefined) return placeholder
    const value = String(parts[valueGroup] ?? '')
    const index = match.lastIndexOf(value)
    return index < 0 ? placeholder : `${match.slice(0, index)}${placeholder}${match.slice(index + value.length)}`
  })
  return { text: next, count }
}

export function minimizePolicyAiSources(sources: readonly PolicyAiPrivacySource[]): PolicyAiRedactionSummary {
  const counters = new Map<PolicyAiPiiCategory, number>()
  let redactedValueCount = 0
  const minimized = sources.map((source) => {
    let text = source.text
    for (const rule of RULES) {
      const result = replaceRule(text, rule, counters)
      text = result.text
      redactedValueCount += result.count
    }
    return { sourceAnchorId: source.sourceAnchorId, text }
  })
  const canonical = JSON.stringify(minimized.map((source) => ({
    sourceAnchorId: source.sourceAnchorId,
    text: source.text,
  })))
  return {
    policyVersion: POLICY_AI_PII_POLICY_VERSION,
    outboundPayloadHash: sha256Text(`policy-ai-outbound/1|${canonical}`),
    outboundInputCharacters: minimized.reduce((sum, source) => sum + source.text.length, 0),
    redactedValueCount,
    redactedCategories: [...counters.keys()].sort(),
    sources: minimized,
  }
}
