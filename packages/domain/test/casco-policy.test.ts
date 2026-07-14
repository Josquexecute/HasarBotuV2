import { describe, expect, it } from 'vitest'
import {
  canTransitionPolicyAnalysisStatus,
  aggregatePolicyDeductibles,
  evaluatePolicyScenario,
  matchesPolicyScenarioRule,
  resolvePolicyRulePrecedence,
  validatePolicySourceReference,
  type PolicyConflictFact,
  type PolicyDeductible,
  type PolicyScenarioFacts,
  type PolicyScenarioRule,
  type PolicySourceReference,
} from '../src/index.js'

const source = (id = 'src-1'): PolicySourceReference => ({
  id,
  documentId: 'doc-1',
  documentVersionId: 'docv-1',
  pageNumber: 7,
  sectionHeading: 'Özel Şartlar',
  clauseIdentifier: 'KLOZ-7.2',
  rawExcerpt: 'Anlaşmasız serviste onarım halinde yüzde on tenzil uygulanır.',
  excerptHash: 'a'.repeat(64),
  locator: 'p7:c120-184',
  sourceType: 'special_conditions',
  confidence: 0.96,
})

const facts = (overrides: Partial<PolicyScenarioFacts> = {}): PolicyScenarioFacts => ({
  caseType: 'casco',
  lossDate: '2026-07-01',
  notificationDate: '2026-07-02',
  insurerId: 'ins-1',
  serviceCenterId: 'service-1',
  serviceType: 'private',
  insurerAgreementStatus: 'not_agreed',
  damageCategory: 'collision',
  repairMethod: 'replacement',
  requestedOperation: 'procurement',
  documentState: 'verified',
  policyAnalysisVersion: 3,
  ...overrides,
})

const rule = (overrides: Partial<PolicyScenarioRule> = {}): PolicyScenarioRule => ({
  ruleId: 'rule-1',
  ruleVersion: 'policy-rule-1',
  scenarioType: 'coverage',
  trigger: 'collision',
  conditions: [{ field: 'damageCategory', operator: 'equals', value: 'collision' }],
  coverageOutcome: 'covered',
  coverageCode: 'collision',
  deductibleCodes: [],
  limit: null,
  exception: null,
  requiredDocuments: ['damage_photo'],
  serviceCondition: null,
  partCondition: null,
  action: 'Hasar teminat kapsamında değerlendirildi.',
  sourceReferences: [source()],
  confidence: 0.94,
  humanApprovalRequired: true,
  precedence: 100,
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  ...overrides,
})

const deductible = (overrides: Partial<PolicyDeductible> = {}): PolicyDeductible => ({
  code: 'uncontracted-service',
  type: 'uncontracted_service',
  trigger: 'insurer_agreement_missing',
  calculationType: 'percentage',
  fixedAmount: null,
  percentage: 10,
  minimumAmount: null,
  maximumAmount: null,
  insurerShare: 90,
  insuredShare: 10,
  affectedCoverage: 'collision',
  affectedRepairMethod: null,
  affectedServiceType: 'private',
  affectedPartRule: null,
  exception: 'Anlaşmalı servise geçilirse uygulanmaz.',
  sourceReferences: [source('src-deductible')],
  confidence: 0.95,
  approvalStatus: 'approved',
  ...overrides,
})

