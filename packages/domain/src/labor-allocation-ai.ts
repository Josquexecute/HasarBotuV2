import { sha256Text } from './pdf-text-extraction.js'
import { minimizePolicyAiSources, type PolicyAiPiiCategory } from './policy-ai-privacy.js'
import { detectPolicyAiPromptInjection } from './policy-ai.js'
import type { CaseType } from './case-type.js'
import type { OutboundVehicleProfile } from './case-vehicle-profile.js'
import {
  MAX_LABOR_SHEET_ITEMS,
  MAX_LABOR_SHEET_TOTAL_MINOR,
  isValidLaborAmountMinor,
  normalizeLaborText,
  type NormalizedLaborItem,
} from './labor-sheet.js'
import {
  compareBaselineAllocation,
  hasCompleteBaselineMatch,
  matchBaselineLines,
  type LaborBaselineComparison,
  type LaborBaselineLineMatch,
} from './labor-baseline.js'

/**
 * Paket 54 — kanıtlı AI işçilik DAĞITIM çekirdeği (HB-2026-060).
 *
 * Basit kelime eşleştirme veya kural tabanlı dağıtıcı YOKTUR. Bu modül yalnız
 * sınırı tanımlar: dışarı çıkan kanıt kümesini kurar, plan hash'ini üretir ve
 * sağlayıcı çıktısını strict doğrular. Öneri hiçbir zaman föye otomatik
 * yazılmaz; kullanıcı satır bazında kabul/reddetmeden kesinleşmez.
 *
 * Taksonomi iki AYRI yapıdır (kullanıcı kararı, HB-2026-060):
 *  1. Kanonik operasyon türleri — satır tutarının dağıtıldığı birimler.
 *  2. Ekonomik karşılaştırma kovaları — yalnız onarım/değişim karşılaştırması
 *     içindir ve işçilik kategorisi SAYILMAZ.
 * Hiçbir sigorta şirketi veya Excel sütun adı bu modüle bağlanmaz; şablon
 * profilleri ileride bu kanonik türleri gerçek sütunlara eşler.
 */
export const LABOR_OPERATION_TYPES_VERSION = 'labor-operation-types/1.0.0' as const
export const LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION = 'labor-allocation-ai/1.0.0' as const
export const LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION = 'labor-allocation-suggestion/1.0.0' as const
export const LABOR_ALLOCATION_RULE_VERSION = 'labor-allocation-rules/1.0.0' as const
export const LABOR_ALLOCATION_PRIVACY_POLICY_VERSION = 'labor-allocation-pii-redaction/1.0.0' as const
export const LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION = 'labor-allocation-pii/local-only' as const

/** Kanonik operasyon türleri. `other` kullanımı her zaman insan kontrolü gerektirir. */
export const LABOR_OPERATION_TYPES = [
  'repair',
  'replace',
  'remove_install',
  'paint',
  'consumable',
  'calibration',
  'related_operation',
  'other',
] as const
export type LaborOperationType = (typeof LABOR_OPERATION_TYPES)[number]

/**
 * Ekonomik karşılaştırma kovaları. Onarım–değişim karşılaştırması tek başına
 * parça bedeline bakmaz; bu kovaların toplamları karşılaştırılır.
 */
export const LABOR_ECONOMIC_BUCKETS = [
  'repair_labor',
  'new_part_or_ownership',
  'remove_install',
  'paint_and_consumable',
  'calibration',
  'related_operations',
] as const
export type LaborEconomicBucket = (typeof LABOR_ECONOMIC_BUCKETS)[number]

/**
 * Ekonomik kovalar işçilik KATEGORİSİ değildir (kullanıcı kararı): satır
 * tutarının dağıtıldığı birim kanonik operasyon türleridir, bu kovalar yalnız
 * onarım–değişim karşılaştırmasını açıklar.
 */

export const LABOR_REPAIR_REPLACE_OPINIONS = [
  'repair_indicated',
  'replace_indicated',
  'comparable',
  'insufficient_evidence',
] as const
export type LaborRepairReplaceOpinion = (typeof LABOR_REPAIR_REPLACE_OPINIONS)[number]

