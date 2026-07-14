import type { ServiceType } from './service-agreement.js'

export const POLICY_ANALYSIS_STATUSES = [
  'draft',
  'extracted',
  'control_required',
  'conflict_detected',
  'awaiting_approval',
  'approved',
  'superseded',
  'rejected',
  'failed',
] as const
export type PolicyAnalysisStatus = (typeof POLICY_ANALYSIS_STATUSES)[number]

export const POLICY_SOURCE_TYPES = [
  'policy',
  'endorsement',
  'general_conditions',
  'special_conditions',
  'notice_form',
  'external_reference',
] as const
export type PolicySourceType = (typeof POLICY_SOURCE_TYPES)[number]

export const POLICY_COVERAGE_TYPES = [
  'collision', 'fire', 'theft', 'natural_disaster', 'flood', 'earthquake', 'terror',
  'glass', 'key_loss', 'roadside_assistance', 'replacement_vehicle', 'mini_repair',
  'mobile_repair', 'legal_protection', 'personal_accident', 'third_party_liability',
  'loss_of_use', 'wrong_fuel', 'animal_damage', 'electronic_mechanical_damage', 'other',
] as const
export type PolicyCoverageType = (typeof POLICY_COVERAGE_TYPES)[number]

export const POLICY_SCENARIO_TYPES = [
  'coverage',
  'deductible',
  'uncontracted_service',
  'authorized_service',
  'glass_service',
  'mini_repair',
  'mobile_repair',
  'replacement_vehicle',
  'roadside_assistance',
  'part_type',
  'betterment',
  'previous_total_loss',
] as const
export type PolicyScenarioType = (typeof POLICY_SCENARIO_TYPES)[number]

export const POLICY_SCENARIO_RESULTS = ['covered', 'excluded', 'conditional', 'control_required', 'unknown'] as const
export type PolicyScenarioResultCode = (typeof POLICY_SCENARIO_RESULTS)[number]

export const POLICY_CONFLICT_RESOLUTION_STATUSES = [
  'open', 'control_required', 'resolved_source_a', 'resolved_source_b', 'resolved_manual', 'not_applicable',
] as const
export type PolicyConflictResolutionStatus = (typeof POLICY_CONFLICT_RESOLUTION_STATUSES)[number]

export const POLICY_SCENARIO_RULE_VERSION = '2026.07.14.1' as const
export const MAX_POLICY_EXCERPT_LENGTH = 1_000

export interface PolicySourceReference {
  readonly id: string
  readonly documentId: string
  readonly documentVersionId: string
  readonly pageNumber: number
  readonly sectionHeading: string
  readonly clauseIdentifier: string
  readonly rawExcerpt: string
  readonly excerptHash: string
  readonly locator: string | null
  readonly sourceType: PolicySourceType
  readonly confidence: number
  readonly extractionLocator?: {
    readonly extractionId: string
    readonly pageId: string
    readonly segmentId: string | null
    readonly startOffset: number
    readonly endOffset: number
  } | null
}

export interface PolicyDeductible {
  readonly code: string
  readonly type: string
  readonly trigger: string
  readonly calculationType: 'fixed' | 'percentage' | 'share' | 'conditional' | 'unknown'
  readonly fixedAmount: number | null
  readonly percentage: number | null
  readonly minimumAmount: number | null
  readonly maximumAmount: number | null
  readonly insurerShare: number | null
  readonly insuredShare: number | null
  readonly affectedCoverage: PolicyCoverageType | null
  readonly affectedRepairMethod: string | null
  readonly affectedServiceType: ServiceType | null
  readonly affectedPartRule: string | null
  readonly exception: string | null
  readonly sourceReferences: readonly PolicySourceReference[]
  readonly confidence: number
  readonly approvalStatus: 'unreviewed' | 'approved' | 'rejected'
}

export interface PolicyScenarioRuleCondition {
  readonly field: 'damageCategory' | 'repairMethod' | 'requestedOperation' | 'serviceType' | 'insurerAgreementStatus' | 'documentState'
  readonly operator: 'equals' | 'not_equals' | 'in'
  readonly value: string | readonly string[]
}

