import { z } from 'zod'
import {
  LABOR_ALLOCATION_APPLICATION_STATUSES,
  LABOR_ALLOCATION_APPLY_SCHEMA_VERSION,
  LABOR_ALLOCATION_CATEGORIES,
  LABOR_ALLOCATION_CONFLICT_CODES,
  LABOR_CATEGORY_ALLOCATION_SCHEMA_VERSION,
  LABOR_CATEGORY_CONFLICT_CODES,
  LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION,
  LABOR_BASELINE_COMPARISON_VERSION,
  LABOR_BASELINE_MATCH_VERSION,
  LABOR_ALLOCATION_MAX_ALLOCATIONS_PER_LINE,
  LABOR_ALLOCATION_MAX_EVIDENCE_REFS,
  LABOR_ALLOCATION_MAX_REASONING_LENGTH,
  LABOR_ALLOCATION_MISSING_EVIDENCE_CODES,
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ALLOCATION_PRIVACY_POLICY_VERSION,
  LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
  LABOR_ALLOCATION_RULE_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  LABOR_REPAIR_REPLACE_OPINIONS,
  MAX_LABOR_ALLOCATION_DAMAGE_DESCRIPTION_LENGTH,
  MAX_LABOR_AMOUNT_MINOR,
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  MAX_LABOR_SHEET_ITEMS,
  POLICY_AI_PII_CATEGORIES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { laborSheetSchema } from '../labor/dto.js'

/**
 * Paket 54 dilim 2 — AI işçilik dağıtımı sözleşmesi.
 *
 * Taksonomi, prompt ve öneri şema sürümleri her yanıtta ZORUNLU alandır:
 * saklanmış bir öneri hangi sürümle üretildiği bilinmeden yorumlanamaz.
 */
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const providerTextSchema = z.string().min(1).max(80)
const amountMinorSchema = z.number().int().min(0).max(MAX_LABOR_AMOUNT_MINOR)
const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const lineOrdinalSchema = z.number().int().min(1).max(MAX_LABOR_SHEET_ITEMS)

/**
 * Paket 62: `queued`, `cancel_requested` ve `cancelled` eklendi.
 *
 * `cancel_requested` bilinçli olarak ayrı bir durumdur: iptal isteği alınmış
 * ama çağrının gerçekten durduğu HENÜZ doğrulanmamıştır. Sonuç belirsizken
 * kullanıcıya "iptal edildi" denmez.
 */
export const LABOR_ALLOCATION_RUN_STATUSES = [
  'provider_disabled',
  'budget_blocked',
  'queued',
  'running',
  'review_required',
  'failed',
  'outcome_unknown',
  'cancel_requested',
  'cancelled',
] as const

/** Kullanıcı için hâlâ devam eden durumlar. */
export const LABOR_ALLOCATION_ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'cancel_requested',
] as const

export const laborAllocationCaseParamsSchema = z.strictObject({ caseId: caseIdSchema })
export const laborAllocationRunParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  runId: idSchema,
})

export const laborAllocationAnalyzeRequestSchema = z.strictObject({
  /** Kaynak föy sürümü; uyuşmazsa analiz stale sayılır. */
  expectedSheetVersion: entityVersionSchema,
  damageDescription: z.string().min(1).max(MAX_LABOR_ALLOCATION_DAMAGE_DESCRIPTION_LENGTH),
  /** Dış sağlayıcıya veri çıkışı için açık kullanıcı onayı. */
  confirmedEgress: z.boolean(),
})

export const laborAllocationAmountSchema = z.strictObject({
  operationType: z.enum(LABOR_OPERATION_TYPES),
  amountMinor: amountMinorSchema,
})

export const laborAllocationEconomicSchema = z.strictObject({
  buckets: z.strictObject(
    Object.fromEntries(LABOR_ECONOMIC_BUCKETS.map((bucket) => [bucket, amountMinorSchema])) as {
      [K in (typeof LABOR_ECONOMIC_BUCKETS)[number]]: typeof amountMinorSchema
    },
  ),
  repairTotalMinor: amountMinorSchema,
  replaceTotalMinor: amountMinorSchema,
  note: z.string().min(1).max(LABOR_ALLOCATION_MAX_REASONING_LENGTH),
})