describe('Kasko poliçe analiz çekirdeği', () => {
  it('kaynak sayfa, bölüm, madde, excerpt, hash ve confidence zorunluluğunu doğrular', () => {
    expect(validatePolicySourceReference(source())).toBeNull()
    expect(validatePolicySourceReference({ ...source(), pageNumber: 0 })).toBe('invalid_page')
    expect(validatePolicySourceReference({ ...source(), clauseIdentifier: ' ' })).toBe('missing_clause')
    expect(validatePolicySourceReference({ ...source(), rawExcerpt: '' })).toBe('missing_excerpt')
    expect(validatePolicySourceReference({ ...source(), excerptHash: 'not-a-hash' })).toBe('invalid_excerpt_hash')
  })

  it('approved sürümü immutable tutar; yalnız superseded geçişine izin verir', () => {
    expect(canTransitionPolicyAnalysisStatus('awaiting_approval', 'approved')).toBe(true)
    expect(canTransitionPolicyAnalysisStatus('approved', 'draft')).toBe(false)
    expect(canTransitionPolicyAnalysisStatus('approved', 'superseded')).toBe(true)
    expect(canTransitionPolicyAnalysisStatus('superseded', 'approved')).toBe(false)
  })

  it('aynı girdiye aynı kaynak sırası ve aynı sonuçla deterministik cevap verir', () => {
    const input = { facts: facts(), scenarioType: 'coverage' as const, analysisApproved: true, rules: [rule()], deductibles: [], conflicts: [] }
    expect(evaluatePolicyScenario(input)).toEqual(evaluatePolicyScenario(input))
  })

  it('kaynak yoksa kesin karar vermez ve unknown üretir', () => {
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'coverage', analysisApproved: true, rules: [rule({ sourceReferences: [] })], deductibles: [], conflicts: [] })
    expect(result.result).toBe('unknown')
    expect(result.missingInformation).toContain('Eşleşen kuralın kaynak referansı eksik veya geçersiz.')
    expect(result.operationalRecommendation.procurementStatus).toBe('control_required')
  })

  it('insan onayı yoksa kaynaklı covered kuralını control_required tutar', () => {
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'coverage', analysisApproved: false, rules: [rule()], deductibles: [], conflicts: [] })
    expect(result.result).toBe('control_required')
    expect(result.humanApprovalRequired).toBe(true)
  })

  it('genel muafiyetsiz kural koşullu anlaşmasız servis muafiyetini silmez', () => {
    const general = rule({ ruleId: 'general-no-deductible', scenarioType: 'deductible', deductibleCodes: [], action: 'Genel muafiyet yoktur.', precedence: 10 })
    const conditional = rule({
      ruleId: 'conditional-service-deduction',
      scenarioType: 'deductible',
      conditions: [{ field: 'insurerAgreementStatus', operator: 'equals', value: 'not_agreed' }],
      coverageOutcome: 'conditional',
      deductibleCodes: ['uncontracted-service'],
      action: 'Anlaşmasız servis tenzili uygulanabilir.',
      precedence: 20,
    })
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'deductible', analysisApproved: true, rules: [general, conditional], deductibles: [deductible()], conflicts: [] })
    expect(result.result).toBe('conditional')
    expect(result.deductibles.map((item) => item.code)).toEqual(['uncontracted-service'])
    expect(result.operationalRecommendation.procurementStatus).toBe('pause')
    expect(result.operationalRecommendation.mobileRepairStatus).toBe('pause')
  })

  it('birden fazla muafiyeti kaybetmeden deterministik birleştirir', () => {
    const rules = [
      rule({ ruleId: 'a', scenarioType: 'deductible', coverageOutcome: 'conditional', deductibleCodes: ['uncontracted-service'], precedence: 20 }),
      rule({ ruleId: 'b', scenarioType: 'deductible', coverageOutcome: 'conditional', deductibleCodes: ['betterment'], precedence: 20 }),
    ]
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'deductible', analysisApproved: true, rules, deductibles: [deductible(), deductible({ code: 'betterment', type: 'betterment', percentage: 5 })], conflicts: [] })
    expect(result.deductibles.map((item) => item.code)).toEqual(['betterment', 'uncontracted-service'])
    expect(aggregatePolicyDeductibles({ matchingRules: rules, deductibles: [deductible(), deductible(), deductible({ code: 'betterment', type: 'betterment' })] }).map((item) => item.code)).toEqual(['betterment', 'uncontracted-service'])
  })

  it('aynı öncelikte çelişen kuralları sessiz çözmez', () => {
    const rules = [rule({ ruleId: 'covered' }), rule({ ruleId: 'excluded', coverageOutcome: 'excluded' })]
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'coverage', analysisApproved: true, rules, deductibles: [], conflicts: [] })
    expect(result.result).toBe('control_required')
    expect(result.operationalRecommendation.procurementStatus).toBe('control_required')
    expect(resolvePolicyRulePrecedence({ facts: facts(), scenarioType: 'coverage', rules }).hasConflict).toBe(true)
  })

  it('açık conflict varken kesin sonuç üretmez', () => {
    const conflict: PolicyConflictFact = {
      id: 'conflict-1', affectedTopic: 'service_condition', explanation: 'Poliçe ve zeyil çelişiyor.', severity: 'high',
      resolutionStatus: 'open', sourceA: source('source-a'), sourceB: source('source-b'),
    }
    const result = evaluatePolicyScenario({ facts: facts(), scenarioType: 'coverage', analysisApproved: true, rules: [rule()], deductibles: [], conflicts: [conflict] })
    expect(result.result).toBe('control_required')
    expect(result.conflicts).toHaveLength(1)
  })

  it('mini onarım ve mobil onarımı ayrı senaryolar olarak eşleştirir', () => {
    const mini = rule({ ruleId: 'mini', scenarioType: 'mini_repair', conditions: [{ field: 'requestedOperation', operator: 'equals', value: 'mini_repair' }] })
    const mobile = rule({ ruleId: 'mobile', scenarioType: 'mobile_repair', conditions: [{ field: 'requestedOperation', operator: 'equals', value: 'mobile_repair' }] })
    expect(matchesPolicyScenarioRule(mini, facts({ requestedOperation: 'mini_repair' }))).toBe(true)
    expect(matchesPolicyScenarioRule(mobile, facts({ requestedOperation: 'mini_repair' }))).toBe(false)
  })

  it('cam servisi, parça, ikame araç, betterment ve önceki total loss senaryolarını ayrı tutar', () => {
    const types = ['glass_service', 'part_type', 'replacement_vehicle', 'betterment', 'previous_total_loss'] as const
    for (const scenarioType of types) {
      const result = evaluatePolicyScenario({ facts: facts(), scenarioType, analysisApproved: true, rules: [rule({ scenarioType, ruleId: scenarioType })], deductibles: [], conflicts: [] })
      expect(result.result).toBe('covered')
    }
  })

  it('Trafik case ve doğrulanmamış source document için fail-closed sonuç verir', () => {
    const traffic = evaluatePolicyScenario({ facts: facts({ caseType: 'traffic' }), scenarioType: 'coverage', analysisApproved: true, rules: [rule()], deductibles: [], conflicts: [] })
    const unverified = evaluatePolicyScenario({ facts: facts({ documentState: 'unverified' }), scenarioType: 'coverage', analysisApproved: true, rules: [rule()], deductibles: [], conflicts: [] })
    expect(traffic.result).toBe('unknown')
    expect(unverified.result).toBe('control_required')
  })
})