export interface PolicyScenarioRule {
  readonly ruleId: string
  readonly ruleVersion: string
  readonly scenarioType: PolicyScenarioType
  readonly trigger: string
  readonly conditions: readonly PolicyScenarioRuleCondition[]
  readonly coverageOutcome: 'covered' | 'excluded' | 'conditional' | 'unknown'
  readonly coverageCode: string | null
  readonly deductibleCodes: readonly string[]
  readonly limit: string | null
  readonly exception: string | null
  readonly requiredDocuments: readonly string[]
  readonly serviceCondition: string | null
  readonly partCondition: string | null
  readonly action: string
  readonly sourceReferences: readonly PolicySourceReference[]
  readonly confidence: number
  readonly humanApprovalRequired: boolean
  readonly precedence: number
  readonly effectiveFrom: string | null
  readonly effectiveTo: string | null
}

export interface PolicyConflictFact {
  readonly id: string
  readonly affectedTopic: string
  readonly explanation: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly resolutionStatus: PolicyConflictResolutionStatus
  readonly sourceA: PolicySourceReference
  readonly sourceB: PolicySourceReference
}

export interface PolicyScenarioFacts {
  readonly caseType: 'traffic' | 'casco'
  readonly lossDate: string | null
  readonly notificationDate: string | null
  readonly insurerId: string | null
  readonly serviceCenterId: string | null
  readonly serviceType: ServiceType | null
  readonly insurerAgreementStatus: 'agreed' | 'not_agreed' | 'control_required' | null
  readonly damageCategory: string | null
  readonly repairMethod: string | null
  readonly requestedOperation: string
  readonly documentState: 'verified' | 'unverified' | 'missing'
  readonly policyAnalysisVersion: number
}

export interface PolicyOperationalRecommendation {
  readonly procurementStatus: 'continue' | 'pause' | 'control_required'
  readonly mobileRepairStatus: 'continue' | 'pause' | 'control_required'
  readonly caseOwnerNotificationRequired: boolean
  readonly serviceNotificationRequired: boolean
  readonly availableAlternatives: readonly string[]
  readonly sourceReferences: readonly PolicySourceReference[]
  readonly approvalRequired: boolean
}

export interface PolicyScenarioEvaluation {
  readonly result: PolicyScenarioResultCode
  readonly reasoning: readonly string[]
  readonly applicableCoverage: readonly string[]
  readonly deductibles: readonly PolicyDeductible[]
  readonly limit: string | null
  readonly insuredShare: number | null
  readonly insurerShare: number | null
  readonly serviceCondition: readonly string[]
  readonly partCondition: readonly string[]
  readonly requiredAction: readonly string[]
  readonly requiredDocuments: readonly string[]
  readonly sourceReferences: readonly PolicySourceReference[]
  readonly conflicts: readonly PolicyConflictFact[]
  readonly missingInformation: readonly string[]
  readonly confidence: number
  readonly humanApprovalRequired: boolean
  readonly policyAnalysisVersion: number
  readonly ruleVersion: string
  readonly operationalRecommendation: PolicyOperationalRecommendation
}

export type SourceReferenceValidationError =
  | 'invalid_identifier'
  | 'invalid_page'
  | 'missing_section'
  | 'missing_clause'
  | 'missing_excerpt'
  | 'excerpt_too_long'
  | 'invalid_excerpt_hash'
  | 'invalid_confidence'

/** Kaynak referansinin kanit icin gereken minimum, sirketten bagimsiz yapisini dogrular. */
export function validatePolicySourceReference(reference: PolicySourceReference): SourceReferenceValidationError | null {
  if ([reference.id, reference.documentId, reference.documentVersionId].some((value) => value.trim().length === 0)) return 'invalid_identifier'
  if (!Number.isSafeInteger(reference.pageNumber) || reference.pageNumber < 1) return 'invalid_page'
  if (reference.sectionHeading.trim().length === 0) return 'missing_section'
  if (reference.clauseIdentifier.trim().length === 0) return 'missing_clause'
  if (reference.rawExcerpt.trim().length === 0) return 'missing_excerpt'
  if (reference.rawExcerpt.length > MAX_POLICY_EXCERPT_LENGTH) return 'excerpt_too_long'
  if (!/^[a-f0-9]{64}$/.test(reference.excerptHash)) return 'invalid_excerpt_hash'
  if (!Number.isFinite(reference.confidence) || reference.confidence < 0 || reference.confidence > 1) return 'invalid_confidence'
  return null
}

