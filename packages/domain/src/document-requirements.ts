import type { CaseType } from './case-type.js'

/** Kanonik belge tipleri; sınıflandırma bu motorun kapsamı dışındadır. */
export const CANONICAL_DOCUMENT_TYPES = [
  'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
  'victim_registration', 'insured_registration', 'victim_driver_license', 'insured_driver_license',
  'casco_policy', 'casco_vehicle_registration', 'casco_driver_license',
  'accident_report', 'ktt', 'statement', 'tramer_result',
  'opposing_vehicle_registration', 'opposing_driver_license', 'opposing_traffic_policy', 'fault_ratio',
] as const
export type CanonicalDocumentType = (typeof CANONICAL_DOCUMENT_TYPES)[number]
export const DOCUMENT_REQUIREMENT_STATUSES = ['required', 'present', 'missing', 'not_applicable', 'control_required'] as const
export type DocumentRequirementStatus = (typeof DOCUMENT_REQUIREMENT_STATUSES)[number]
export type DocumentMetadataStatus = 'pending' | 'ready' | 'failed' | 'missing'
export type RecourseStatus = 'confirmed' | 'not_confirmed' | 'unknown'

export interface DocumentRequirementRuleSet {
  readonly ruleSetId: string; readonly version: string; readonly effectiveFrom: string; readonly effectiveTo: string | null
  readonly caseType: CaseType; readonly status: 'active' | 'retired'; readonly sourceReference: string
}
export const DOCUMENT_REQUIREMENT_RULE_VERSION = '2026.07.14.1' as const
export const DOCUMENT_REQUIREMENT_RULE_SET_ID = 'document-requirements-tr-canonical' as const

export interface DocumentRequirementInputDocument {
  readonly id: string; readonly canonicalDocumentType: CanonicalDocumentType; readonly status: DocumentMetadataStatus
  readonly hashVerified: boolean; readonly sizeVerified: boolean; readonly verifiedAt: string | null
}
export interface DocumentRequirementFact { readonly caseType: CaseType; readonly recourseStatus?: RecourseStatus; readonly documents: readonly DocumentRequirementInputDocument[] }
export interface RelatedDocumentStatus { readonly documentId: string; readonly status: DocumentMetadataStatus }
export interface DocumentRequirementResult {
  readonly requirementCode: string; readonly canonicalDocumentType: CanonicalDocumentType; readonly status: DocumentRequirementStatus
  readonly reason: string; readonly ruleVersion: string; readonly sourceRule: string; readonly matchedDocumentIds: readonly string[]
  readonly relatedDocumentStatuses: readonly RelatedDocumentStatus[]; readonly evaluatedAt: string; readonly requiresHumanReview: boolean
}
export interface AlternativeDocumentGroupResult {
  readonly groupCode: string; readonly operator: 'all_of' | 'any_of' | 'exactly_one'; readonly status: DocumentRequirementStatus
  readonly reason: string; readonly memberRequirementCodes: readonly string[]; readonly matchedDocumentIds: readonly string[]; readonly requiresHumanReview: boolean
}
export interface DocumentRequirementsEvaluation { readonly ruleSet: DocumentRequirementRuleSet; readonly requirements: readonly DocumentRequirementResult[]; readonly alternativeGroups: readonly AlternativeDocumentGroupResult[] }

const trafficBase: readonly [string, CanonicalDocumentType][] = [
  ['traffic_victim_policy', 'victim_traffic_policy'], ['traffic_insured_policy', 'insured_traffic_policy'], ['sbm_heavy_damage', 'sbm_heavy_damage_result'],
  ['traffic_victim_registration', 'victim_registration'], ['traffic_insured_registration', 'insured_registration'], ['traffic_victim_driver_license', 'victim_driver_license'], ['traffic_insured_driver_license', 'insured_driver_license'],
]
const cascoBase: readonly [string, CanonicalDocumentType][] = [
  ['casco_policy', 'casco_policy'], ['sbm_heavy_damage', 'sbm_heavy_damage_result'], ['casco_registration', 'casco_vehicle_registration'], ['casco_driver_license', 'casco_driver_license'],
]

