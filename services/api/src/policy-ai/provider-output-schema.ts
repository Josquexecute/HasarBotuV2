import {
  POLICY_AI_CANDIDATE_CATEGORIES,
  POLICY_AI_OUTPUT_SCHEMA_VERSION,
} from '@hasarbotu/domain'

/**
 * Gemini'ye verilen minimal wire JSON Schema. Değişken kanonik değer doğrudan
 * recursive/anyOf schema olarak modellenmez; bounded JSON metni halinde gelir
 * ve adapter tarafından parse edildikten sonra contracts/Zod + evidence
 * doğrulamasından geçer. Provider şeması son doğrulama otoritesi değildir.
 */
export interface PolicyAiProviderSchemaOptions {
  readonly enums?: boolean
  readonly numericBounds?: boolean
  readonly arrayBounds?: boolean
  readonly descriptions?: boolean
}

export function createPolicyAiProviderOutputJsonSchema(options: PolicyAiProviderSchemaOptions = {}) {
  return {
    type: 'object',
    required: ['schemaVersion', 'candidates'],
    properties: {
      schemaVersion: { type: 'string', ...(options.enums === true ? { enum: [POLICY_AI_OUTPUT_SCHEMA_VERSION] } : {}) },
      candidates: {
        type: 'array',
        ...(options.arrayBounds === true ? { maxItems: 100 } : {}),
        items: {
          type: 'object',
          required: ['candidateId', 'category', 'canonicalField', 'normalizedValueJson', 'originalValue', 'conditions', 'exceptions', 'sourceAnchorIds', 'providerConfidence'],
          properties: {
            candidateId: { type: 'string' },
            category: { type: 'string', ...(options.enums === true ? { enum: [...POLICY_AI_CANDIDATE_CATEGORIES] } : {}) },
            canonicalField: { type: 'string' },
            normalizedValueJson: { type: 'string', ...(options.descriptions === true ? { description: 'Compact valid JSON encoding of the canonical normalized value.' } : {}) },
            originalValue: { type: 'string' },
            conditions: { type: 'array', ...(options.arrayBounds === true ? { maxItems: 20 } : {}), items: { type: 'string' } },
            exceptions: { type: 'array', ...(options.arrayBounds === true ? { maxItems: 20 } : {}), items: { type: 'string' } },
            sourceAnchorIds: { type: 'array', ...(options.arrayBounds === true ? { minItems: 1, maxItems: 20 } : {}), items: { type: 'string' } },
            providerConfidence: { type: 'number', ...(options.numericBounds === true ? { minimum: 0, maximum: 1 } : {}) },
          },
        },
      },
    },
  } as const
}

export const POLICY_AI_PROVIDER_OUTPUT_JSON_SCHEMA = createPolicyAiProviderOutputJsonSchema()