export function canTransitionPolicyAnalysisStatus(from: PolicyAnalysisStatus, to: PolicyAnalysisStatus): boolean {
  if (from === to) return true
  if (from === 'approved') return to === 'superseded'
  if (from === 'superseded' || from === 'rejected' || from === 'failed') return false
  const allowed: Readonly<Record<Exclude<PolicyAnalysisStatus, 'approved' | 'superseded' | 'rejected' | 'failed'>, readonly PolicyAnalysisStatus[]>> = {
    draft: ['extracted', 'control_required', 'conflict_detected', 'awaiting_approval', 'rejected', 'failed'],
    extracted: ['control_required', 'conflict_detected', 'awaiting_approval', 'rejected', 'failed'],
    control_required: ['conflict_detected', 'awaiting_approval', 'rejected', 'failed'],
    conflict_detected: ['control_required', 'awaiting_approval', 'rejected', 'failed'],
    awaiting_approval: ['approved', 'control_required', 'conflict_detected', 'rejected', 'failed'],
  }
  return allowed[from].includes(to)
}

function factValue(facts: PolicyScenarioFacts, field: PolicyScenarioRuleCondition['field']): string | null {
  const value = facts[field]
  return value === null ? null : String(value)
}

export function matchesPolicyScenarioRule(rule: PolicyScenarioRule, facts: PolicyScenarioFacts): boolean {
  if (facts.caseType !== 'casco') return false
  if (rule.effectiveFrom !== null && facts.lossDate !== null && facts.lossDate < rule.effectiveFrom) return false
  if (rule.effectiveTo !== null && facts.lossDate !== null && facts.lossDate > rule.effectiveTo) return false
  return rule.conditions.every((condition) => {
    const actual = factValue(facts, condition.field)
    if (actual === null) return false
    const expected = Array.isArray(condition.value) ? condition.value : [condition.value]
    if (condition.operator === 'equals') return expected.length === 1 && actual === expected[0]
    if (condition.operator === 'not_equals') return expected.length === 1 && actual !== expected[0]
    return expected.includes(actual)
  })
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function safeMinimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values)
}

/** Eşleşen kuralları öncelik sırasına koyar ve en üst düzey çelişkiyi açıkça bildirir. */
export function resolvePolicyRulePrecedence(input: {
  readonly facts: PolicyScenarioFacts
  readonly scenarioType: PolicyScenarioType
  readonly rules: readonly PolicyScenarioRule[]
}): { readonly matching: readonly PolicyScenarioRule[]; readonly topRules: readonly PolicyScenarioRule[]; readonly hasConflict: boolean } {
  const matching = input.rules
    .filter((rule) => rule.scenarioType === input.scenarioType && matchesPolicyScenarioRule(rule, input.facts))
    .sort((left, right) => right.precedence - left.precedence || left.ruleId.localeCompare(right.ruleId))
  const topPrecedence = matching[0]?.precedence
  const topRules = topPrecedence === undefined ? [] : matching.filter((rule) => rule.precedence === topPrecedence)
  return { matching, topRules, hasConflict: new Set(topRules.map((rule) => rule.coverageOutcome)).size > 1 }
}

/** Birden fazla koşullu muafiyeti kod bazında kaybetmeden ve iki kez uygulamadan birleştirir. */
export function aggregatePolicyDeductibles(input: {
  readonly matchingRules: readonly PolicyScenarioRule[]
  readonly deductibles: readonly PolicyDeductible[]
}): readonly PolicyDeductible[] {
  const codes = new Set(input.matchingRules.flatMap((rule) => rule.deductibleCodes))
  return uniqueBy(input.deductibles.filter((item) => codes.has(item.code)), (item) => item.code)
    .sort((left, right) => left.code.localeCompare(right.code))
}