/**
 * Paket 57 — eşleşen eksper baseline ile ekonomik şekil karşılaştırması.
 * Sağlayıcı üretmez; sunucu hesaplar ve öneriyle birlikte immutable saklar.
 */
export const laborAllocationBaselineSchema = z.strictObject({
  comparisonVersion: z.literal(LABOR_BASELINE_COMPARISON_VERSION),
  baselineSheetVersion: entityVersionSchema,
  baselinePartAmountMinor: amountMinorSchema,
  baselineLaborAmountMinor: amountMinorSchema,
  baselinePartRatio: z.number().min(0).max(1),
  suggestedPartRatio: z.number().min(0).max(1),
  deltaRatio: z.number().min(0).max(1),
  conflicts: z.boolean(),
})

/**
 * Paket 64 — kategori dağılımı sekiz anahtarın TAMAMINI taşır.
 *
 * Eksik anahtarı sıfır varsaymak, modelin o branşı hiç değerlendirmediği ile
 * sıfır ayırdığını aynı şeye çevirirdi. Toplam işçilik tutarına eşitliği
 * domain ve veritabanı CHECK'i ayrıca doğrular.
 */
export const laborCategoryAllocationSchema = z.strictObject({
  schemaVersion: z.literal(LABOR_CATEGORY_ALLOCATION_SCHEMA_VERSION),
  amounts: z.array(z.strictObject({
    category: z.enum(LABOR_ALLOCATION_CATEGORIES),
    amountMinor: amountMinorSchema,
  })).length(LABOR_ALLOCATION_CATEGORIES.length),
  confidence: z.number().min(0).max(1),
  conflictCodes: z.array(z.enum(LABOR_CATEGORY_CONFLICT_CODES))
    .max(LABOR_CATEGORY_CONFLICT_CODES.length),
  /**
   * Çelişki kodunun dayandığı kıyas vektörleri. `null` referansın YOK
   * olduğunu söyler; sıfır dağılım anlamına gelmez ve UI bunu boş çizmez.
   * Sonradan yeniden hesaplanmaz: geçmiş havuzu ve baseline zamanla değişir,
   * ekrandaki kıyas ile kodun dayanağı ayrışırdı.
   */
  baselineAmounts: z.array(z.strictObject({
    category: z.enum(LABOR_ALLOCATION_CATEGORIES),
    amountMinor: amountMinorSchema,
  })).length(LABOR_ALLOCATION_CATEGORIES.length).nullable(),
  historyAmounts: z.array(z.strictObject({
    category: z.enum(LABOR_ALLOCATION_CATEGORIES),
    amountMinor: amountMinorSchema,
  })).length(LABOR_ALLOCATION_CATEGORIES.length).nullable(),
})

export const laborAllocationLineSchema = z.strictObject({
  lineOrdinal: lineOrdinalSchema,
  /** Kaynak föy satırının okunabilir özeti; öneri satırıyla eşleştirme içindir. */
  sourceDescription: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  sourceAction: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  sourcePartAmountMinor: amountMinorSchema,
  sourceLaborAmountMinor: amountMinorSchema,
  allocations: z.array(laborAllocationAmountSchema).min(1).max(LABOR_ALLOCATION_MAX_ALLOCATIONS_PER_LINE),
  repairReplaceOpinion: z.enum(LABOR_REPAIR_REPLACE_OPINIONS),
  economicComparison: laborAllocationEconomicSchema,
  reasoning: z.string().min(1).max(LABOR_ALLOCATION_MAX_REASONING_LENGTH),
  evidenceRefs: z.array(z.string().min(1).max(120)).max(LABOR_ALLOCATION_MAX_EVIDENCE_REFS),
  confidence: z.number().min(0).max(1),
  conflictCodes: z.array(z.enum(LABOR_ALLOCATION_CONFLICT_CODES)).max(LABOR_ALLOCATION_CONFLICT_CODES.length),
  missingEvidenceCodes: z.array(z.enum(LABOR_ALLOCATION_MISSING_EVIDENCE_CODES))
    .max(LABOR_ALLOCATION_MISSING_EVIDENCE_CODES.length),
  controlRequired: z.boolean(),
  /** Baseline yoksa veya satır belirsiz eşleştiyse null kalır. */
  baseline: laborAllocationBaselineSchema.nullable(),
  /**
   * Paket 64 — işçilik DAĞITIM KATEGORİSİ ekseni (branş).
   *
   * Operasyon türünden ve ekonomik karşılaştırmadan AYRI eksendir. Eski
   * çalıştırmalarda gerçek kategori provenance'ı yoktur ve null kalır;
   * bu satırlar için kategori girişi manuel yapılır.
   */
  categoryAllocation: laborCategoryAllocationSchema.nullable(),
})

