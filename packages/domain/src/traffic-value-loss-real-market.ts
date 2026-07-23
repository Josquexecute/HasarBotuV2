import type { LocalDate } from './temporal.js'
import {
  VALUE_LOSS_EFFECTIVE_DATE,
  VALUE_LOSS_SNAPSHOT_IDENTITY,
  VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
  type ValueLossPartRule,
  type ValueLossRuleSnapshot,
  type ValueLossVehicleGroupCode,
} from './value-loss-rule-snapshot.js'
import {
  TRAFFIC_VALUE_LOSS_RULE_SET_ID,
  TRAFFIC_VALUE_LOSS_RULE_VERSION,
  type TrafficValueLossComparable,
  type TrafficValueLossEvidenceFact,
  type TrafficValueLossRuleSource,
} from './traffic-value-loss.js'

export const REAL_MARKET_VALUE_LOSS_RULE_SET_ID = 'real-market-analysis' as const
export const REAL_MARKET_VALUE_LOSS_RULE_VERSION = VALUE_LOSS_SNAPSHOT_IDENTITY
export const REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM = VALUE_LOSS_EFFECTIVE_DATE as LocalDate
export const REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256 =
  'e4fc8087ddbc1ff92e3255546e053c6956e20bd1dca269533113b727f728b940' as const
export const REAL_MARKET_VALUE_LOSS_CALCULATION_METHOD = 'real_market_analysis' as const
export const REAL_MARKET_VALUE_LOSS_ROUNDING_RULE = 'ceil_500_try' as const
export const REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR = 50_000

export const REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES = [
  'OTOMOBİL',
  'TAKSİ',
  'MİNİBÜS',
  'OTOBÜS',
  'KAMYONET',
  'KAMYON',
  'ÇEKİCİ',
  'İŞ MAKİNESİ',
  'TRAKTÖR',
  'TARIM MAKİNESİ',
  'ÖZEL AMAÇLI ARAÇ',
  'RÖMORK',
  'MOTORSİKLET',
  'TANKER',
] as const
export type RealMarketValueLossVehicleType =
  (typeof REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES)[number]

export const REAL_MARKET_VALUE_LOSS_ELIGIBILITY = [
  'eligible',
  'blocked',
  'control_required',
] as const
export type RealMarketValueLossEligibility =
  (typeof REAL_MARKET_VALUE_LOSS_ELIGIBILITY)[number]

export const REAL_MARKET_VALUE_LOSS_REASON_CODES = [
  'WRONG_CASE_TYPE',
  'LOSS_DATE_MISSING',
  'MODEL_YEAR_MISSING',
  'MODEL_YEAR_AFTER_ACCIDENT',
  'VEHICLE_TYPE_MISSING',
  'VEHICLE_GROUP_MISMATCH',
  'USAGE_VALUE_MISSING',
  'USAGE_METRIC_MISMATCH',
  'MARKET_VALUE_INVALID',
  'DAMAGE_AMOUNT_INVALID',
  'PARTS_MISSING',
  'PART_RULE_INVALID',
  'PART_OPERATION_UNSUPPORTED',
  'PART_OPERATION_CONFLICT',
  'REPAIR_PART_PRICE_INVALID',
  'REPAIR_LABOR_MISSING',
  'RESULT_OUT_OF_SAFE_RANGE',
  'REQUIRED_EVIDENCE_MISSING',
  'SOURCE_CONFLICT',
  'INSUFFICIENT_COMPARABLES',
  'FOREIGN_MARKET_EVIDENCE_MISSING',
  'ANTIQUE_OR_COLLECTOR',
  'PRIOR_HEAVY_DAMAGE',
  'CURRENT_HEAVY_OR_TOTAL_DAMAGE',
] as const
export type RealMarketValueLossReasonCode =
  (typeof REAL_MARKET_VALUE_LOSS_REASON_CODES)[number]

export const REAL_MARKET_VALUE_LOSS_PART_OPERATIONS = [
  'replacement',
  'repair',
  'paint',
] as const
export type RealMarketValueLossPartOperation =
  (typeof REAL_MARKET_VALUE_LOSS_PART_OPERATIONS)[number]

export interface RealMarketValueLossRuleOverride {
  readonly ruleIdentity: typeof REAL_MARKET_VALUE_LOSS_RULE_VERSION
    | `${typeof TRAFFIC_VALUE_LOSS_RULE_SET_ID}/${typeof TRAFFIC_VALUE_LOSS_RULE_VERSION}`
  readonly reason: string
}

