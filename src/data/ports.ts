import type { CaseRecord } from '../types/case'

/**
 * DataPort siniri (Paket 08): Feature UI yalniz bu arayuzu tuketir.
 * MockDataAdapter varsayilan ve guvenli fallback'tir; HttpApiAdapter
 * salt okunur Cases API'sine baglanir. UI davranisi degismez.
 */
export interface CasesDataPort {
  listCases(): Promise<readonly CaseRecord[]>
}

export interface NamedReferenceRecord {
  readonly id: string
  readonly name: string
}

export interface UserReferenceRecord {
  readonly id: string
  readonly displayName: string
}

export interface ServiceReferenceRecord extends NamedReferenceRecord {
  readonly serviceType: 'authorized' | 'private' | 'glass' | 'mobile' | 'other'
  readonly isActive: boolean
  readonly agreement: ServiceAgreementEvaluationRecord
}

export interface ServiceAgreementEvaluationRecord {
  readonly status: 'eligible' | 'not_eligible' | 'control_required'
  readonly agreementStatus: 'agreed' | 'not_agreed' | 'control_required'
  readonly serviceType: ServiceReferenceRecord['serviceType']
  readonly operation: 'closure_documents' | 'deductible_assessment' | 'policy_assessment' | 'repair_authorization'
  readonly evaluationDate: string | null
  readonly dateSource: 'loss_date' | 'policy_date'
  readonly isAuthorized: boolean
  readonly isInsurerAgreed: boolean | null
  readonly reason: string
  readonly ruleVersion: string
  readonly matchedAgreementIds: readonly string[]
  readonly requiresHumanReview: boolean
}

export interface CaseReferenceWorkspace {
  readonly insurers: readonly NamedReferenceRecord[]
  readonly services: readonly ServiceReferenceRecord[]
  readonly users: readonly UserReferenceRecord[]
  readonly experts: readonly UserReferenceRecord[]
}

export interface CaseReferenceDataPort {
  getCaseReferences(query?: ServiceReferenceQuery): Promise<CaseReferenceWorkspace>
}

export interface ServiceReferenceQuery {
  readonly insurerId?: string
  readonly evaluationDate?: string
  readonly dateSource?: 'loss_date' | 'policy_date'
  readonly operation?: ServiceAgreementEvaluationRecord['operation']
}

export type DocumentPhysicalStatus = 'pending' | 'ready' | 'failed' | 'missing'
export type DocumentRequirementStatus = 'required' | 'present' | 'missing' | 'not_applicable' | 'control_required'

export interface RelatedDocumentStatus {
  readonly documentId: string
  readonly status: DocumentPhysicalStatus
}

export interface DocumentRequirementRecord {
  readonly requirementCode: string
  readonly canonicalDocumentType: string
  readonly status: DocumentRequirementStatus
  readonly reason: string
  readonly ruleVersion: string
  readonly sourceRule: string
  readonly matchedDocumentIds: readonly string[]
  readonly relatedDocumentStatuses: readonly RelatedDocumentStatus[]
  readonly evaluatedAt: string
  readonly requiresHumanReview: boolean
}

export interface AlternativeDocumentGroupRecord {
  readonly groupCode: string
  readonly operator: 'all_of' | 'any_of' | 'exactly_one'
  readonly status: DocumentRequirementStatus
  readonly reason: string
  readonly memberRequirementCodes: readonly string[]
  readonly matchedDocumentIds: readonly string[]
  readonly requiresHumanReview: boolean
}