/**
 * Kanıt kanalı bu repository'de HENÜZ BULUNMAYAN alanlar için üretilen kodlar.
 * Uydurma veri yerine eksiklik açıkça işaretlenir ve satır `controlRequired`
 * olur (kullanıcı kuralı: yeterli kanıt yoksa en makul aday + control_required).
 */
export const LABOR_ALLOCATION_MISSING_EVIDENCE_CODES = [
  'EVIDENCE_MISSING_VEHICLE_IDENTITY',
  'EVIDENCE_MISSING_PART_CODE',
  'EVIDENCE_MISSING_DAMAGE_REGION',
  'EVIDENCE_MISSING_APPROVED_HISTORY',
  'EVIDENCE_MISSING_DICTIONARY_MATCH',
  'EVIDENCE_MISSING_EXPERT_BASELINE',
] as const
export type LaborAllocationMissingEvidenceCode =
  (typeof LABOR_ALLOCATION_MISSING_EVIDENCE_CODES)[number]

export const LABOR_ALLOCATION_CONFLICT_CODES = [
  'CONFLICT_ACTION_VS_OPERATION',
  'CONFLICT_AMOUNT_VS_OPERATION',
  'CONFLICT_HISTORY_DISAGREEMENT',
  'CONFLICT_EXPERT_BASELINE_DISAGREEMENT',
  'CONFLICT_DICTIONARY_DISAGREEMENT',
  'CONFLICT_ECONOMIC_INCONCLUSIVE',
] as const
export type LaborAllocationConflictCode = (typeof LABOR_ALLOCATION_CONFLICT_CODES)[number]

/**
 * Onarım ve değişim senaryolarının ortak kovaları. Karşılaştırma tek başına
 * parça bedeline bakmaz: her iki senaryo da sökme-takma, boya+sarf,
 * ayar/kalibrasyon ve ilişkili ek operasyonları içerir; fark onarım işçiliği
 * ile yeni parça/sahiplenme bedeli arasındadır.
 */
export const LABOR_ECONOMIC_SHARED_BUCKETS = [
  'remove_install',
  'paint_and_consumable',
  'calibration',
  'related_operations',
] as const satisfies readonly LaborEconomicBucket[]

/** Bildirilen onarım/değişim toplamları kovalardan deterministik hesaplanır. */
export function computeEconomicTotals(
  buckets: Readonly<Record<LaborEconomicBucket, number>>,
): { readonly repairTotalMinor: number; readonly replaceTotalMinor: number } {
  const shared = LABOR_ECONOMIC_SHARED_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0)
  return {
    repairTotalMinor: buckets.repair_labor + shared,
    replaceTotalMinor: buckets.new_part_or_ownership + shared,
  }
}

/** Bu eşiğin altındaki güven puanı tek başına insan kontrolünü zorunlu kılar. */
export const LABOR_ALLOCATION_CONTROL_CONFIDENCE_THRESHOLD = 0.6
export const LABOR_ALLOCATION_MAX_REASONING_LENGTH = 600
export const LABOR_ALLOCATION_MAX_EVIDENCE_REFS = 20
export const LABOR_ALLOCATION_MAX_ALLOCATIONS_PER_LINE = LABOR_OPERATION_TYPES.length
export const MAX_LABOR_ALLOCATION_DAMAGE_DESCRIPTION_LENGTH = 2_000

export interface LaborAllocationEvidenceLine {
  readonly ordinal: number
  readonly description: string
  readonly action: string
  readonly partAmountMinor: number
  readonly laborAmountMinor: number
  /** Paket 56: satır düzeyinde parça kodu; saf işçilikte null olabilir. */
  readonly partCode: string | null
  /** Paket 56: satır düzeyinde normalize hasar bölgesi. */
  readonly damageRegion: string | null
}

export interface LaborAllocationDictionaryEntry {
  readonly description: string
  readonly action: string
  readonly usageCount: number
}

/** Aynı organization içinde kullanıcı onaylı geçmiş dağıtım (özet). */
export interface LaborAllocationHistoryEntry {
  readonly description: string
  readonly action: string
  readonly operationTypes: readonly LaborOperationType[]
}

export interface LaborAllocationExpertBaseline {
  readonly sheetVersion: number
  readonly lines: readonly LaborAllocationEvidenceLine[]
}

