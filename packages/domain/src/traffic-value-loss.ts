import type { LocalDate } from './temporal.js'

export const TRAFFIC_VALUE_LOSS_RULE_SET_ID = 'traffic-value-loss-market-difference' as const
export const TRAFFIC_VALUE_LOSS_RULE_VERSION = '2026.07.01.1' as const
export const TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM = '2026-07-01' as LocalDate
export const TRAFFIC_VALUE_LOSS_CALCULATION_METHOD = 'market_value_difference' as const
export const TRAFFIC_VALUE_LOSS_ROUNDING_RULE = 'half_up_minor_unit' as const

export const TRAFFIC_VALUE_LOSS_STATUSES = [
  'draft',
  'control_required',
  'awaiting_approval',
  'approved',
  'rejected',
  'superseded',
] as const
export type TrafficValueLossStatus = (typeof TRAFFIC_VALUE_LOSS_STATUSES)[number]

export const TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES = [
  'calculable',
  'no_value_loss',
  'not_applicable',
  'control_required',
] as const
export type TrafficValueLossEligibilityStatus = (typeof TRAFFIC_VALUE_LOSS_ELIGIBILITY_STATUSES)[number]

export const TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES = [
  'document_version',
  'market_comparable',
  'sbm_history',
  'expert_observation',
] as const
export type TrafficValueLossEvidenceSourceType = (typeof TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES)[number]

export const TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS = [
  'vehicle_identity',
  'mileage',
  'usage_type',
  'damage_parts',
  'prior_damage',
  'pre_accident_market_value',
  'post_repair_market_value',
  'fault_rate',
  'heavy_damage_status',
] as const
export type TrafficValueLossEvidenceField = (typeof TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS)[number]

export const TRAFFIC_VALUE_LOSS_UNCERTAINTY_CODES = [
  'WRONG_CASE_TYPE',
  'LOSS_DATE_MISSING',
  'RULE_PERIOD_NOT_APPLICABLE',
  'HEAVY_DAMAGE_STATUS_UNKNOWN',
  'HEAVY_DAMAGE_EVIDENCE_MISSING',
  'VEHICLE_IDENTITY_INCOMPLETE',
  'MILEAGE_MISSING',
  'USAGE_TYPE_MISSING',
  'DAMAGE_PARTS_MISSING',
  'PRIOR_DAMAGE_UNKNOWN',
  'FAULT_RATE_MISSING',
  'MARKET_VALUES_MISSING',
  'PRE_VALUE_EVIDENCE_MISSING',
  'POST_VALUE_EVIDENCE_MISSING',
  'INSUFFICIENT_PRE_COMPARABLES',
  'INSUFFICIENT_POST_COMPARABLES',
  'SOURCE_CONFLICT',
] as const
export type TrafficValueLossUncertaintyCode = (typeof TRAFFIC_VALUE_LOSS_UNCERTAINTY_CODES)[number]

export interface TrafficValueLossRuleSource {
  readonly code: string
  readonly title: string
  readonly sourceType: 'official_gazette' | 'seddk_circular'
  readonly publishedAt: LocalDate
  readonly effectiveFrom: LocalDate
  readonly locator: string
  readonly url: string
}

export const TRAFFIC_VALUE_LOSS_RULE_SOURCES: readonly TrafficValueLossRuleSource[] = [
  {
    code: 'RG-33278-2026-06-12-M2-M6-M8',
    title: 'Karayolları Motorlu Araçlar Zorunlu Mali Sorumluluk Sigortası Genel Şartlarında Değişiklik',
    sourceType: 'official_gazette',
    publishedAt: '2026-06-12' as LocalDate,
    effectiveFrom: TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM,
    locator: 'Madde 2, Madde 6 ve Madde 8',
    url: 'https://www.resmigazete.gov.tr/eskiler/2026/06/20260612-3.htm',
  },
  {
    code: 'SEDDK-2026-11-EK-1.1',
    title: 'Motorlu Araç Sigortaları Kapsamında Sigorta Eksperlerince Kullanılacak Rapor Şablonları',
    sourceType: 'seddk_circular',
    publishedAt: '2026-05-13' as LocalDate,
    effectiveFrom: TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM,
    locator: 'Madde 4 ve Ek-1.1, Değer Kaybı Hesaplaması',
    url: 'https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf',
  },
] as const