export type TrafficValueLossRuleSelection =
  | {
      readonly status: 'selected'
      readonly kind: 'legacy'
      readonly ruleSetId: typeof TRAFFIC_VALUE_LOSS_RULE_SET_ID
      readonly ruleVersion: typeof TRAFFIC_VALUE_LOSS_RULE_VERSION
      readonly effectiveFrom: LocalDate
      readonly overridden: boolean
      readonly overrideReason: string | null
    }
  | {
      readonly status: 'selected'
      readonly kind: 'real_market'
      readonly ruleSetId: typeof REAL_MARKET_VALUE_LOSS_RULE_SET_ID
      readonly ruleVersion: typeof REAL_MARKET_VALUE_LOSS_RULE_VERSION
      readonly effectiveFrom: LocalDate
      readonly overridden: boolean
      readonly overrideReason: string | null
    }
  | {
      readonly status: 'control_required'
      readonly reasonCode: 'LOSS_DATE_MISSING'
    }

const LEGACY_RULE_IDENTITY =
  `${TRAFFIC_VALUE_LOSS_RULE_SET_ID}/${TRAFFIC_VALUE_LOSS_RULE_VERSION}` as const

export function selectTrafficValueLossRule(
  accidentDate: LocalDate | null,
  override: RealMarketValueLossRuleOverride | null = null,
): TrafficValueLossRuleSelection {
  if (override !== null) {
    const reason = override.reason.trim()
    if (reason.length === 0 || reason.length > 500) {
      throw new Error('REAL_MARKET_RULE_OVERRIDE_REASON_INVALID')
    }
    if (override.ruleIdentity === REAL_MARKET_VALUE_LOSS_RULE_VERSION) {
      return {
        status: 'selected',
        kind: 'real_market',
        ruleSetId: REAL_MARKET_VALUE_LOSS_RULE_SET_ID,
        ruleVersion: REAL_MARKET_VALUE_LOSS_RULE_VERSION,
        effectiveFrom: REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM,
        overridden: true,
        overrideReason: reason,
      }
    }
    if (override.ruleIdentity === LEGACY_RULE_IDENTITY) {
      return {
        status: 'selected',
        kind: 'legacy',
        ruleSetId: TRAFFIC_VALUE_LOSS_RULE_SET_ID,
        ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION,
        effectiveFrom: REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM,
        overridden: true,
        overrideReason: reason,
      }
    }
    throw new Error('REAL_MARKET_RULE_OVERRIDE_IDENTITY_INVALID')
  }
  if (accidentDate === null) {
    return { status: 'control_required', reasonCode: 'LOSS_DATE_MISSING' }
  }
  if (accidentDate < REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM) {
    return {
      status: 'selected',
      kind: 'legacy',
      ruleSetId: TRAFFIC_VALUE_LOSS_RULE_SET_ID,
      ruleVersion: TRAFFIC_VALUE_LOSS_RULE_VERSION,
      effectiveFrom: REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM,
      overridden: false,
      overrideReason: null,
    }
  }
  return {
    status: 'selected',
    kind: 'real_market',
    ruleSetId: REAL_MARKET_VALUE_LOSS_RULE_SET_ID,
    ruleVersion: REAL_MARKET_VALUE_LOSS_RULE_VERSION,
    effectiveFrom: REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM,
    overridden: false,
    overrideReason: null,
  }
}

export type RealMarketValueLossUsageMetric = 'mileage' | 'working_hours'
export type RealMarketValueLossPaintMode = 'full' | 'local'
export type RealMarketValueLossRepairClass = 'light' | 'medium' | 'heavy'
export type RealMarketValueLossPartTreatment =
  | 'standard'
  | 'accessory'
  | 'paintless_repair'
  | 'plastic_or_unpainted'
  | 'superstructure'
export type RealMarketValueLossPriorPartState =
  | 'none'
  | 'previously_damaged'
  | 'previously_repaired_detachable'
  | 'previously_repaired_welded'

export interface RealMarketValueLossPartInput {
  readonly stableRuleId: string
  readonly operation: RealMarketValueLossPartOperation
  readonly paintMode: RealMarketValueLossPaintMode | null
  readonly newPartPriceMinor: number | null
  readonly repairLaborMinor: number | null
  readonly partPriceAvailability: 'available' | 'unavailable'
  readonly priorPartState: RealMarketValueLossPriorPartState
  readonly treatment: RealMarketValueLossPartTreatment
}

export interface RealMarketValueLossEligibilityFacts {
  readonly antiqueOrCollector: boolean | null
  readonly priorHeavyDamage: boolean | null
  readonly currentHeavyOrTotalDamage: boolean | null
  readonly foreignPlate: boolean
  readonly foreignMarketEvidenceVerified: boolean
}

export interface RealMarketValueLossInput {
  readonly caseType: 'traffic' | 'casco'
  readonly accidentDate: LocalDate | null
  readonly evaluatedOn: LocalDate
  readonly vehicleType: RealMarketValueLossVehicleType | null
  readonly vehicleGroupCode: ValueLossVehicleGroupCode | null
  readonly modelYear: number | null
  readonly usageMetric: RealMarketValueLossUsageMetric | null
  readonly usageValue: number | null
  readonly commercialOrRental: boolean
  readonly previousDamageCount: number | null
  readonly marketValueMinor: number | null
  readonly damageAmountMinor: number | null
  readonly parts: readonly RealMarketValueLossPartInput[]
  readonly eligibilityFacts: RealMarketValueLossEligibilityFacts
  readonly comparables: readonly TrafficValueLossComparable[]
  readonly evidence: readonly TrafficValueLossEvidenceFact[]
}