export interface LaborAllocationPlanContext {
  readonly organizationId: string
  readonly caseId: string
  readonly caseVersion: number
  readonly caseType: CaseType
  readonly sheetId: string
  readonly sheetVersion: number
  readonly damageDescription: string
  readonly lines: readonly NormalizedLaborItem[]
  /** Paket 56: dosya düzeyinde araç profili; yoksa null. */
  readonly vehicleProfile: OutboundVehicleProfile | null
  readonly dictionary: readonly LaborAllocationDictionaryEntry[]
  readonly approvedHistory: readonly LaborAllocationHistoryEntry[]
  readonly expertBaseline: LaborAllocationExpertBaseline | null
  readonly providerId: string
  readonly providerVersion: string
  readonly modelId: string
  readonly externalProvider: boolean
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
}

export interface LaborAllocationOutboundContext {
  readonly context: {
    readonly caseType: CaseType
    readonly operationTypesVersion: typeof LABOR_OPERATION_TYPES_VERSION
    readonly allowedOperationTypes: readonly LaborOperationType[]
    readonly economicBuckets: readonly LaborEconomicBucket[]
    readonly damageDescription: string
    /** Normalize araç profili; tam şasi ve plaka içermez. */
    readonly vehicleProfile: OutboundVehicleProfile | null
    readonly lines: readonly LaborAllocationEvidenceLine[]
    readonly dictionary: readonly LaborAllocationDictionaryEntry[]
    readonly approvedHistory: readonly LaborAllocationHistoryEntry[]
    readonly expertBaseline: LaborAllocationExpertBaseline | null
  }
  readonly privacyPolicyVersion:
    | typeof LABOR_ALLOCATION_PRIVACY_POLICY_VERSION
    | typeof LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION
  readonly outboundPayloadHash: string | null
  readonly outboundInputCharacters: number
  readonly redactedValueCount: number
  readonly redactedCategories: readonly PolicyAiPiiCategory[]
  /** Kanalı bu repository'de bulunmayan kanıtlar; her satıra taşınır. */
  readonly missingEvidenceCodes: readonly LaborAllocationMissingEvidenceCode[]
  readonly warnings: readonly string[]
}

export interface LaborAllocationAmount {
  readonly operationType: LaborOperationType
  readonly amountMinor: number
}

export interface LaborAllocationEconomicComparison {
  readonly buckets: Readonly<Record<LaborEconomicBucket, number>>
  readonly repairTotalMinor: number
  readonly replaceTotalMinor: number
  readonly note: string
}

export interface LaborAllocationLineSuggestion {
  readonly lineOrdinal: number
  readonly allocations: readonly LaborAllocationAmount[]
  readonly repairReplaceOpinion: LaborRepairReplaceOpinion
  readonly economicComparison: LaborAllocationEconomicComparison
  readonly reasoning: string
  readonly evidenceRefs: readonly string[]
  readonly confidence: number
  readonly conflictCodes: readonly LaborAllocationConflictCode[]
  readonly missingEvidenceCodes: readonly LaborAllocationMissingEvidenceCode[]
  readonly controlRequired: boolean
  /**
   * Paket 57: eşleşen baseline ile ekonomik şekil karşılaştırması. Baseline
   * yoksa veya satır belirsiz eşleştiyse null kalır. Sağlayıcı bu alanı
   * üretmez; sunucu hesaplar.
   */
  readonly baselineComparison?: LaborBaselineComparison | null
}

export interface LaborAllocationSuggestionInput {
  readonly schemaVersion: typeof LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION
  readonly operationTypesVersion: typeof LABOR_OPERATION_TYPES_VERSION
  readonly lines: readonly LaborAllocationLineSuggestion[]
  readonly requiresHumanReview: true
}

