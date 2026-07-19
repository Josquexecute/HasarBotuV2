import {
  LABOR_ALLOCATION_CONFLICT_CODES,
  LABOR_ALLOCATION_MISSING_EVIDENCE_CODES,
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  LABOR_REPAIR_REPLACE_OPINIONS,
} from '@hasarbotu/domain'

/**
 * Gemini GenerateContent wire şeması (Paket 55, Paket 59'da sıkılaştırıldı).
 *
 * Paket 55 şemayı bilinçli olarak gevşek bırakmıştı (enum yok, sayısal sınır
 * yok). Gerçek modelle ilk koşu bunun ölümcül boşluğunu gösterdi: literal
 * sürüm dizgileri, kanaat sözlüğü ve çelişki/eksik kanıt kodlarının kapalı
 * kümeleri modele HİÇBİR kanaldan verilmiyordu — model bilemeyeceği değeri
 * uydurdu ve domain doğrulaması (doğru şekilde) reddetti.
 *
 * Düzeltme domain'i gevşetmek DEĞİL, sözleşmeyi modele bildirmektir: kapalı
 * kümeler tek değerli/çok değerli enum olarak, parasal alanlar integer olarak
 * şemada taşınır. Dönen veri YİNE domain katmanındaki strict doğrulamadan
 * (satır kapsaması, tahsis toplamı eşitliği, ekonomik tutarlılık, kod
 * sözlükleri) ve PII/URL/path kontrollerinden geçer; şema bu kontrollerin
 * yerine geçmez, yalnız uyum oranını yükseltir.
 *
 * Yalnız Gemini'nin `responseJsonSchema` alt kümesinde KANITLI anahtarlar
 * kullanılır: type, enum, properties, required, items, minimum, maximum,
 * minItems. (maxLength/additionalProperties gibi riskli anahtarlar bilinçli
 * olarak dışarıda bırakılmıştır.)
 */
const MINOR_AMOUNT = { type: 'integer', minimum: 0 } as const

export const LABOR_ALLOCATION_PROVIDER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'operationTypesVersion', 'lines', 'requiresHumanReview'],
  properties: {
    schemaVersion: { type: 'string', enum: [LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION] },
    operationTypesVersion: { type: 'string', enum: [LABOR_OPERATION_TYPES_VERSION] },
    requiresHumanReview: { type: 'boolean' },
    lines: {
      type: 'array',
      minItems: 1,
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
          lineOrdinal: { type: 'integer', minimum: 1 },
          allocations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['operationType', 'amountMinor'],
              properties: {
                operationType: { type: 'string', enum: [...LABOR_OPERATION_TYPES] },
                amountMinor: MINOR_AMOUNT,
              },
            },
          },
          repairReplaceOpinion: { type: 'string', enum: [...LABOR_REPAIR_REPLACE_OPINIONS] },
          /*
           * Onarım/değişim toplamları wire sözleşmesinde YOKTUR (Paket 59).
           * Domain kuralı toplamları kovalardan deterministik türetir ve
           * sağlayıcının kendi aritmetiğini kabul etmez; ilk gerçek koşuda
           * model önermediği senaryonun toplamına formül yerine 0 yazdı.
           * Türetilebilir sayıyı modelden istemek yalnız hata modu ekler:
           * adaptör toplamları modelin KENDİ kovalarından hesaplar.
           */
          economicComparison: {
            type: 'object',
            required: ['buckets', 'note'],
            properties: {
              buckets: {
                type: 'object',
                required: [...LABOR_ECONOMIC_BUCKETS],
                properties: Object.fromEntries(
                  LABOR_ECONOMIC_BUCKETS.map((bucket) => [bucket, MINOR_AMOUNT]),
                ),
              },
              note: { type: 'string' },
            },
          },
          reasoning: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          conflictCodes: {
            type: 'array',
            items: { type: 'string', enum: [...LABOR_ALLOCATION_CONFLICT_CODES] },
          },
          missingEvidenceCodes: {
            type: 'array',
            items: { type: 'string', enum: [...LABOR_ALLOCATION_MISSING_EVIDENCE_CODES] },
          },
          controlRequired: { type: 'boolean' },
        },
      },
    },
  },
} as const