export interface ExactRationalValue {
  readonly numerator: string
  readonly denominator: string
  readonly decimal: string
}

export interface RealMarketValueLossPartBreakdown {
  readonly stableRuleId: string
  readonly sourceTable: string
  readonly sourceRow: number
  readonly sourceLabel: string
  readonly operation: RealMarketValueLossPartOperation
  readonly repairClass: RealMarketValueLossRepairClass | null
  readonly coefficient: ExactRationalValue
  readonly included: boolean
  readonly exclusionReason: string | null
}

export interface RealMarketValueLossReason {
  readonly code: RealMarketValueLossReasonCode
  readonly field: string
  readonly message: string
  readonly kind: 'blocked' | 'control_required'
}

export interface RealMarketValueLossSource {
  readonly code: 'PACKAGE66-NORMALIZED-SNAPSHOT'
  readonly title: '01.07.2026 Yeni Dönem Değer Kaybı Normalize Kural Snapshotı'
  readonly sourceType: 'normalized_rule_snapshot'
  readonly effectiveFrom: typeof VALUE_LOSS_EFFECTIVE_DATE
  readonly locator: typeof VALUE_LOSS_SNAPSHOT_IDENTITY
  readonly sourceWorkbookSha256: typeof VALUE_LOSS_SOURCE_WORKBOOK_SHA256
  readonly normalizedSnapshotSha256: typeof REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256
}

export interface RealMarketValueLossEvaluation {
  readonly ruleSetId: typeof REAL_MARKET_VALUE_LOSS_RULE_SET_ID
  readonly ruleVersion: typeof REAL_MARKET_VALUE_LOSS_RULE_VERSION
  readonly ruleIdentity: typeof REAL_MARKET_VALUE_LOSS_RULE_VERSION
  readonly effectiveFrom: LocalDate
  readonly sourceWorkbookSha256: typeof VALUE_LOSS_SOURCE_WORKBOOK_SHA256
  readonly normalizedSnapshotSha256: typeof REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256
  readonly calculationMethod: typeof REAL_MARKET_VALUE_LOSS_CALCULATION_METHOD
  readonly roundingRule: typeof REAL_MARKET_VALUE_LOSS_ROUNDING_RULE
  readonly ruleSources: readonly (TrafficValueLossRuleSource | RealMarketValueLossSource)[]
  readonly eligibility: RealMarketValueLossEligibility
  readonly reasonCodes: readonly RealMarketValueLossReasonCode[]
  readonly reasons: readonly RealMarketValueLossReason[]
  readonly eligibilityStatus: 'calculable' | 'not_applicable' | 'control_required'
  readonly ageCoefficient: ExactRationalValue | null
  readonly usageCoefficient: ExactRationalValue | null
  readonly generalModifiers: {
    readonly commercialOrRental: ExactRationalValue
    readonly previousDamage: ExactRationalValue
    readonly lowerBandProximity: ExactRationalValue
    readonly multiplier: ExactRationalValue
  }
  readonly partBreakdown: readonly RealMarketValueLossPartBreakdown[]
  readonly partCoefficientPercentagePoints: ExactRationalValue | null
  readonly damageAmountContribution: ExactRationalValue | null
  readonly damageCoefficient: ExactRationalValue | null
  readonly vehicleMultiplier: ExactRationalValue | null
  readonly rawResultMinor: ExactRationalValue | null
  readonly capMinor: ExactRationalValue | null
  readonly cappedResultMinor: ExactRationalValue | null
  readonly capApplied: boolean
  readonly roundingUnitMinor: typeof REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR
  readonly roundingResultMinor: number | null
  readonly finalResultMinor: number | null
  /** Paket 32-40 uyumluluk alanları; yeni motorda onaylanabilir taslak nihai tutarı taşır. */
  readonly grossValueLossMinor: number | null
  readonly faultAdjustedValueLossMinor: number | null
  readonly qualifyingPreComparableCount: number
  readonly qualifyingPostComparableCount: number
  readonly uncertainties: readonly {
    readonly code: RealMarketValueLossReasonCode
    readonly field: string
    readonly reason: string
    readonly blocking: true
    readonly requiresHumanReview: true
  }[]
  readonly reasoning: readonly string[]
  readonly humanApprovalRequired: true
  readonly canSubmitForApproval: boolean
}

interface Rational {
  readonly numerator: bigint
  readonly denominator: bigint
}

const ZERO: Rational = { numerator: 0n, denominator: 1n }
const ONE: Rational = { numerator: 1n, denominator: 1n }

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) {
    const next = a % b
    a = b
    b = next
  }
  return a === 0n ? 1n : a
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('REAL_MARKET_RATIONAL_DIVISION_BY_ZERO')
  const sign = denominator < 0n ? -1n : 1n
  const divisor = gcd(numerator, denominator)
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  }
}