export type LaborAllocationValidation =
  | { readonly allowed: true; readonly suggestion: LaborAllocationSuggestionInput }
  | {
      readonly allowed: false
      readonly code:
        | 'AI_OUTPUT_SCHEMA_INVALID'
        | 'AI_OUTPUT_LINE_COVERAGE_INVALID'
        | 'AI_OUTPUT_ALLOCATION_INVALID'
        | 'AI_OUTPUT_ALLOCATION_SUM_INVALID'
        | 'AI_OUTPUT_ECONOMIC_INVALID'
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

/**
 * Eksik kanıt kanallarını GERÇEK VERİYE göre hesaplar (Paket 56).
 *
 * Paket 54'te bu kanallar şemada bulunmadığı için koşulsuz eksik sayılıyordu.
 * Artık alanlar mevcut: kod yalnız veri gerçekten yoksa üretilir.
 * - Araç kimliği: dosya düzeyinde profil yoksa.
 * - Parça kodu: parça bedeli olan (`partAmountMinor > 0`) bir satırda kod yoksa.
 *   Saf işçilik satırında parça kodu zorunlu SAYILMAZ.
 * - Hasar bölgesi: herhangi bir satırda bölge yoksa.
 */
export function detectMissingEvidence(
  input: LaborAllocationPlanContext,
): readonly LaborAllocationMissingEvidenceCode[] {
  const codes: LaborAllocationMissingEvidenceCode[] = []
  if (input.vehicleProfile === null) codes.push('EVIDENCE_MISSING_VEHICLE_IDENTITY')
  const partCodeMissing = input.lines.some((line) => (
    line.partAmountMinor > 0 && (line.partCode ?? null) === null
  ))
  if (partCodeMissing) codes.push('EVIDENCE_MISSING_PART_CODE')
  const damageRegionMissing = input.lines.some((line) => (line.damageRegion ?? null) === null)
  if (damageRegionMissing) codes.push('EVIDENCE_MISSING_DAMAGE_REGION')
  if (input.approvedHistory.length === 0) codes.push('EVIDENCE_MISSING_APPROVED_HISTORY')
  if (input.dictionary.length === 0) codes.push('EVIDENCE_MISSING_DICTIONARY_MATCH')
  // Paket 57: baseline'ın var olması yetmez; her satırın belirsizlik olmadan
  // eşleşmesi gerekir. Eşleşmeyen satır varken kodu kaldırmak, o satır için
  // baseline varmış gibi davranmak olurdu.
  if (!hasCompleteBaselineMatch(baselineMatches(input))) {
    codes.push('EVIDENCE_MISSING_EXPERT_BASELINE')
  }
  return codes
}

/** Güncel föy satırlarının baseline karşılıkları; baseline yoksa hepsi boştur. */
export function baselineMatches(
  input: LaborAllocationPlanContext,
): readonly LaborBaselineLineMatch[] {
  if (input.expertBaseline === null) {
    return evidenceLines(input.lines).map((line) => ({
      ordinal: line.ordinal, baseline: null, reason: 'no_candidate' as const,
    }))
  }
  return matchBaselineLines(evidenceLines(input.lines), input.expertBaseline.lines)
}

function evidenceLines(lines: readonly NormalizedLaborItem[]): readonly LaborAllocationEvidenceLine[] {
  return lines.map((line, index) => ({
    ordinal: index + 1,
    description: line.description,
    action: line.action,
    partAmountMinor: line.partAmountMinor,
    laborAmountMinor: line.laborAmountMinor,
    partCode: line.partCode ?? null,
    damageRegion: line.damageRegion ?? null,
  }))
}

/**
 * Dış sağlayıcıya çıkacak kanıt kümesi. Plaka, ofis numarası ve vaka kimliği
 * ASLA çıkmaz; serbest metinler PII minimizasyonundan geçer.
 */
export function buildLaborAllocationOutboundContext(
  input: LaborAllocationPlanContext,
): LaborAllocationOutboundContext {
  const lines = evidenceLines(input.lines)
  const rawSources = [
    { sourceAnchorId: 'damage-description', text: input.damageDescription },
    ...lines.flatMap((line) => [
      { sourceAnchorId: `line-${line.ordinal}-description`, text: line.description },
      { sourceAnchorId: `line-${line.ordinal}-action`, text: line.action },
      ...(line.damageRegion === null
        ? []
        : [{ sourceAnchorId: `line-${line.ordinal}-damage-region`, text: line.damageRegion }]),
    ]),
    ...input.dictionary.flatMap((entry, index) => [
      { sourceAnchorId: `dictionary-${index + 1}-description`, text: entry.description },
      { sourceAnchorId: `dictionary-${index + 1}-action`, text: entry.action },
    ]),
    ...input.approvedHistory.flatMap((entry, index) => [
      { sourceAnchorId: `history-${index + 1}-description`, text: entry.description },
      { sourceAnchorId: `history-${index + 1}-action`, text: entry.action },
    ]),
  ]
  const warnings = rawSources.flatMap((source) => (
    detectPolicyAiPromptInjection(source.text).map((warning) => `${source.sourceAnchorId}:${warning}`)
  ))
  const missingEvidenceCodes = detectMissingEvidence(input)

  const buildContext = (resolve: (anchor: string, fallback: string) => string) => ({
    caseType: input.caseType,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    allowedOperationTypes: LABOR_OPERATION_TYPES,
    economicBuckets: LABOR_ECONOMIC_BUCKETS,
    damageDescription: resolve('damage-description', input.damageDescription),
    vehicleProfile: input.vehicleProfile,
    lines: lines.map((line) => ({
      ordinal: line.ordinal,
      description: resolve(`line-${line.ordinal}-description`, line.description),
      action: resolve(`line-${line.ordinal}-action`, line.action),
      partAmountMinor: line.partAmountMinor,
      laborAmountMinor: line.laborAmountMinor,
      partCode: line.partCode,
      damageRegion: line.damageRegion === null
        ? null
        : resolve(`line-${line.ordinal}-damage-region`, line.damageRegion),
    })),
    dictionary: input.dictionary.map((entry, index) => ({
      description: resolve(`dictionary-${index + 1}-description`, entry.description),
      action: resolve(`dictionary-${index + 1}-action`, entry.action),
      usageCount: entry.usageCount,
    })),
    approvedHistory: input.approvedHistory.map((entry, index) => ({
      description: resolve(`history-${index + 1}-description`, entry.description),
      action: resolve(`history-${index + 1}-action`, entry.action),
      operationTypes: entry.operationTypes,
    })),
    expertBaseline: input.expertBaseline,
  })

  if (!input.externalProvider) {
    const context = buildContext((_anchor, fallback) => fallback)
    return {
      context,
      privacyPolicyVersion: LABOR_ALLOCATION_LOCAL_PRIVACY_POLICY_VERSION,
      outboundPayloadHash: null,
      outboundInputCharacters: canonical(context).length,
      redactedValueCount: 0,
      redactedCategories: [],
      missingEvidenceCodes,
      warnings,
    }
  }
  const minimized = minimizePolicyAiSources(rawSources)
  const minimizedMap = new Map(minimized.sources.map((source) => [source.sourceAnchorId, source.text]))
  const context = buildContext((anchor) => minimizedMap.get(anchor) ?? '')
  return {
    context,
    privacyPolicyVersion: LABOR_ALLOCATION_PRIVACY_POLICY_VERSION,
    outboundPayloadHash: sha256Text(`labor-allocation-outbound/1|${canonical(context)}`),
    outboundInputCharacters: canonical(context).length,
    redactedValueCount: minimized.redactedValueCount,
    redactedCategories: minimized.redactedCategories,
    missingEvidenceCodes,
    warnings,
  }
}

/**
 * Girdi kanıtlarının snapshot hash'i. Kaynak föy veya kanıt değişirse hash
 * değişir; eski öneri stale sayılır ve uygulanamaz.
 */
export function buildLaborAllocationEvidenceHash(input: LaborAllocationPlanContext): string {
  return sha256Text(canonical({
    ruleVersion: LABOR_ALLOCATION_RULE_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    organizationId: input.organizationId,
    caseId: input.caseId,
    sheetId: input.sheetId,
    sheetVersion: input.sheetVersion,
    lines: evidenceLines(input.lines),
    // Paket 56: araç profili kanıt snapshot'ına dahildir; değişirse öneri stale olur.
    vehicleProfile: input.vehicleProfile,
    dictionary: input.dictionary,
    approvedHistory: input.approvedHistory,
    expertBaseline: input.expertBaseline,
    damageDescription: input.damageDescription,
  }))
}

export function buildLaborAllocationPlanHash(
  input: LaborAllocationPlanContext,
  outbound: LaborAllocationOutboundContext,
): string {
  return sha256Text(canonical({
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    promptTemplateVersion: LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION,
    ruleVersion: LABOR_ALLOCATION_RULE_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    organizationId: input.organizationId,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    sheetId: input.sheetId,
    sheetVersion: input.sheetVersion,
    evidenceHash: buildLaborAllocationEvidenceHash(input),
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    modelId: input.modelId,
    retentionMode: input.retentionMode,
    pricingVersion: input.pricingVersion,
    privacyPolicyVersion: outbound.privacyPolicyVersion,
    outboundPayloadHash: outbound.outboundPayloadHash,
  }))
}

function isStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string')
}

