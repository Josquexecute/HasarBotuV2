import {
  policyAiProviderOutputSchema,
  type PolicyAiProviderOutput,
} from '@hasarbotu/contracts'

const SAFE_PATH_PARTS = new Set([
  'schemaVersion',
  'candidates',
  'candidateId',
  'category',
  'canonicalField',
  'normalizedValue',
  'originalValue',
  'conditions',
  'exceptions',
  'sourceAnchorIds',
  'providerConfidence',
])

function safeToken(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.length > 0 ? normalized.slice(0, 48) : 'UNKNOWN'
}

function safePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'ROOT'
  return path.slice(0, 4).map((part) => {
    if (typeof part === 'number') return 'ITEM'
    if (typeof part === 'string' && SAFE_PATH_PARTS.has(part)) return safeToken(part)
    return 'UNKNOWN'
  }).join('_')
}

export type Package29PilotOutputParseResult =
  | { readonly success: true; readonly data: PolicyAiProviderOutput }
  | { readonly success: false; readonly safeErrorCode: string }

/**
 * Ham provider değerini veya Zod mesajını dışarı taşımadan canonical sözleşme
 * uyuşmazlığının yalnız sabit alan yolunu ve issue sınıfını gösterir.
 */
export function parsePackage29PilotOutput(value: unknown): Package29PilotOutputParseResult {
  const parsed = policyAiProviderOutputSchema.safeParse(value)
  if (parsed.success) return { success: true, data: parsed.data }
  const issueCodes = parsed.error.issues.slice(0, 3).map((issue) =>
    `${safePath(issue.path)}_${safeToken(issue.code)}`)
  const suffix = issueCodes.length > 0 ? issueCodes.join('__') : 'UNKNOWN'
  return {
    success: false,
    safeErrorCode: `PILOT_STRUCTURED_OUTPUT_INVALID_${suffix}`.slice(0, 256),
  }
}