function decimal(value: string): Rational {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`REAL_MARKET_DECIMAL_INVALID:${value}`)
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  const numerator = (BigInt(whole) * denominator) + BigInt(fraction || '0')
  return rational(negative ? -numerator : numerator, denominator)
}

function add(left: Rational, right: Rational): Rational {
  return rational(
    (left.numerator * right.denominator) + (right.numerator * left.denominator),
    left.denominator * right.denominator,
  )
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator)
}

function divide(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator)
}

function compare(left: Rational, right: Rational): number {
  const difference = (left.numerator * right.denominator) - (right.numerator * left.denominator)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

function rationalDecimal(value: Rational, precision = 8): string {
  const sign = value.numerator < 0n ? '-' : ''
  const numerator = value.numerator < 0n ? -value.numerator : value.numerator
  const whole = numerator / value.denominator
  let remainder = numerator % value.denominator
  if (remainder === 0n) return `${sign}${whole}`
  let fraction = ''
  for (let index = 0; index < precision && remainder !== 0n; index += 1) {
    remainder *= 10n
    fraction += String(remainder / value.denominator)
    remainder %= value.denominator
  }
  return `${sign}${whole}.${fraction.replace(/0+$/u, '')}`
}

function exact(value: Rational): ExactRationalValue {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    decimal: rationalDecimal(value),
  }
}

function safeMinor(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0
}

function safeNonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0
}

function reason(
  code: RealMarketValueLossReasonCode,
  field: string,
  message: string,
  kind: RealMarketValueLossReason['kind'] = 'control_required',
): RealMarketValueLossReason {
  return { code, field, message, kind }
}

function hasVerifiedEvidence(input: RealMarketValueLossInput, fields: readonly string[]): boolean {
  return fields.every((field) => input.evidence.some((item) =>
    item.verificationStatus === 'verified'
    && item.conflict === false
    && item.supports.includes(field as never),
  ))
}

function qualifyingComparables(input: RealMarketValueLossInput): readonly TrafficValueLossComparable[] {
  const evaluated = Date.parse(`${input.evaluatedOn}T00:00:00Z`)
  const mileage = input.usageMetric === 'mileage' ? input.usageValue : null
  return input.comparables.filter((item) => {
    if (item.side !== 'pre_accident' || item.excluded || item.mileage === null || mileage === null) return false
    const linkedEvidence = input.evidence.find((evidence) => evidence.evidenceKey === item.evidenceKey)
    if (linkedEvidence?.sourceType !== 'market_comparable'
      || linkedEvidence.verificationStatus !== 'verified'
      || linkedEvidence.conflict
      || !linkedEvidence.supports.includes('pre_accident_market_value')) return false
    const observed = Date.parse(`${item.observedAt}T00:00:00Z`)
    const ageDays = Math.floor((evaluated - observed) / 86_400_000)
    if (ageDays < 0 || ageDays > 30) return false
    const tolerance = Math.max(1, Math.floor(mileage * 0.1))
    return Math.abs(item.mileage - mileage) <= tolerance
  })
}

function vehicleGroup(
  snapshot: ValueLossRuleSnapshot,
  vehicleType: RealMarketValueLossVehicleType,
): ValueLossVehicleGroupCode | null {
  return snapshot.vehicleMappings.find((mapping) => mapping.vehicleType === vehicleType)
    ?.vehicleGroupCode ?? null
}

function findPartRule(
  snapshot: ValueLossRuleSnapshot,
  stableRuleId: string,
  groupCode: ValueLossVehicleGroupCode,
): ValueLossPartRule | null {
  return snapshot.partRules.find((rule) =>
    rule.stableId === stableRuleId && rule.vehicleGroupCode === groupCode,
  ) ?? null
}

function repairClass(input: RealMarketValueLossPartInput): RealMarketValueLossRepairClass | null {
  if (input.partPriceAvailability === 'unavailable') return 'heavy'
  if (!safeMinor(input.newPartPriceMinor) || input.newPartPriceMinor === 0) return null
  if (!safeMinor(input.repairLaborMinor)) return null
  const labor = BigInt(input.repairLaborMinor)
  const part = BigInt(input.newPartPriceMinor)
  if ((labor * 100n) < (part * 15n)) return 'light'
  if ((labor * 100n) < (part * 30n)) return 'medium'
  return 'heavy'
}