export interface DocumentVersionMetadataRecord {
  readonly id: string
  readonly documentId: string
  readonly documentType: string
  readonly versionNumber: number
  readonly originalFileName: string
  readonly displayName: string
  readonly mimeType: string
  readonly byteSize: number
  readonly relativePath: string
  readonly status: DocumentPhysicalStatus
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export interface PhotoMetadataRecord {
  readonly id: string
  readonly originalFileName: string
  readonly displayName: string
  readonly mimeType: string
  readonly byteSize: number
  readonly relativePath: string
  readonly status: DocumentPhysicalStatus
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export interface CaseDocumentWorkspaceRecord {
  readonly caseId: string
  readonly caseType: 'traffic' | 'casco'
  readonly ruleSetVersion: string
  readonly overallStatus: DocumentRequirementStatus
  readonly requirements: readonly DocumentRequirementRecord[]
  readonly alternativeGroups: readonly AlternativeDocumentGroupRecord[]
  readonly missingCount: number
  readonly controlRequiredCount: number
  readonly evaluatedAt: string
  readonly documents: readonly DocumentVersionMetadataRecord[]
  readonly photos: readonly PhotoMetadataRecord[]
}

export interface CaseDocumentsDataPort {
  getCaseDocumentWorkspace(caseId: string): Promise<CaseDocumentWorkspaceRecord>
}

export type PolicyAnalysisStatus = 'draft'|'extracted'|'control_required'|'conflict_detected'|'awaiting_approval'|'approved'|'superseded'|'rejected'|'failed'
export type PolicyScenarioType = 'coverage'|'deductible'|'uncontracted_service'|'authorized_service'|'glass_service'|'mini_repair'|'mobile_repair'|'replacement_vehicle'|'roadside_assistance'|'part_type'|'betterment'|'previous_total_loss'
export interface PolicySourceReferenceRecord { readonly id:string;readonly documentId:string;readonly documentVersionId:string;readonly pageNumber:number;readonly sectionHeading:string;readonly clauseIdentifier:string;readonly rawExcerpt:string;readonly sourceType:string;readonly confidence:number }
export interface PolicyEvidenceItemRecord { readonly id:string;readonly code:string;readonly sourceReferenceIds:readonly string[];readonly confidence?:number }
export interface PolicyCoverageRecord extends PolicyEvidenceItemRecord { readonly canonicalType:string;readonly originalHeading:string;readonly originalWording:string;readonly inclusion:'included'|'excluded'|'conditional'|'unknown' }
export interface PolicyDeductibleRecord extends PolicyEvidenceItemRecord { readonly type:string;readonly trigger:string;readonly calculationType:string;readonly fixedAmount:number|null;readonly percentage:number|null;readonly insuredShare:number|null;readonly insurerShare:number|null;readonly approvalStatus:string }
export interface PolicyServiceRuleRecord extends PolicyEvidenceItemRecord { readonly authorizedServiceRequirement:boolean|null;readonly insurerContractedServiceRequirement:boolean|null;readonly serviceFreedom:string;readonly condition:string|null;readonly glassNetwork:string|null;readonly mobileRepairRestriction:string|null;readonly miniRepairRestriction:string|null }
export interface PolicyPartRuleRecord extends PolicyEvidenceItemRecord { readonly allowedPartTypes:readonly string[];readonly procurementRule:string|null;readonly bettermentCondition:string|null }
export interface PolicyReplacementVehicleRecord extends PolicyEvidenceItemRecord { readonly available:string;readonly vehicleClass:string|null;readonly maximumDays:number|null;readonly eventLimit:number|null;readonly serviceCondition:string|null }
export interface PolicyExclusionRecord extends PolicyEvidenceItemRecord { readonly originalWording:string;readonly trigger:string;readonly affectedCoverage:string|null }
export interface PolicyConflictRecord { readonly id:string;readonly affectedTopic:string;readonly explanation:string;readonly severity:string;readonly resolutionStatus:string;readonly sourceAId:string;readonly sourceBId:string }
export interface PolicyAnalysisRecord {
  readonly id:string;readonly currentAnalysisVersion:number;readonly currentStatus:PolicyAnalysisStatus;readonly version:number
  readonly currentVersion:{readonly sourceDocumentId:string;readonly sourceDocumentVersionId:string;readonly analysisVersion:number;readonly analysisStatus:PolicyAnalysisStatus;readonly sourceCompleteness:'complete'|'partial'|'unknown';readonly humanApprovalStatus:'pending'|'approved'|'rejected';readonly productName:string|null;readonly insurerFormat:string|null;readonly sourceReferences:readonly PolicySourceReferenceRecord[];readonly coverages:readonly PolicyCoverageRecord[];readonly deductibles:readonly PolicyDeductibleRecord[];readonly serviceRules:readonly PolicyServiceRuleRecord[];readonly partRules:readonly PolicyPartRuleRecord[];readonly replacementVehicleRules:readonly PolicyReplacementVehicleRecord[];readonly exclusions:readonly PolicyExclusionRecord[];readonly conflicts:readonly PolicyConflictRecord[]}
}
export interface PolicyScenarioEvaluationRecord { readonly result:'covered'|'excluded'|'conditional'|'control_required'|'unknown';readonly reasoning:readonly string[];readonly deductibles:readonly PolicyDeductibleRecord[];readonly limit:string|null;readonly insuredShare:number|null;readonly insurerShare:number|null;readonly serviceCondition:readonly string[];readonly partCondition:readonly string[];readonly requiredAction:readonly string[];readonly requiredDocuments:readonly string[];readonly sourceReferences:readonly PolicySourceReferenceRecord[];readonly conflicts:readonly PolicyConflictRecord[];readonly missingInformation:readonly string[];readonly confidence:number;readonly humanApprovalRequired:boolean;readonly policyAnalysisVersion:number;readonly ruleVersion:string;readonly operationalRecommendation:{readonly procurementStatus:'continue'|'pause'|'control_required';readonly mobileRepairStatus:'continue'|'pause'|'control_required';readonly approvalRequired:boolean} }
export interface PolicyAnalysisDataPort { getCurrentAnalysis(caseId:string):Promise<PolicyAnalysisRecord|null>;evaluateScenario(caseId:string,input:{analysisId:string;policyAnalysisVersion:number;scenarioType:PolicyScenarioType;damageCategory:string|null;repairMethod:string|null;requestedOperation:string;documentState:'verified'}):Promise<PolicyScenarioEvaluationRecord> }

export type DataSourceKind = 'mock' | 'api'

/** localStorage acik secimi ortam varsayilanina baskindir; varsayilan yine mock'tur. */
export const DATA_SOURCE_STORAGE_KEY = 'hasarbotu-data-source'

export function getConfiguredDataSource(): DataSourceKind {
  try {
    const stored = window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY)
    if (stored === 'api' || stored === 'mock') return stored
  } catch {
    // localStorage kapaliysa guvenli ortam varsayilanina gecilir.
  }
  return import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock'
}