/** Saf, deterministik ve fail-closed Kasko senaryo degerlendirmesi. */
export function evaluatePolicyScenario(input: {
  readonly facts: PolicyScenarioFacts
  readonly scenarioType: PolicyScenarioType
  readonly analysisApproved: boolean
  readonly rules: readonly PolicyScenarioRule[]
  readonly deductibles: readonly PolicyDeductible[]
  readonly conflicts: readonly PolicyConflictFact[]
  readonly ruleVersion?: string
}): PolicyScenarioEvaluation {
  const openConflicts = input.conflicts
    .filter((conflict) => conflict.resolutionStatus === 'open' || conflict.resolutionStatus === 'control_required')
    .sort((left, right) => left.id.localeCompare(right.id))
  const precedence = resolvePolicyRulePrecedence({ facts: input.facts, scenarioType: input.scenarioType, rules: input.rules })
  const matching = precedence.matching
  const invalidEvidence = matching.some((rule) => rule.sourceReferences.length === 0 || rule.sourceReferences.some((reference) => validatePolicySourceReference(reference) !== null))
  const topRules = precedence.topRules
  const hasRuleConflict = precedence.hasConflict
  const missingInformation: string[] = []
  if (input.facts.caseType !== 'casco') missingInformation.push('Kasko olmayan vaka poliçe senaryosunda değerlendirilemez.')
  if (matching.length === 0) missingInformation.push('Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı.')
  if (invalidEvidence) missingInformation.push('Eşleşen kuralın kaynak referansı eksik veya geçersiz.')
  if (!input.analysisApproved) missingInformation.push('Poliçe analizi insan tarafından onaylanmadı.')
  if (input.facts.documentState !== 'verified') missingInformation.push('Kaynak poliçe documentVersion fiziksel olarak doğrulanmış değil.')

  let result: PolicyScenarioResultCode
  if (openConflicts.length > 0 || hasRuleConflict) result = 'control_required'
  else if (matching.length === 0 || invalidEvidence) result = 'unknown'
  else if (!input.analysisApproved || input.facts.documentState !== 'verified') result = 'control_required'
  else result = topRules[0]?.coverageOutcome ?? 'unknown'

  const deductibles = aggregatePolicyDeductibles({ matchingRules: matching, deductibles: input.deductibles })
  const sources = uniqueBy(
    [...matching.flatMap((rule) => rule.sourceReferences), ...deductibles.flatMap((item) => item.sourceReferences)],
    (source) => source.id,
  ).sort((left, right) => left.id.localeCompare(right.id))
  const humanApprovalRequired = !input.analysisApproved
    || matching.some((rule) => rule.humanApprovalRequired)
    || deductibles.some((item) => item.approvalStatus !== 'approved')
    || result === 'conditional'
    || result === 'control_required'
    || result === 'unknown'
  const hasDeductionRisk = deductibles.length > 0 || result === 'conditional' || result === 'excluded'
  const uncertain = result === 'control_required' || result === 'unknown' || openConflicts.length > 0 || hasRuleConflict
  const operationStatus = uncertain ? 'control_required' : hasDeductionRisk ? 'pause' : 'continue'

  return {
    result,
    reasoning: matching.map((rule) => rule.action),
    applicableCoverage: uniqueBy(matching.flatMap((rule) => rule.coverageCode === null ? [] : [rule.coverageCode]), (value) => value),
    deductibles,
    limit: matching.find((rule) => rule.limit !== null)?.limit ?? null,
    insuredShare: deductibles.find((item) => item.insuredShare !== null)?.insuredShare ?? null,
    insurerShare: deductibles.find((item) => item.insurerShare !== null)?.insurerShare ?? null,
    serviceCondition: uniqueBy(matching.flatMap((rule) => rule.serviceCondition === null ? [] : [rule.serviceCondition]), (value) => value),
    partCondition: uniqueBy(matching.flatMap((rule) => rule.partCondition === null ? [] : [rule.partCondition]), (value) => value),
    requiredAction: uniqueBy(matching.map((rule) => rule.action), (value) => value),
    requiredDocuments: uniqueBy(matching.flatMap((rule) => rule.requiredDocuments), (value) => value),
    sourceReferences: sources,
    conflicts: openConflicts,
    missingInformation,
    confidence: safeMinimum(matching.map((rule) => rule.confidence)),
    humanApprovalRequired,
    policyAnalysisVersion: input.facts.policyAnalysisVersion,
    ruleVersion: input.ruleVersion ?? POLICY_SCENARIO_RULE_VERSION,
    operationalRecommendation: {
      procurementStatus: operationStatus,
      mobileRepairStatus: operationStatus,
      caseOwnerNotificationRequired: operationStatus !== 'continue',
      serviceNotificationRequired: operationStatus === 'pause',
      availableAlternatives: hasDeductionRisk
        ? ['Poliçeye uygun servis veya onarım yöntemiyle yeniden değerlendir.', 'Kullanıcı onayıyla poliçe kaynaklı maliyet paylaşımını incele.']
        : [],
      sourceReferences: sources,
      approvalRequired: humanApprovalRequired,
    },
  }
}