function selectedPartCoefficient(
  rule: ValueLossPartRule,
  input: RealMarketValueLossPartInput,
  classification: RealMarketValueLossRepairClass | null,
): Rational | null {
  if (input.operation === 'replacement') {
    return rule.coefficients.replacement === null ? null : decimal(rule.coefficients.replacement)
  }
  if (input.operation === 'repair') {
    if (classification === null || rule.coefficients.repair === null) return null
    return decimal(rule.coefficients.repair[classification])
  }
  if (input.paintMode === null || rule.coefficients.paint === null) return null
  return decimal(rule.coefficients.paint[input.paintMode])
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function partInputKey(input: RealMarketValueLossPartInput): string {
  return [
    input.stableRuleId,
    input.operation,
    input.paintMode ?? '',
    input.newPartPriceMinor ?? '',
    input.repairLaborMinor ?? '',
    input.partPriceAvailability,
    input.priorPartState,
    input.treatment,
  ].join('\u0000')
}

function source(): RealMarketValueLossSource {
  return {
    code: 'PACKAGE66-NORMALIZED-SNAPSHOT',
    title: '01.07.2026 Yeni Dönem Değer Kaybı Normalize Kural Snapshotı',
    sourceType: 'normalized_rule_snapshot',
    effectiveFrom: VALUE_LOSS_EFFECTIVE_DATE,
    locator: VALUE_LOSS_SNAPSHOT_IDENTITY,
    sourceWorkbookSha256: VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
    normalizedSnapshotSha256: REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256,
  }
}

function generalModifier(snapshot: ValueLossRuleSnapshot, code: 'G1' | 'G2' | 'G3'): Rational {
  const modifier = snapshot.generalModifiers.find((item) => item.code === code)
  if (modifier === undefined) throw new Error(`REAL_MARKET_GENERAL_MODIFIER_MISSING:${code}`)
  return decimal(modifier.coefficient)
}

export function listRealMarketPartRules(
  snapshot: ValueLossRuleSnapshot,
  groupCode: ValueLossVehicleGroupCode,
): readonly ValueLossPartRule[] {
  return snapshot.partRules.filter((rule) => rule.vehicleGroupCode === groupCode)
}

export function evaluateRealMarketValueLoss(
  snapshot: ValueLossRuleSnapshot,
  input: RealMarketValueLossInput,
): RealMarketValueLossEvaluation {
  if (snapshot.identity !== VALUE_LOSS_SNAPSHOT_IDENTITY
    || snapshot.source.workbookSha256 !== VALUE_LOSS_SOURCE_WORKBOOK_SHA256) {
    throw new Error('REAL_MARKET_RULE_SNAPSHOT_IDENTITY_INVALID')
  }
  const reasons: RealMarketValueLossReason[] = []
  const orderedParts = [...input.parts]
    .sort((left, right) => compareText(partInputKey(left), partInputKey(right)))
  if (input.caseType !== 'traffic') {
    reasons.push(reason('WRONG_CASE_TYPE', 'caseType', 'Bu hesaplama yalnız Trafik dosyası içindir.', 'blocked'))
  }
  if (input.accidentDate === null) {
    reasons.push(reason('LOSS_DATE_MISSING', 'accidentDate', 'Kaza tarihi olmadan kural sürümü ve araç yaşı belirlenemez.'))
  }

  const accidentYear = input.accidentDate === null ? null : Number(input.accidentDate.slice(0, 4))
  if (input.modelYear === null) {
    reasons.push(reason('MODEL_YEAR_MISSING', 'modelYear', 'Model yılı zorunludur.'))
  } else if (accidentYear !== null && input.modelYear > accidentYear) {
    reasons.push(reason('MODEL_YEAR_AFTER_ACCIDENT', 'modelYear', 'Model yılı kaza yılından büyük olamaz.', 'blocked'))
  }
  if (input.vehicleType === null) {
    reasons.push(reason('VEHICLE_TYPE_MISSING', 'vehicleType', 'Araç türü seçilmelidir.'))
  }
  const mappedGroup = input.vehicleType === null ? null : vehicleGroup(snapshot, input.vehicleType)
  if (mappedGroup === null || input.vehicleGroupCode === null || mappedGroup !== input.vehicleGroupCode) {
    reasons.push(reason('VEHICLE_GROUP_MISMATCH', 'vehicleGroupCode', 'Araç türü ile kural grubu eşleşmiyor.'))
  }
  if (!safeNonNegativeInteger(input.usageValue)) {
    reasons.push(reason('USAGE_VALUE_MISSING', 'usageValue', 'Kilometre veya çalışma saati zorunludur.'))
  }
  if (input.vehicleGroupCode !== null) {
    const expectedMetric = input.vehicleGroupCode === 'D' ? 'working_hours' : 'mileage'
    if (input.usageMetric !== expectedMetric) {
      reasons.push(reason('USAGE_METRIC_MISMATCH', 'usageMetric', `Bu araç grubu için ${expectedMetric} kullanılmalıdır.`))
    }
  }
  if (!safeMinor(input.marketValueMinor) || input.marketValueMinor === 0) {
    reasons.push(reason('MARKET_VALUE_INVALID', 'marketValueMinor', 'Onaylı rayiç değer pozitif minor-unit olmalıdır.'))
  }
  if (!safeMinor(input.damageAmountMinor)) {
    reasons.push(reason('DAMAGE_AMOUNT_INVALID', 'damageAmountMinor', 'Hasar tutarı negatif olmayan minor-unit olmalıdır.'))
  }
  if (input.parts.length === 0) {
    reasons.push(reason('PARTS_MISSING', 'parts', 'En az bir desteklenen parça işlemi gereklidir.'))
  }
  if (!safeNonNegativeInteger(input.previousDamageCount)) {
    reasons.push(reason('REQUIRED_EVIDENCE_MISSING', 'previousDamageCount', 'SBM geçmiş hasar sayısı ve kanıtı gereklidir.'))
  }
  if (input.evidence.some((item) => item.conflict)) {
    reasons.push(reason('SOURCE_CONFLICT', 'evidence', 'Kaynaklar arasındaki çelişki çözülmelidir.'))
  }
  const requiredEvidence = [
    'vehicle_identity',
    'mileage',
    'usage_type',
    'damage_parts',
    'prior_damage',
    'pre_accident_market_value',
    'heavy_damage_status',
  ] as const
  if (!hasVerifiedEvidence(input, requiredEvidence)) {
    reasons.push(reason('REQUIRED_EVIDENCE_MISSING', 'evidence', 'Araç, kullanım, rayiç, hasar ve geçmiş hasar kanıtları eksiksiz doğrulanmalıdır.'))
  }
  const qualifying = qualifyingComparables(input)
  if (qualifying.length < 3) {
    reasons.push(reason('INSUFFICIENT_COMPARABLES', 'comparables', 'Son 30 gün ve ±%10 kullanım aralığında en az üç doğrulanmış emsal gerekir.'))
  }
  if (input.eligibilityFacts.foreignPlate && !input.eligibilityFacts.foreignMarketEvidenceVerified) {
    reasons.push(reason('FOREIGN_MARKET_EVIDENCE_MISSING', 'eligibilityFacts.foreignMarketEvidenceVerified', 'Yabancı plakalı araç için kendi ülkesindeki rayiç kanıtı gereklidir.'))
  }
  if (input.eligibilityFacts.antiqueOrCollector === true) {
    reasons.push(reason('ANTIQUE_OR_COLLECTOR', 'eligibilityFacts.antiqueOrCollector', 'Antika veya koleksiyon araç referans modülle hesaplanamaz.', 'blocked'))
  } else if (input.eligibilityFacts.antiqueOrCollector === null) {
    reasons.push(reason('REQUIRED_EVIDENCE_MISSING', 'eligibilityFacts.antiqueOrCollector', 'Antika/koleksiyon durumu doğrulanmalıdır.'))
  }
  if (input.eligibilityFacts.priorHeavyDamage === true) {
    reasons.push(reason('PRIOR_HEAVY_DAMAGE', 'eligibilityFacts.priorHeavyDamage', 'Daha önce ağır hasarlı araç hesaplanamaz.', 'blocked'))
  } else if (input.eligibilityFacts.priorHeavyDamage === null) {
    reasons.push(reason('REQUIRED_EVIDENCE_MISSING', 'eligibilityFacts.priorHeavyDamage', 'Önceki ağır hasar durumu doğrulanmalıdır.'))
  }
  if (input.eligibilityFacts.currentHeavyOrTotalDamage === true) {
    reasons.push(reason('CURRENT_HEAVY_OR_TOTAL_DAMAGE', 'eligibilityFacts.currentHeavyOrTotalDamage', 'Mevcut kazada ağır/tam hasarlı araç hesaplanamaz.', 'blocked'))
  } else if (input.eligibilityFacts.currentHeavyOrTotalDamage === null) {
    reasons.push(reason('REQUIRED_EVIDENCE_MISSING', 'eligibilityFacts.currentHeavyOrTotalDamage', 'Mevcut ağır/tam hasar durumu doğrulanmalıdır.'))
  }

  const partBreakdown: RealMarketValueLossPartBreakdown[] = []
  if (input.vehicleGroupCode !== null) {
    const operationsByRule = new Map<string, Set<RealMarketValueLossPartOperation>>()
    const uniqueOperations = new Set<string>()
    for (const item of orderedParts) {
      const operationKey = `${item.stableRuleId}:${item.operation}`
      if (uniqueOperations.has(operationKey)) {
        reasons.push(reason('PART_OPERATION_CONFLICT', 'parts', `${item.stableRuleId} için aynı işlem birden fazla kez seçilemez.`))
      }
      uniqueOperations.add(operationKey)
      const operations = operationsByRule.get(item.stableRuleId) ?? new Set()
      operations.add(item.operation)
      operationsByRule.set(item.stableRuleId, operations)
    }
    for (const [stableRuleId, operations] of operationsByRule) {
      if (operations.has('replacement') && operations.has('repair')) {
        reasons.push(reason('PART_OPERATION_CONFLICT', 'parts', `${stableRuleId} için değişim ve onarım birlikte seçilemez.`))
      }
    }
    for (const item of orderedParts) {
      const rule = findPartRule(snapshot, item.stableRuleId, input.vehicleGroupCode)
      if (rule === null) {
        reasons.push(reason('PART_RULE_INVALID', 'parts.stableRuleId', 'Parça kuralı seçilen araç grubuna ait değildir.'))
        continue
      }
      if (!rule.operationCapabilities.includes(item.operation)) {
        reasons.push(reason('PART_OPERATION_UNSUPPORTED', 'parts.operation', `${rule.sourceLabel} için işlem desteklenmiyor.`))
        continue
      }
      const classification = item.operation === 'repair' ? repairClass(item) : null
      if (item.operation === 'repair' && item.partPriceAvailability === 'available'
        && (!safeMinor(item.newPartPriceMinor) || item.newPartPriceMinor === 0)) {
        reasons.push(reason('REPAIR_PART_PRICE_INVALID', 'parts.newPartPriceMinor', `${rule.sourceLabel} için parça bedeli pozitif olmalıdır.`))
      }
      if (item.operation === 'repair' && item.partPriceAvailability === 'available'
        && !safeMinor(item.repairLaborMinor)) {
        reasons.push(reason('REPAIR_LABOR_MISSING', 'parts.repairLaborMinor', `${rule.sourceLabel} için işçilik tutarı bilinmiyor.`))
      }
      if (item.operation === 'paint' && item.paintMode === null) {
        reasons.push(reason('PART_OPERATION_UNSUPPORTED', 'parts.paintMode', `${rule.sourceLabel} için boya türü seçilmelidir.`))
      }

      const specialExcluded = item.treatment !== 'standard'
      const priorExcluded = item.priorPartState === 'previously_damaged'
        || item.priorPartState === 'previously_repaired_detachable'
        || (item.priorPartState === 'previously_repaired_welded' && item.operation !== 'replacement')
      const coefficient = selectedPartCoefficient(rule, item, classification)
      if (coefficient === null && !specialExcluded && !priorExcluded) {
        reasons.push(reason('PART_OPERATION_UNSUPPORTED', 'parts.operation', `${rule.sourceLabel} için katsayı bulunmuyor.`))
      }
      const included = coefficient !== null && !specialExcluded && !priorExcluded
      partBreakdown.push({
        stableRuleId: rule.stableId,
        sourceTable: rule.sourceTable,
        sourceRow: rule.sourceRow,
        sourceLabel: rule.sourceLabel,
        operation: item.operation,
        repairClass: classification,
        coefficient: exact(included ? coefficient : ZERO),
        included,
        exclusionReason: specialExcluded
          ? item.treatment
          : priorExcluded
            ? item.priorPartState
            : null,
      })
    }
  }

  const age = accidentYear !== null && input.modelYear !== null && input.modelYear <= accidentYear
    ? snapshot.ageCoefficients.find((band) => {
        const vehicleAge = accidentYear - input.modelYear!
        return vehicleAge >= band.minAge && (band.maxAge === null || vehicleAge <= band.maxAge)
      }) ?? null
    : null
  const usageTable = input.vehicleGroupCode === null
    ? null
    : snapshot.usageCoefficientTables.find((table) =>
        table.vehicleGroupCode === input.vehicleGroupCode
        && table.tableId === input.usageMetric,
      ) ?? null
  const usageBand = usageTable !== null && safeNonNegativeInteger(input.usageValue)
    ? usageTable.bands.find((band) =>
        input.usageValue! >= band.min && (band.max === null || input.usageValue! <= band.max),
      ) ?? null
    : null

  const ageCoefficient = age === null ? null : decimal(age.coefficient)
  const usageCoefficient = usageBand === null ? null : decimal(usageBand.coefficient)
  const commercialModifier = input.commercialOrRental ? generalModifier(snapshot, 'G1') : ZERO
  const previousModifier = safeNonNegativeInteger(input.previousDamageCount)
    ? multiply(generalModifier(snapshot, 'G2'), rational(BigInt(Math.min(input.previousDamageCount, 5))))
    : ZERO
  const lowerBandModifier = usageBand !== null && safeNonNegativeInteger(input.usageValue)
    && usageBand.min > 0 && input.usageValue - usageBand.min <= 1_000
    ? generalModifier(snapshot, 'G3')
    : ZERO
  const generalMultiplier = add(add(add(ONE, commercialModifier), previousModifier), lowerBandModifier)
  const partCoefficient = partBreakdown.reduce(
    (total, item) => item.included
      ? add(total, rational(BigInt(item.coefficient.numerator), BigInt(item.coefficient.denominator)))
      : total,
    ZERO,
  )
  const damageContribution = safeMinor(input.damageAmountMinor)
    && safeMinor(input.marketValueMinor) && input.marketValueMinor > 0
    ? multiply(divide(rational(BigInt(input.damageAmountMinor)), rational(BigInt(input.marketValueMinor))), rational(10n))
    : null
  const damageCoefficient = damageContribution === null
    ? null
    : divide(add(partCoefficient, damageContribution), rational(100n))
  const multiplier = input.vehicleType === 'MOTORSİKLET'
    ? decimal('2.5')
    : input.vehicleType === 'OTOBÜS'
      ? decimal('0.5')
      : input.vehicleType === null
        ? null
        : ONE

  let raw: Rational | null = null
  let cap: Rational | null = null
  let capped: Rational | null = null
  let capApplied = false
  let finalResultMinor: number | null = null
  if (safeMinor(input.marketValueMinor) && input.marketValueMinor > 0
    && ageCoefficient !== null && usageCoefficient !== null
    && damageCoefficient !== null && multiplier !== null) {
    raw = ([
      rational(BigInt(input.marketValueMinor)),
      ageCoefficient,
      usageCoefficient,
      generalMultiplier,
      damageCoefficient,
      multiplier,
    ] as readonly Rational[]).reduce<Rational>(
      (total, coefficient) => multiply(total, coefficient),
      ONE,
    )
    cap = multiply(rational(BigInt(input.marketValueMinor)), decimal('0.30'))
    capApplied = compare(raw, cap) > 0
    capped = capApplied ? cap : raw
    if (capped.numerator === 0n) {
      finalResultMinor = 0
    } else {
      const unit = BigInt(REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR)
      const roundedUnits = (
        capped.numerator + (capped.denominator * unit) - 1n
      ) / (capped.denominator * unit)
      const rounded = roundedUnits * unit
      if (rounded <= BigInt(Number.MAX_SAFE_INTEGER)) {
        finalResultMinor = Number(rounded)
      } else {
        reasons.push(reason(
          'RESULT_OUT_OF_SAFE_RANGE',
          'finalResultMinor',
          'Nihai tutar güvenli minor-unit aralığını aşıyor.',
        ))
      }
    }
  }

  const eligibility: RealMarketValueLossEligibility = reasons.some((item) => item.kind === 'blocked')
    ? 'blocked'
    : reasons.length > 0
      ? 'control_required'
      : 'eligible'
  const compatibilityStatus = eligibility === 'eligible'
    ? 'calculable'
    : eligibility === 'blocked'
      ? 'not_applicable'
      : 'control_required'
  const canSubmitForApproval = eligibility === 'eligible' && finalResultMinor !== null
  const ruleSources: readonly (TrafficValueLossRuleSource | RealMarketValueLossSource)[] = [source()]

  return {
    ruleSetId: REAL_MARKET_VALUE_LOSS_RULE_SET_ID,
    ruleVersion: REAL_MARKET_VALUE_LOSS_RULE_VERSION,
    ruleIdentity: REAL_MARKET_VALUE_LOSS_RULE_VERSION,
    effectiveFrom: REAL_MARKET_VALUE_LOSS_EFFECTIVE_FROM,
    sourceWorkbookSha256: VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
    normalizedSnapshotSha256: REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256,
    calculationMethod: REAL_MARKET_VALUE_LOSS_CALCULATION_METHOD,
    roundingRule: REAL_MARKET_VALUE_LOSS_ROUNDING_RULE,
    ruleSources,
    eligibility,
    reasonCodes: reasons.map((item) => item.code),
    reasons,
    eligibilityStatus: compatibilityStatus,
    ageCoefficient: ageCoefficient === null ? null : exact(ageCoefficient),
    usageCoefficient: usageCoefficient === null ? null : exact(usageCoefficient),
    generalModifiers: {
      commercialOrRental: exact(commercialModifier),
      previousDamage: exact(previousModifier),
      lowerBandProximity: exact(lowerBandModifier),
      multiplier: exact(generalMultiplier),
    },
    partBreakdown,
    partCoefficientPercentagePoints: exact(partCoefficient),
    damageAmountContribution: damageContribution === null ? null : exact(damageContribution),
    damageCoefficient: damageCoefficient === null ? null : exact(damageCoefficient),
    vehicleMultiplier: multiplier === null ? null : exact(multiplier),
    rawResultMinor: raw === null ? null : exact(raw),
    capMinor: cap === null ? null : exact(cap),
    cappedResultMinor: capped === null ? null : exact(capped),
    capApplied,
    roundingUnitMinor: REAL_MARKET_VALUE_LOSS_ROUNDING_UNIT_MINOR,
    roundingResultMinor: finalResultMinor,
    finalResultMinor,
    grossValueLossMinor: finalResultMinor,
    faultAdjustedValueLossMinor: finalResultMinor,
    qualifyingPreComparableCount: qualifying.length,
    qualifyingPostComparableCount: 0,
    uncertainties: reasons.map((item) => ({
      code: item.code,
      field: item.field,
      reason: item.message,
      blocking: true,
      requiresHumanReview: true,
    })),
    reasoning: [
      '01.07.2026 normalize kural snapshotı workbook açılmadan immutable kaynak olarak kullanıldı.',
      'Para ve katsayı işlemleri BigInt tabanlı exact rational aritmetik ile yapıldı.',
      'Ara adımlarda yuvarlama yapılmadı; yalnız nihai tutara 500 TRY ceiling uygulandı.',
    ],
    humanApprovalRequired: true,
    canSubmitForApproval,
  }
}