export const laborAllocationSuggestionSchema = z.strictObject({
  schemaVersion: z.literal(LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION),
  operationTypesVersion: z.literal(LABOR_OPERATION_TYPES_VERSION),
  ruleVersion: z.literal(LABOR_ALLOCATION_RULE_VERSION),
  lines: z.array(laborAllocationLineSchema).min(1).max(MAX_LABOR_SHEET_ITEMS),
  requiresHumanReview: z.literal(true),
})

export const laborAllocationPrivacySchema = z.strictObject({
  externalProvider: z.boolean(),
  policyVersion: z.enum([
    LABOR_ALLOCATION_PRIVACY_POLICY_VERSION,
    LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION,
  ]),
  outboundPayloadHash: hashSchema.nullable(),
  outboundInputCharacters: z.number().int().min(1).max(400_000),
  redactedValueCount: z.number().int().min(0).max(10_000),
  redactedCategories: z.array(z.enum(POLICY_AI_PII_CATEGORIES)).max(POLICY_AI_PII_CATEGORIES.length),
  retentionMode: z.enum(['local_only', 'store_false', 'free_tier_product_improvement']),
  warnings: z.array(z.string().min(1).max(200)).max(40),
})

export const laborAllocationBudgetSchema = z.strictObject({
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

export const laborAllocationRunSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  status: z.enum(LABOR_ALLOCATION_RUN_STATUSES),
  providerId: providerTextSchema,
  providerVersion: providerTextSchema,
  modelId: providerTextSchema,
  promptTemplateVersion: z.literal(LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION),
  operationTypesVersion: z.literal(LABOR_OPERATION_TYPES_VERSION),
  ruleVersion: z.literal(LABOR_ALLOCATION_RULE_VERSION),
  sourceSheetId: idSchema,
  sourceSheetVersion: entityVersionSchema,
  /**
   * Paket 57: kanıt olarak kullanılan önceki onaylı föy sürümü. Baseline
   * bulunamadıysa null; bu durumda hiçbir satırda karşılaştırma olmaz.
   */
  baselineSheetVersion: entityVersionSchema.nullable(),
  baselineMatchVersion: z.literal(LABOR_BASELINE_MATCH_VERSION).nullable(),
  baselineMatchedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  /**
   * Paket 62 — GERÇEK ilerleme. Sahte yüzde veya uydurma kalan süre yoktur;
   * tamamlanan chunk sayısı mevcut sağlayıcı makbuzlarından türetilir.
   */
  progress: z.strictObject({
    totalLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
    processedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
    totalChunkCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
    completedChunkCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
    startedAt: utcDateTimeSchema.nullable(),
    updatedAt: utcDateTimeSchema.nullable(),
    cancelRequestedAt: utcDateTimeSchema.nullable(),
  }),
  evidenceHash: hashSchema,
  planHash: hashSchema,
  version: entityVersionSchema,
  privacy: laborAllocationPrivacySchema,
  budget: laborAllocationBudgetSchema,
  suggestion: laborAllocationSuggestionSchema.nullable(),
  safeErrorCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).nullable(),
  /** Kaynak föy öneriden sonra değiştiyse öneri uygulanamaz. */
  stale: z.boolean(),
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
})

export const laborAllocationRunResponseSchema = z.strictObject({ run: laborAllocationRunSchema })

export const laborAllocationWorkspaceResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  caseClosed: z.boolean(),
  sourceSheetId: idSchema.nullable(),
  sourceSheetVersion: entityVersionSchema.nullable(),
  sourceLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  promptTemplateVersion: z.literal(LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION),
  outputSchemaVersion: z.literal(LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION),
  operationTypesVersion: z.literal(LABOR_OPERATION_TYPES_VERSION),
  ruleVersion: z.literal(LABOR_ALLOCATION_RULE_VERSION),
  operationTypes: z.array(z.enum(LABOR_OPERATION_TYPES)).length(LABOR_OPERATION_TYPES.length),
  economicBuckets: z.array(z.enum(LABOR_ECONOMIC_BUCKETS)).length(LABOR_ECONOMIC_BUCKETS.length),
  budget: laborAllocationBudgetSchema,
  runs: z.array(laborAllocationRunSchema).max(200),
  permissions: z.strictObject({
    canAnalyze: z.boolean(),
    requiresExplicitEgressConfirmation: z.boolean(),
  }),
})

/**
 * Seçilmiş satırlardan üretilen ÖNİZLEME. Bu dilimde föy revize EDİLMEZ;
 * yanıt yalnız kullanıcının açık onayına gidecek taslağı taşır.
 */
export const laborAllocationApplyPreviewRequestSchema = z.strictObject({
  expectedSheetVersion: entityVersionSchema,
  selectedLineOrdinals: z.array(lineOrdinalSchema).min(1).max(MAX_LABOR_SHEET_ITEMS)
    .refine((value) => new Set(value).size === value.length, { error: 'duplicate_line_ordinal' }),
})

export const laborAllocationApplyPreviewLineSchema = z.strictObject({
  lineOrdinal: lineOrdinalSchema,
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  partAmountMinor: amountMinorSchema,
  laborAmountMinor: amountMinorSchema,
  allocations: z.array(laborAllocationAmountSchema).min(1).max(LABOR_ALLOCATION_MAX_ALLOCATIONS_PER_LINE),
  controlRequired: z.boolean(),
})

/**
 * Paket 58 — seçilen satırların föye UYGULANMASI.
 *
 * Önizlemeden farkı: bu istek gerçekten yeni bir immutable föy sürümü üretir.
 * Kullanıcı satır değerlerini düzenleyebilir; provenance hem öneriyi hem
 * uygulanan değeri saklar.
 */
export const laborAllocationApplyLineSchema = z.strictObject({
  lineOrdinal: lineOrdinalSchema,
  description: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  action: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  partAmountMinor: amountMinorSchema,
  laborAmountMinor: amountMinorSchema,
  /**
   * Paket 64 — kullanıcının DÜZELTTİĞİ kategori dağılımı.
   *
   * Gönderilmezse sunucu öneriyi olduğu gibi uygular. Gönderilirse sekiz
   * anahtarın tamamı zorunludur ve toplam `laborAmountMinor` ile eşleşmek
   * zorundadır; sunucu kalan farkı hiçbir kategoriye dağıtmaz.
   */
  categoryAmounts: z.array(z.strictObject({
    category: z.enum(LABOR_ALLOCATION_CATEGORIES),
    amountMinor: amountMinorSchema,
  })).length(LABOR_ALLOCATION_CATEGORIES.length).optional(),
})

export const laborAllocationApplyRequestSchema = z.strictObject({
  expectedSheetVersion: entityVersionSchema,
  reason: z.string().min(1).max(500),
  lines: z.array(laborAllocationApplyLineSchema).min(1).max(MAX_LABOR_SHEET_ITEMS)
    .refine(
      (value) => new Set(value.map((line) => line.lineOrdinal)).size === value.length,
      { error: 'duplicate_line_ordinal' },
    ),
  /** Uygulama açık kullanıcı onayı olmadan yapılmaz. */
  confirmed: z.literal(true),
})

export const laborAllocationAppliedLineSchema = z.strictObject({
  lineOrdinal: lineOrdinalSchema,
  suggestionLineOrdinal: lineOrdinalSchema,
  targetLineOrdinal: lineOrdinalSchema,
  suggestedDescription: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  suggestedAction: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  suggestedPartAmountMinor: amountMinorSchema,
  suggestedLaborAmountMinor: amountMinorSchema,
  suggestedOperationTypes: z.array(z.enum(LABOR_OPERATION_TYPES)).min(1),
  appliedDescription: z.string().min(1).max(MAX_LABOR_ITEM_DESCRIPTION_LENGTH),
  appliedAction: z.string().min(1).max(MAX_LABOR_ITEM_ACTION_LENGTH),
  appliedPartAmountMinor: amountMinorSchema,
  appliedLaborAmountMinor: amountMinorSchema,
  modified: z.boolean(),
  controlRequired: z.boolean(),
})