export interface TrafficValueLossDamagePart {
  readonly partCode: string
  readonly partName: string
  readonly repairAction: 'repair_paint' | 'replace_paint' | 'paint' | 'replace' | 'paintless_repair'
  readonly priorDamage: 'yes' | 'no' | 'unknown'
}

export interface TrafficValueLossEvidenceFact {
  readonly evidenceKey: string
  readonly sourceType: TrafficValueLossEvidenceSourceType
  readonly sourceHash: string
  readonly supports: readonly TrafficValueLossEvidenceField[]
  readonly verificationStatus: 'verified' | 'control_required'
  readonly conflict: boolean
}

export interface TrafficValueLossComparable {
  readonly comparableKey: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amountMinor: number
  readonly mileage: number | null
  readonly observedAt: LocalDate
  readonly evidenceKey: string
  readonly excluded: boolean
  readonly exclusionReason: string | null
}

export interface TrafficValueLossInput {
  readonly caseType: 'traffic' | 'casco'
  readonly lossDate: LocalDate | null
  readonly evaluatedOn: LocalDate
  readonly heavyOrTotalDamage: boolean | null
  readonly vehicle: {
    readonly make: string | null
    readonly model: string | null
    readonly variant: string | null
    readonly modelYear: number | null
    readonly mileage: number | null
    readonly usageType: string | null
  }
  readonly faultRateBasisPoints: number | null
  readonly preAccidentMarketValueMinor: number | null
  readonly postRepairMarketValueMinor: number | null
  readonly damageParts: readonly TrafficValueLossDamagePart[]
  readonly comparables: readonly TrafficValueLossComparable[]
  readonly evidence: readonly TrafficValueLossEvidenceFact[]
}

export interface TrafficValueLossUncertainty {
  readonly code: TrafficValueLossUncertaintyCode
  readonly field: string
  readonly reason: string
  readonly blocking: boolean
  readonly requiresHumanReview: true
}

export interface TrafficValueLossEvaluation {
  readonly ruleSetId: typeof TRAFFIC_VALUE_LOSS_RULE_SET_ID
  readonly ruleVersion: typeof TRAFFIC_VALUE_LOSS_RULE_VERSION
  readonly effectiveFrom: LocalDate
  readonly calculationMethod: typeof TRAFFIC_VALUE_LOSS_CALCULATION_METHOD
  readonly roundingRule: typeof TRAFFIC_VALUE_LOSS_ROUNDING_RULE
  readonly ruleSources: readonly TrafficValueLossRuleSource[]
  readonly eligibilityStatus: TrafficValueLossEligibilityStatus
  readonly grossValueLossMinor: number | null
  readonly faultAdjustedValueLossMinor: number | null
  readonly qualifyingPreComparableCount: number
  readonly qualifyingPostComparableCount: number
  readonly uncertainties: readonly TrafficValueLossUncertainty[]
  readonly reasoning: readonly string[]
  readonly humanApprovalRequired: true
  readonly canSubmitForApproval: boolean
}

const MIN_COMPARABLES_PER_SIDE = 3
const MAX_COMPARABLE_AGE_DAYS = 30

function dateOrdinal(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86_400_000)
}

function isComparableQualified(item: TrafficValueLossComparable, input: TrafficValueLossInput): boolean {
  if (item.excluded) return false
  if (dateOrdinal(input.evaluatedOn) - dateOrdinal(item.observedAt) < 0) return false
  if (dateOrdinal(input.evaluatedOn) - dateOrdinal(item.observedAt) > MAX_COMPARABLE_AGE_DAYS) return false
  const mileage = input.vehicle.mileage
  if (mileage === null || item.mileage === null) return false
  const tolerance = Math.max(1, Math.floor(mileage * 0.1))
  return Math.abs(item.mileage - mileage) <= tolerance
}

function hasVerifiedEvidence(input: TrafficValueLossInput, field: TrafficValueLossEvidenceField): boolean {
  return input.evidence.some((item) =>
    item.verificationStatus === 'verified'
    && item.conflict === false
    && item.supports.includes(field),
  )
}

function uncertainty(
  code: TrafficValueLossUncertaintyCode,
  field: string,
  reason: string,
): TrafficValueLossUncertainty {
  return { code, field, reason, blocking: true, requiresHumanReview: true }
}

function isSafeMoney(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0
}

function isSafeBasisPoints(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 10_000
}

