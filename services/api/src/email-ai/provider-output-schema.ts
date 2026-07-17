/**
 * Gemini GenerateContent için kanıtlanmış minimal wire alt kümesi. Enum ve
 * numeric/array sınırları provider şemasına bırakılmaz; dönen veri domain
 * katmanındaki strict doğrulama ve PII/URL/path kontrollerinden geçer.
 */
export const EMAIL_AI_PROVIDER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  required: [
    'schemaVersion',
    'subjectSuffix',
    'body',
    'reasoning',
    'warnings',
    'confidence',
    'requiresHumanReview',
  ],
  properties: {
    schemaVersion: { type: 'string' },
    subjectSuffix: { type: 'string' },
    body: { type: 'string' },
    reasoning: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    requiresHumanReview: { type: 'boolean' },
  },
} as const