export const laborAllocationApplicationSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  runId: idSchema,
  applySchemaVersion: z.literal(LABOR_ALLOCATION_APPLY_SCHEMA_VERSION),
  status: z.enum(LABOR_ALLOCATION_APPLICATION_STATUSES),
  sourceSheetVersion: entityVersionSchema,
  targetSheetVersion: entityVersionSchema.nullable(),
  selectedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  rejectedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  modifiedLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  controlRequiredLineCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  lines: z.array(laborAllocationAppliedLineSchema).max(MAX_LABOR_SHEET_ITEMS),
  appliedByDisplayName: z.string().min(1).max(200),
  createdAt: utcDateTimeSchema,
  completedAt: utcDateTimeSchema.nullable(),
})

export const laborAllocationApplyResponseSchema = z.strictObject({
  application: laborAllocationApplicationSchema,
  /** Uygulama sonrası föyün yeni hali; istemci bu sürüme geçer. */
  sheet: laborSheetSchema,
})

export const laborAllocationApplicationsResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  applications: z.array(laborAllocationApplicationSchema).max(200),
})

export const laborAllocationApplyPreviewResponseSchema = z.strictObject({
  runId: idSchema,
  caseId: caseIdSchema,
  sourceSheetId: idSchema,
  sourceSheetVersion: entityVersionSchema,
  operationTypesVersion: z.literal(LABOR_OPERATION_TYPES_VERSION),
  outputSchemaVersion: z.literal(LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION),
  lines: z.array(laborAllocationApplyPreviewLineSchema).min(1).max(MAX_LABOR_SHEET_ITEMS),
  selectedCount: z.number().int().min(1).max(MAX_LABOR_SHEET_ITEMS),
  controlRequiredCount: z.number().int().min(0).max(MAX_LABOR_SHEET_ITEMS),
  /** Bu dilimde her zaman false: föy otomatik revize edilmez. */
  applied: z.literal(false),
  requiresHumanReview: z.literal(true),
})

export type LaborAllocationAnalyzeRequest = z.infer<typeof laborAllocationAnalyzeRequestSchema>
export type LaborAllocationAmountDto = z.infer<typeof laborAllocationAmountSchema>
export type LaborAllocationEconomicDto = z.infer<typeof laborAllocationEconomicSchema>
export type LaborAllocationBaselineDto = z.infer<typeof laborAllocationBaselineSchema>
export type LaborAllocationLineDto = z.infer<typeof laborAllocationLineSchema>
export type LaborAllocationSuggestionDto = z.infer<typeof laborAllocationSuggestionSchema>
export type LaborAllocationPrivacyDto = z.infer<typeof laborAllocationPrivacySchema>
export type LaborAllocationBudgetDto = z.infer<typeof laborAllocationBudgetSchema>
export type LaborAllocationRunDto = z.infer<typeof laborAllocationRunSchema>
export type LaborAllocationRunResponse = z.infer<typeof laborAllocationRunResponseSchema>
export type LaborAllocationWorkspaceResponse = z.infer<typeof laborAllocationWorkspaceResponseSchema>
export type LaborAllocationApplyRequest = z.infer<typeof laborAllocationApplyRequestSchema>
export type LaborAllocationApplyResponse = z.infer<typeof laborAllocationApplyResponseSchema>
export type LaborAllocationApplicationDto = z.infer<typeof laborAllocationApplicationSchema>
export type LaborAllocationAppliedLineDto = z.infer<typeof laborAllocationAppliedLineSchema>
export type LaborAllocationApplicationsResponse =
  z.infer<typeof laborAllocationApplicationsResponseSchema>
export type LaborAllocationApplyPreviewRequest = z.infer<typeof laborAllocationApplyPreviewRequestSchema>
export type LaborAllocationApplyPreviewResponse = z.infer<typeof laborAllocationApplyPreviewResponseSchema>