function applyBasisPointsHalfUp(amountMinor: number, basisPoints: number): number | null {
  const wholeUnits = Math.floor(amountMinor / 10_000)
  const remainder = amountMinor % 10_000
  const wholeShare = wholeUnits * basisPoints
  const remainderShare = Math.floor(((remainder * basisPoints) + 5_000) / 10_000)
  const result = wholeShare + remainderShare
  return Number.isSafeInteger(result) ? result : null
}

export function evaluateTrafficValueLoss(input: TrafficValueLossInput): TrafficValueLossEvaluation {
  const uncertainties: TrafficValueLossUncertainty[] = []
  const reasoning: string[] = [
    '01.07.2026 döneminde yürürlükten kaldırılan Ek-1 katsayı formülü uygulanmaz.',
    'Taslak, kaza öncesi ve onarım sonrası doğrulanmış ikinci el piyasa değerleri arasındaki farka dayanır.',
  ]

  if (input.caseType !== 'traffic') uncertainties.push(uncertainty('WRONG_CASE_TYPE', 'caseType', 'Bu kural sürümü yalnız Trafik dosyaları içindir.'))
  if (input.lossDate === null) uncertainties.push(uncertainty('LOSS_DATE_MISSING', 'lossDate', 'Hasar tarihi olmadan uygulanacak dönem doğrulanamaz.'))
  else if (input.lossDate < TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM) uncertainties.push(uncertainty('RULE_PERIOD_NOT_APPLICABLE', 'lossDate', 'Bu sürüm 01.07.2026 ve sonrası dönem içindir.'))
  if (input.heavyOrTotalDamage === null) uncertainties.push(uncertainty('HEAVY_DAMAGE_STATUS_UNKNOWN', 'heavyOrTotalDamage', 'Ağır veya tam hasar durumu kesinleştirilmelidir.'))
  if (!hasVerifiedEvidence(input, 'heavy_damage_status')) uncertainties.push(uncertainty('HEAVY_DAMAGE_EVIDENCE_MISSING', 'heavyOrTotalDamage', 'Ağır/tam hasar durumunu destekleyen doğrulanmış kanıt yoktur.'))

  const sourceConflict = input.evidence.some((item) => item.conflict)
  if (sourceConflict) uncertainties.push(uncertainty('SOURCE_CONFLICT', 'evidence', 'Kaynaklar arasında çözülmemiş çelişki vardır.'))

  if (input.heavyOrTotalDamage === true) {
    const blocking = uncertainties.some((item) => item.code !== 'MARKET_VALUES_MISSING')
    return {
      ruleSetId: TRAFFIC_VALUE_LOSS_RULE_SET_ID,
      ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION,
      effectiveFrom: TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM,
      calculationMethod: TRAFFIC_VALUE_LOSS_CALCULATION_METHOD,
      roundingRule: TRAFFIC_VALUE_LOSS_ROUNDING_RULE,
      ruleSources: TRAFFIC_VALUE_LOSS_RULE_SOURCES,
      eligibilityStatus: blocking ? 'control_required' : 'not_applicable',
      grossValueLossMinor: null,
      faultAdjustedValueLossMinor: null,
      qualifyingPreComparableCount: 0,
      qualifyingPostComparableCount: 0,
      uncertainties,
      reasoning: [...reasoning, 'Ağır veya tam hasar kesinleştiğinde değer kaybı dahil rapor şablonu uygulanmaz.'],
      humanApprovalRequired: true,
      canSubmitForApproval: !blocking,
    }
  }

  if ([input.vehicle.make, input.vehicle.model, input.vehicle.variant].some((value) => value === null || value.trim().length === 0)
    || input.vehicle.modelYear === null) {
    uncertainties.push(uncertainty('VEHICLE_IDENTITY_INCOMPLETE', 'vehicle', 'Marka, model, varyant ve model yılı tamamlanmalıdır.'))
  }
  if (input.vehicle.mileage === null || !Number.isSafeInteger(input.vehicle.mileage) || input.vehicle.mileage < 0) {
    uncertainties.push(uncertainty('MILEAGE_MISSING', 'vehicle.mileage', 'Kilometre doğrulanmalıdır.'))
  }
  if (input.vehicle.usageType === null || input.vehicle.usageType.trim().length === 0) {
    uncertainties.push(uncertainty('USAGE_TYPE_MISSING', 'vehicle.usageType', 'Kullanım şekli doğrulanmalıdır.'))
  }
  if (input.damageParts.length === 0) uncertainties.push(uncertainty('DAMAGE_PARTS_MISSING', 'damageParts', 'Değer kaybına konu parça ve işlem listesi gereklidir.'))
  if (input.damageParts.some((part) => part.priorDamage === 'unknown')) uncertainties.push(uncertainty('PRIOR_DAMAGE_UNKNOWN', 'damageParts.priorDamage', 'Parçaların önceki hasar durumu belirsizdir.'))
  if (!isSafeBasisPoints(input.faultRateBasisPoints)) uncertainties.push(uncertainty('FAULT_RATE_MISSING', 'faultRateBasisPoints', 'Kusur oranı 0-10000 baz puan aralığında doğrulanmalıdır.'))
  if (!isSafeMoney(input.preAccidentMarketValueMinor) || !isSafeMoney(input.postRepairMarketValueMinor)) {
    uncertainties.push(uncertainty('MARKET_VALUES_MISSING', 'marketValues', 'Kaza öncesi ve onarım sonrası piyasa değerleri güvenli minor-unit olarak gereklidir.'))
  }
  if (!hasVerifiedEvidence(input, 'pre_accident_market_value')) uncertainties.push(uncertainty('PRE_VALUE_EVIDENCE_MISSING', 'preAccidentMarketValueMinor', 'Kaza öncesi piyasa değerini destekleyen doğrulanmış kanıt yoktur.'))
  if (!hasVerifiedEvidence(input, 'post_repair_market_value')) uncertainties.push(uncertainty('POST_VALUE_EVIDENCE_MISSING', 'postRepairMarketValueMinor', 'Onarım sonrası piyasa değerini destekleyen doğrulanmış kanıt yoktur.'))

  const qualified = input.comparables.filter((item) => isComparableQualified(item, input))
  const qualifyingPreComparableCount = qualified.filter((item) => item.side === 'pre_accident').length
  const qualifyingPostComparableCount = qualified.filter((item) => item.side === 'post_repair').length
  if (qualifyingPreComparableCount < MIN_COMPARABLES_PER_SIDE) uncertainties.push(uncertainty('INSUFFICIENT_PRE_COMPARABLES', 'comparables', 'Kaza öncesi değer için son 30 gün ve ±%10 km aralığında en az üç emsal gereklidir.'))
  if (qualifyingPostComparableCount < MIN_COMPARABLES_PER_SIDE) uncertainties.push(uncertainty('INSUFFICIENT_POST_COMPARABLES', 'comparables', 'Onarım sonrası değer için son 30 gün ve ±%10 km aralığında en az üç emsal gereklidir.'))

  let grossValueLossMinor: number | null = null
  let faultAdjustedValueLossMinor: number | null = null
  if (isSafeMoney(input.preAccidentMarketValueMinor) && isSafeMoney(input.postRepairMarketValueMinor)) {
    grossValueLossMinor = Math.max(0, input.preAccidentMarketValueMinor - input.postRepairMarketValueMinor)
    if (isSafeBasisPoints(input.faultRateBasisPoints)) {
      faultAdjustedValueLossMinor = applyBasisPointsHalfUp(grossValueLossMinor, input.faultRateBasisPoints)
    }
  }

  const eligibilityStatus: TrafficValueLossEligibilityStatus = uncertainties.length > 0
    ? 'control_required'
    : grossValueLossMinor === 0
      ? 'no_value_loss'
      : 'calculable'

  if (grossValueLossMinor !== null) reasoning.push(`Piyasa değer farkı ${grossValueLossMinor} minor-unit olarak taslaklandı.`)
  if (faultAdjustedValueLossMinor !== null) reasoning.push(`Kusur oranı uygulanmış taslak ${faultAdjustedValueLossMinor} minor-unit olarak hesaplandı.`)

  return {
    ruleSetId: TRAFFIC_VALUE_LOSS_RULE_SET_ID,
    ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION,
    effectiveFrom: TRAFFIC_VALUE_LOSS_EFFECTIVE_FROM,
    calculationMethod: TRAFFIC_VALUE_LOSS_CALCULATION_METHOD,
    roundingRule: TRAFFIC_VALUE_LOSS_ROUNDING_RULE,
    ruleSources: TRAFFIC_VALUE_LOSS_RULE_SOURCES,
    eligibilityStatus,
    grossValueLossMinor,
    faultAdjustedValueLossMinor,
    qualifyingPreComparableCount,
    qualifyingPostComparableCount,
    uncertainties,
    reasoning,
    humanApprovalRequired: true,
    canSubmitForApproval: uncertainties.length === 0 && grossValueLossMinor !== null && faultAdjustedValueLossMinor !== null,
  }
}