function isValidAllocationShape(value: unknown): value is LaborAllocationAmount {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['operationType', 'amountMinor'].includes(key))) return false
  return typeof item.operationType === 'string'
    && (LABOR_OPERATION_TYPES as readonly string[]).includes(item.operationType)
    && typeof item.amountMinor === 'number'
}

function isValidEconomicShape(value: unknown): value is LaborAllocationEconomicComparison {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['buckets', 'repairTotalMinor', 'replaceTotalMinor', 'note'].includes(key))) {
    return false
  }
  const buckets = item.buckets
  if (buckets === null || typeof buckets !== 'object' || Array.isArray(buckets)) return false
  const bucketKeys = Object.keys(buckets as Record<string, unknown>)
  if (bucketKeys.length !== LABOR_ECONOMIC_BUCKETS.length) return false
  if (!LABOR_ECONOMIC_BUCKETS.every((bucket) => typeof (buckets as Record<string, unknown>)[bucket] === 'number')) {
    return false
  }
  return typeof item.repairTotalMinor === 'number'
    && typeof item.replaceTotalMinor === 'number'
    && typeof item.note === 'string'
}

function isValidLineShape(value: unknown): value is LaborAllocationLineSuggestion {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => ![
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
  ].includes(key))) return false
  return typeof item.lineOrdinal === 'number'
    && Number.isSafeInteger(item.lineOrdinal)
    && item.lineOrdinal >= 1
    && Array.isArray(item.allocations)
    && item.allocations.length >= 1
    && item.allocations.length <= LABOR_ALLOCATION_MAX_ALLOCATIONS_PER_LINE
    && item.allocations.every(isValidAllocationShape)
    && typeof item.repairReplaceOpinion === 'string'
    && (LABOR_REPAIR_REPLACE_OPINIONS as readonly string[]).includes(item.repairReplaceOpinion)
    && isValidEconomicShape(item.economicComparison)
    && typeof item.reasoning === 'string'
    && item.reasoning.trim().length >= 1
    && item.reasoning.trim().length <= LABOR_ALLOCATION_MAX_REASONING_LENGTH
    && isStringArray(item.evidenceRefs, LABOR_ALLOCATION_MAX_EVIDENCE_REFS)
    && isStringArray(item.conflictCodes, LABOR_ALLOCATION_CONFLICT_CODES.length)
    && (item.conflictCodes as string[]).every((code) => (LABOR_ALLOCATION_CONFLICT_CODES as readonly string[]).includes(code))
    && isStringArray(item.missingEvidenceCodes, LABOR_ALLOCATION_MISSING_EVIDENCE_CODES.length)
    && (item.missingEvidenceCodes as string[]).every((code) => (LABOR_ALLOCATION_MISSING_EVIDENCE_CODES as readonly string[]).includes(code))
    && typeof item.confidence === 'number'
    && Number.isFinite(item.confidence)
    && item.confidence >= 0
    && item.confidence <= 1
    && typeof item.controlRequired === 'boolean'
}

