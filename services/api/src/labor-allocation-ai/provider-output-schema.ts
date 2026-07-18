/**
 * Gemini GenerateContent için kanıtlanmış minimal wire alt kümesi (Paket 55).
 *
 * Enum, sayısal sınır ve dizi uzunluğu provider şemasına BIRAKILMAZ: dönen veri
 * domain katmanındaki strict doğrulamadan (satır kapsaması, tahsis toplamı
 * eşitliği, ekonomik tutarlılık) ve PII/URL/path kontrollerinden geçer. Prompt
 * ve wire şeması bu kontrollerin yerine geçmez.
 */
export const LABOR_ALLOCATION_PROVIDER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'operationTypesVersion', 'lines', 'requiresHumanReview'],
  properties: {
    schemaVersion: { type: 'string' },
    operationTypesVersion: { type: 'string' },
    requiresHumanReview: { type: 'boolean' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'lineOrdinal',
          'allocations',
          'repairReplaceOpinion',
          'economicComparison',
          'reasoning',
          'evidenceRefs',
          'confidence',
          'conflictCodes',
          'missingEvidenceCodes',
          'controlRequired',
        ],
        properties: {
          lineOrdinal: { type: 'number' },
          allocations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['operationType', 'amountMinor'],
              properties: {
                operationType: { type: 'string' },
                amountMinor: { type: 'number' },
              },
            },
          },
          repairReplaceOpinion: { type: 'string' },
          economicComparison: {
            type: 'object',
            required: ['buckets', 'repairTotalMinor', 'replaceTotalMinor', 'note'],
            properties: {
              buckets: {
                type: 'object',
                required: [
                  'repair_labor',
                  'new_part_or_ownership',
                  'remove_install',
                  'paint_and_consumable',
                  'calibration',
                  'related_operations',
                ],
                properties: {
                  repair_labor: { type: 'number' },
                  new_part_or_ownership: { type: 'number' },
                  remove_install: { type: 'number' },
                  paint_and_consumable: { type: 'number' },
                  calibration: { type: 'number' },
                  related_operations: { type: 'number' },
                },
              },
              repairTotalMinor: { type: 'number' },
              replaceTotalMinor: { type: 'number' },
              note: { type: 'string' },
            },
          },
          reasoning: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          conflictCodes: { type: 'array', items: { type: 'string' } },
          missingEvidenceCodes: { type: 'array', items: { type: 'string' } },
          controlRequired: { type: 'boolean' },
        },
      },
    },
  },
} as const