function isVerifiedReady(document: DocumentRequirementInputDocument): boolean { return document.status === 'ready' && document.hashVerified && document.sizeVerified && document.verifiedAt !== null }
export function defaultDocumentRequirementRuleSet(caseType: CaseType): DocumentRequirementRuleSet {
  return { ruleSetId: DOCUMENT_REQUIREMENT_RULE_SET_ID, version: DOCUMENT_REQUIREMENT_RULE_VERSION, effectiveFrom: '2026-07-14', effectiveTo: null, caseType, status: 'active', sourceReference: 'DOMAIN_RULES.md#evrak' }
}
function result(code: string, type: CanonicalDocumentType, facts: DocumentRequirementFact, evaluatedAt: string, ruleVersion: string, sourceRule: string, forced?: DocumentRequirementStatus, forcedReason?: string): DocumentRequirementResult {
  const candidates = facts.documents.filter((item) => item.canonicalDocumentType === type).sort((a, b) => a.id.localeCompare(b.id))
  const relatedDocumentStatuses = candidates.map(({ id, status }) => ({ documentId: id, status }))
  const ready = candidates.filter(isVerifiedReady)
  let status: DocumentRequirementStatus; let reason: string
  if (forced !== undefined) { status = forced; reason = forcedReason ?? 'Koşul nedeniyle uygulanmaz.' }
  else if (ready.length > 0) { status = 'present'; reason = 'File Agent tarafından fiziksel olarak doğrulanmış ready belge bulundu.' }
  else if (candidates.some((item) => item.status === 'pending' || item.status === 'failed' || (item.status === 'ready' && !isVerifiedReady(item)))) { status = 'control_required'; reason = 'Aday belge doğrulanmamış veya doğrulaması başarısız; mevcut kabul edilmedi.' }
  else { status = 'missing'; reason = 'Doğrulanmış ready belge bulunamadı.' }
  return { requirementCode: code, canonicalDocumentType: type, status, reason, ruleVersion, sourceRule, matchedDocumentIds: ready.map((item) => item.id), relatedDocumentStatuses, evaluatedAt, requiresHumanReview: status === 'control_required' }
}
function anyGroup(groupCode: string, members: readonly DocumentRequirementResult[]): AlternativeDocumentGroupResult {
  const present = members.filter((item) => item.status === 'present'); const control = members.some((item) => item.status === 'control_required')
  const status: DocumentRequirementStatus = present.length > 0 ? 'present' : control ? 'control_required' : 'missing'
  return { groupCode, operator: 'any_of', status, reason: status === 'present' ? 'Alternatif grupta doğrulanmış ready belge bulundu.' : status === 'control_required' ? 'Alternatif grupta doğrulama bekleyen veya başarısız aday var.' : 'Alternatif grubun hiçbir belgesi doğrulanmış ready değil.', memberRequirementCodes: members.map((item) => item.requirementCode), matchedDocumentIds: present.flatMap((item) => item.matchedDocumentIds), requiresHumanReview: status === 'control_required' }
}
/** Saf ve deterministik: zaman çağırmaz, DB/HTTP/AI kullanmaz. */
export function evaluateDocumentRequirements(facts: DocumentRequirementFact, evaluatedAt: string, ruleSet: DocumentRequirementRuleSet): DocumentRequirementsEvaluation {
  if (ruleSet.caseType !== facts.caseType) throw new Error('rule_set_case_type_mismatch')
  const version = ruleSet.version
  const requirements = (facts.caseType === 'traffic' ? trafficBase : cascoBase).map(([code, type]) => result(code, type, facts, evaluatedAt, version, 'base_required'))
  const rawAccident = result('accident_report', 'accident_report', facts, evaluatedAt, version, 'incident_document')
  const rawKtt = result('ktt', 'ktt', facts, evaluatedAt, version, 'incident_alternative')
  const rawStatement = result('statement', 'statement', facts, evaluatedAt, version, 'incident_alternative')
  const reportPresent = rawAccident.status === 'present'
  const accidentSatisfiedByAlternative = !reportPresent
    && (rawKtt.status === 'present' || rawStatement.status === 'present')
  const accident = rawAccident.status === 'missing' || accidentSatisfiedByAlternative
    ? result(
        'accident_report',
        'accident_report',
        facts,
        evaluatedAt,
        version,
        'incident_document',
        'not_applicable',
        accidentSatisfiedByAlternative
          ? `${rawKtt.status === 'present' ? 'KTT' : 'Beyan'} doğrulanmış olduğundan Zabıt ayrıca zorunlu değildir.`
          : 'Zabıt yok; KTT veya Beyan alternatifi değerlendirildi.',
      )
    : rawAccident
  const kttSatisfiedByAlternative = !reportPresent && rawStatement.status === 'present' && rawKtt.status !== 'present'
  const statementSatisfiedByAlternative = !reportPresent && rawKtt.status === 'present' && rawStatement.status !== 'present'
  const ktt = reportPresent || kttSatisfiedByAlternative
    ? result('ktt', 'ktt', facts, evaluatedAt, version, 'incident_alternative', 'not_applicable', reportPresent ? 'Zabıt doğrulanmış olduğundan KTT zorunlu değildir.' : 'Beyan doğrulanmış olduğundan KTT ayrıca zorunlu değildir.')
    : rawKtt
  const statement = reportPresent || statementSatisfiedByAlternative
    ? result('statement', 'statement', facts, evaluatedAt, version, 'incident_alternative', 'not_applicable', reportPresent ? 'Zabıt doğrulanmış olduğundan Beyan zorunlu değildir.' : 'KTT doğrulanmış olduğundan Beyan ayrıca zorunlu değildir.')
    : rawStatement
  requirements.push(accident, ktt, statement)
  const alternatives = [anyGroup('incident_document', [accident, ktt, statement])]
  if (facts.caseType === 'traffic') {
    requirements.push(result('tramer_result', 'tramer_result', facts, evaluatedAt, version, 'tramer_condition', reportPresent ? 'not_applicable' : undefined, reportPresent ? 'Zabıt doğrulanmış olduğundan Tramer zorunlu değildir.' : undefined))
  }
  if (facts.caseType === 'casco') {
    const recourse = facts.recourseStatus ?? 'unknown'
    const extra: readonly [string, CanonicalDocumentType][] = [['recourse_opposing_registration','opposing_vehicle_registration'], ['recourse_opposing_driver_license','opposing_driver_license'], ['recourse_opposing_traffic_policy','opposing_traffic_policy'], ['recourse_tramer_result','tramer_result'], ['recourse_fault_ratio','fault_ratio']]
    if (recourse === 'confirmed') {
      for (const [code, type] of extra) requirements.push(result(code, type, facts, evaluatedAt, version, 'confirmed_recourse'))
      const rawRecourseKtt = result('recourse_ktt', 'ktt', facts, evaluatedAt, version, 'confirmed_recourse_alternative')
      const rawRecourseReport = result('recourse_accident_report', 'accident_report', facts, evaluatedAt, version, 'confirmed_recourse_alternative')
      const recourseKtt = rawRecourseReport.status === 'present' && rawRecourseKtt.status !== 'present'
        ? result('recourse_ktt', 'ktt', facts, evaluatedAt, version, 'confirmed_recourse_alternative', 'not_applicable', 'Zabıt doğrulanmış olduğundan rücu için KTT ayrıca zorunlu değildir.')
        : rawRecourseKtt
      const recourseReport = rawRecourseKtt.status === 'present' && rawRecourseReport.status !== 'present'
        ? result('recourse_accident_report', 'accident_report', facts, evaluatedAt, version, 'confirmed_recourse_alternative', 'not_applicable', 'KTT doğrulanmış olduğundan rücu için Zabıt ayrıca zorunlu değildir.')
        : rawRecourseReport
      requirements.push(recourseKtt, recourseReport); alternatives.push(anyGroup('recourse_incident_document', [recourseKtt, recourseReport]))
    } else {
      for (const [code, type] of extra) requirements.push(result(code, type, facts, evaluatedAt, version, 'recourse_undetermined', recourse === 'unknown' ? 'control_required' : 'not_applicable', recourse === 'unknown' ? 'Rücu durumu kesinleşmedi; eksik otomatik üretilmedi.' : 'Rücu kesinleşmedi.'))
    }
  }
  return { ruleSet, requirements, alternativeGroups: alternatives }
}