function isValidSuggestionShape(value: unknown): value is LaborAllocationSuggestionInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => ![
    'schemaVersion',
    'operationTypesVersion',
    'lines',
    'requiresHumanReview',
  ].includes(key))) return false
  return item.schemaVersion === LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION
    && item.operationTypesVersion === LABOR_OPERATION_TYPES_VERSION
    && Array.isArray(item.lines)
    && item.lines.length >= 1
    && item.lines.length <= MAX_LABOR_SHEET_ITEMS
    && item.lines.every(isValidLineShape)
    && item.requiresHumanReview === true
}

/**
 * `controlRequired` sunucu tarafında yeniden hesaplanır; sağlayıcının `false`
 * demesi tek başına yeterli DEĞİLDİR. Zorunlu kılan durumlar: `other` operasyon
 * türü, eksik kanıt kodu, çelişki kodu, eşik altı güven, kesin olmayan kanaat.
 */
export function requiresControl(line: LaborAllocationLineSuggestion): boolean {
  return line.controlRequired
    || line.allocations.some((allocation) => allocation.operationType === 'other')
    || line.missingEvidenceCodes.length > 0
    || line.conflictCodes.length > 0
    || line.confidence < LABOR_ALLOCATION_CONTROL_CONFIDENCE_THRESHOLD
    || line.repairReplaceOpinion === 'insufficient_evidence'
}

