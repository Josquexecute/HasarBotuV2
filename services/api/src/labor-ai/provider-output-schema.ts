/**
 * Gemini GenerateContent için kanıtlanmış minimal wire alt kümesi. Enum ve
 * numeric/array sınırları provider şemasına bırakılmaz; dönen veri domain
 * katmanındaki strict doğrulama ve PII/URL/path kontrollerinden geçer.
 */
export const LABOR_AI_PROVIDER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  required: [
    'schemaVersion',
    'items',
    'reasoning',
    'warnings',
    'confidence',
    'requiresHumanReview',
  ],
  properties: {
    schemaVersion: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'action', 'partAmountMinor', 'laborAmountMinor'],
        properties: {
          description: { type: 'string' },
          action: { type: 'string' },
          partAmountMinor: { type: 'number' },
          laborAmountMinor: { type: 'number' },
        },
      },
    },
    reasoning: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    requiresHumanReview: { type: 'boolean' },
  },
} as const