/**
 * Sağlayıcı çıktısını strict doğrular.
 *
 * - Föydeki HER satır tam olarak bir kez kapsanmalıdır (sessiz boş satır yok).
 * - Satır tahsis toplamı, satırın parça+işçilik toplamına eşit olmalıdır;
 *   aritmetik tutarsızlık belirsizlik değildir, geçersiz çıktıdır.
 * - Ekonomik karşılaştırma kova toplamları negatif olamaz ve bildirilen
 *   onarım/değişim toplamları kovalarla tutarlı olmalıdır.
 * - PII placeholder, URL, dosya yolu veya PII içeren metin kabul edilmez.
 */
export function validateLaborAllocationSuggestion(
  value: unknown,
  sheetLines: readonly NormalizedLaborItem[],
  missingEvidenceCodes: readonly LaborAllocationMissingEvidenceCode[] = [],
  /**
   * Paket 57: satır sırasına göre eşleşmiş baseline. Çelişki kodu SUNUCUDA
   * hesaplanır; modelin kendi beyanına bırakılmaz.
   */
  baselineByOrdinal: ReadonlyMap<number, LaborAllocationEvidenceLine> = new Map(),
): LaborAllocationValidation {
  if (!isValidSuggestionShape(value)) return { allowed: false, code: 'AI_OUTPUT_SCHEMA_INVALID' }
  if (value.lines.length !== sheetLines.length) {
    return { allowed: false, code: 'AI_OUTPUT_LINE_COVERAGE_INVALID' }
  }
  const seen = new Set<number>()
  for (const line of value.lines) {
    if (line.lineOrdinal > sheetLines.length || seen.has(line.lineOrdinal)) {
      return { allowed: false, code: 'AI_OUTPUT_LINE_COVERAGE_INVALID' }
    }
    seen.add(line.lineOrdinal)
  }

  const normalizedLines: LaborAllocationLineSuggestion[] = []
  let sheetTotalMinor = 0
  for (const line of [...value.lines].sort((left, right) => left.lineOrdinal - right.lineOrdinal)) {
    const sheetLine = sheetLines[line.lineOrdinal - 1] as NormalizedLaborItem
    const lineTotalMinor = sheetLine.partAmountMinor + sheetLine.laborAmountMinor
    sheetTotalMinor += lineTotalMinor

    const operationTypes = new Set<LaborOperationType>()
    let allocationTotal = 0
    for (const allocation of line.allocations) {
      if (!isValidLaborAmountMinor(allocation.amountMinor)) {
        return { allowed: false, code: 'AI_OUTPUT_ALLOCATION_INVALID' }
      }
      if (operationTypes.has(allocation.operationType)) {
        return { allowed: false, code: 'AI_OUTPUT_ALLOCATION_INVALID' }
      }
      operationTypes.add(allocation.operationType)
      allocationTotal += allocation.amountMinor
    }
    if (allocationTotal !== lineTotalMinor) {
      return { allowed: false, code: 'AI_OUTPUT_ALLOCATION_SUM_INVALID' }
    }

    const economic = line.economicComparison
    let bucketTotal = 0
    for (const bucket of LABOR_ECONOMIC_BUCKETS) {
      const amount = economic.buckets[bucket]
      if (!isValidLaborAmountMinor(amount)) return { allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' }
      bucketTotal += amount
    }
    if (!isValidLaborAmountMinor(economic.repairTotalMinor)
      || !isValidLaborAmountMinor(economic.replaceTotalMinor)) {
      return { allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' }
    }
    if (bucketTotal > MAX_LABOR_SHEET_TOTAL_MINOR) {
      return { allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' }
    }
    // Bildirilen toplamlar kovalardan deterministik hesaplanır; sağlayıcının
    // kendi aritmetiği kabul edilmez.
    const expectedTotals = computeEconomicTotals(economic.buckets)
    if (economic.repairTotalMinor !== expectedTotals.repairTotalMinor
      || economic.replaceTotalMinor !== expectedTotals.replaceTotalMinor) {
      return { allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' }
    }
    const note = normalizeLaborText(economic.note, LABOR_ALLOCATION_MAX_REASONING_LENGTH)
    const reasoning = normalizeLaborText(line.reasoning, LABOR_ALLOCATION_MAX_REASONING_LENGTH)
    if (note === null || reasoning === null) {
      return { allowed: false, code: 'AI_OUTPUT_ECONOMIC_INVALID' }
    }

    const mergedMissing = [...new Set([...line.missingEvidenceCodes, ...missingEvidenceCodes])].sort()

    // Baseline ile karşılaştırma: eşleşen satırda ekonomik şekil belirgin
    // sapıyorsa çelişki kodu zorlanır ve satır kontrol gerekli olur. Model
    // çelişkiyi bildirmese de bu kod düşmez.
    const matchedBaseline = baselineByOrdinal.get(line.lineOrdinal) ?? null
    const baselineComparison = matchedBaseline === null ? null : compareBaselineAllocation(
      matchedBaseline,
      {
        partLikeMinor: economic.buckets.new_part_or_ownership,
        laborLikeMinor: expectedTotals.repairTotalMinor,
      },
    )
    const mergedConflicts = baselineComparison?.conflicts === true
      ? [...new Set([...line.conflictCodes, 'CONFLICT_EXPERT_BASELINE_DISAGREEMENT' as const])]
      : [...line.conflictCodes]

    const candidate: LaborAllocationLineSuggestion = {
      lineOrdinal: line.lineOrdinal,
      allocations: line.allocations.map((allocation) => ({ ...allocation })),
      repairReplaceOpinion: line.repairReplaceOpinion,
      economicComparison: {
        buckets: Object.fromEntries(
          LABOR_ECONOMIC_BUCKETS.map((bucket) => [bucket, economic.buckets[bucket]]),
        ) as Record<LaborEconomicBucket, number>,
        repairTotalMinor: economic.repairTotalMinor,
        replaceTotalMinor: economic.replaceTotalMinor,
        note,
      },
      reasoning,
      evidenceRefs: [...line.evidenceRefs],
      confidence: line.confidence,
      conflictCodes: mergedConflicts.sort(),
      missingEvidenceCodes: mergedMissing as LaborAllocationMissingEvidenceCode[],
      controlRequired: line.controlRequired,
      baselineComparison,
    }
    normalizedLines.push({ ...candidate, controlRequired: requiresControl(candidate) })
  }
  if (sheetTotalMinor > MAX_LABOR_SHEET_TOTAL_MINOR) {
    return { allowed: false, code: 'AI_OUTPUT_ALLOCATION_SUM_INVALID' }
  }

  const combined = normalizedLines
    .flatMap((line) => [line.reasoning, line.economicComparison.note, ...line.evidenceRefs])
    .join('\n')
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

  return {
    allowed: true,
    suggestion: {
      schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
      operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
      lines: normalizedLines,
      requiresHumanReview: true,
    },
  }
}

/** Kabul edilebilir satırlar: "kontrol gerekli olanlar hariç tümünü seç" için. */
export function selectableLineOrdinals(
  suggestion: LaborAllocationSuggestionInput,
): readonly number[] {
  return suggestion.lines
    .filter((line) => !line.controlRequired)
    .map((line) => line.lineOrdinal)
    .sort((left, right) => left - right)
}

/** Metin uzunluğu sınırı; plan bağlamı kurulmadan önce çağrılır. */
export function isValidAllocationDamageDescription(value: string): boolean {
  const normalized = normalizeLaborText(value, MAX_LABOR_ALLOCATION_DAMAGE_DESCRIPTION_LENGTH)
  return normalized !== null
}
