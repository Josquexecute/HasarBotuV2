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
  readonly contentHash: string
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
export interface PolicyAnalysisAiFactRecord {readonly id:string;readonly category:PolicyAiCandidateCategory;readonly canonicalField:string;readonly normalizedValue:unknown;readonly originalValue:string;readonly conditions:readonly string[];readonly exceptions:readonly string[];readonly reviewAction:'accepted'|'edited';readonly originRunId:string;readonly originCandidateId:string;readonly originReviewVersion:number;readonly sourceAnchorIds:readonly string[];readonly sourceReferenceIds:readonly string[];readonly providerConfidence:number;readonly sourceQuality:'high'|'medium'|'low'|'control_required';readonly providerId:string;readonly providerVersion:string;readonly modelId:string;readonly reviewedByUserId:string;readonly reviewedAt:string}
export interface PolicyAnalysisRecord {
  readonly id:string;readonly currentAnalysisVersion:number;readonly currentStatus:PolicyAnalysisStatus;readonly version:number
  readonly currentVersion:{readonly sourceDocumentId:string;readonly sourceDocumentVersionId:string;readonly analysisVersion:number;readonly analysisStatus:PolicyAnalysisStatus;readonly sourceCompleteness:'complete'|'partial'|'unknown';readonly humanApprovalStatus:'pending'|'approved'|'rejected';readonly productName:string|null;readonly insurerFormat:string|null;readonly aiCandidateFacts:readonly PolicyAnalysisAiFactRecord[];readonly sourceReferences:readonly PolicySourceReferenceRecord[];readonly coverages:readonly PolicyCoverageRecord[];readonly deductibles:readonly PolicyDeductibleRecord[];readonly serviceRules:readonly PolicyServiceRuleRecord[];readonly partRules:readonly PolicyPartRuleRecord[];readonly replacementVehicleRules:readonly PolicyReplacementVehicleRecord[];readonly exclusions:readonly PolicyExclusionRecord[];readonly conflicts:readonly PolicyConflictRecord[]}
}
export interface PolicyScenarioEvaluationRecord { readonly result:'covered'|'excluded'|'conditional'|'control_required'|'unknown';readonly reasoning:readonly string[];readonly deductibles:readonly PolicyDeductibleRecord[];readonly limit:string|null;readonly insuredShare:number|null;readonly insurerShare:number|null;readonly serviceCondition:readonly string[];readonly partCondition:readonly string[];readonly requiredAction:readonly string[];readonly requiredDocuments:readonly string[];readonly sourceReferences:readonly PolicySourceReferenceRecord[];readonly conflicts:readonly PolicyConflictRecord[];readonly missingInformation:readonly string[];readonly confidence:number;readonly humanApprovalRequired:boolean;readonly policyAnalysisVersion:number;readonly ruleVersion:string;readonly operationalRecommendation:{readonly procurementStatus:'continue'|'pause'|'control_required';readonly mobileRepairStatus:'continue'|'pause'|'control_required';readonly approvalRequired:boolean} }
export interface PolicyAnalysisDataPort { getCurrentAnalysis(caseId:string):Promise<PolicyAnalysisRecord|null>;evaluateScenario(caseId:string,input:{analysisId:string;policyAnalysisVersion:number;scenarioType:PolicyScenarioType;damageCategory:string|null;repairMethod:string|null;requestedOperation:string;documentState:'verified'}):Promise<PolicyScenarioEvaluationRecord> }

export type PdfTextExtractionStatus='queued'|'processing'|'ready'|'partial'|'ocr_required'|'failed'|'cancelled'|'stale'
export interface PdfPolicySourceRecord{readonly documentId:string;readonly documentVersionId:string;readonly versionNumber:number;readonly displayName:string;readonly mimeType:string;readonly byteSize:number;readonly status:'ready';readonly verifiedAt:string}
export interface PdfTextExtractionRecord{readonly id:string;readonly documentId:string;readonly documentVersionId:string;readonly extractionVersion:number;readonly status:PdfTextExtractionStatus;readonly parserName:'pdfjs-dist';readonly parserVersion:'6.1.200';readonly normalizationVersion:'pdf-text-normalization/1.0.0';readonly offsetUnit:'unicode_code_point';readonly pageCount:number;readonly textPageCount:number;readonly imageOnlyPageCount:number;readonly emptyPageCount:number;readonly failedPageCount:number;readonly segmentCount:number;readonly rawCharacterCount:number;readonly normalizedCharacterCount:number;readonly outputHash:string|null;readonly failureCode:string|null;readonly version:number;readonly createdAt:string;readonly startedAt:string|null;readonly completedAt:string|null}
export interface PdfTextPageRecord{readonly id:string;readonly extractionId:string;readonly pageNumber:number;readonly status:'text'|'image_only'|'empty'|'failed'|'skipped';readonly rawText:string;readonly normalizedText:string;readonly rawTextHash:string;readonly normalizedTextHash:string;readonly segmentCount:number}
export interface PdfTextSegmentRecord{readonly id:string;readonly extractionId:string;readonly pageId:string;readonly pageNumber:number;readonly segmentIndex:number;readonly type:'title'|'heading'|'clause'|'paragraph'|'list'|'table'|'header_footer'|'unknown';readonly startOffset:number;readonly endOffset:number;readonly text:string;readonly textHash:string}
export interface PdfTextSourceReferenceRecord{readonly sourceKey:string;readonly documentId:string;readonly documentVersionId:string;readonly pageNumber:number;readonly sectionHeading:string;readonly clauseIdentifier:string;readonly rawExcerpt:string;readonly locator:string;readonly sourceType:string;readonly confidence:number;readonly extractionLocator:{readonly extractionId:string;readonly pageId:string;readonly segmentId:string|null;readonly startOffset:number;readonly endOffset:number}}
export interface PolicyPdfTextDataPort{listSources(caseId:string):Promise<readonly PdfPolicySourceRecord[]>;listExtractions(caseId:string,source:PdfPolicySourceRecord):Promise<readonly PdfTextExtractionRecord[]>;createExtraction(caseId:string,source:PdfPolicySourceRecord,idempotencyKey:string):Promise<PdfTextExtractionRecord>;getExtraction(caseId:string,extractionId:string):Promise<PdfTextExtractionRecord>;listPages(caseId:string,extractionId:string):Promise<readonly PdfTextPageRecord[]>;listSegments(caseId:string,extractionId:string,pageNumber?:number):Promise<readonly PdfTextSegmentRecord[]>;createSourceReference(caseId:string,extractionId:string,segment:PdfTextSegmentRecord,idempotencyKey:string):Promise<PdfTextSourceReferenceRecord>}

export type PolicyOcrRunStatus='queued'|'rendering'|'preprocessing'|'recognizing'|'normalizing'|'validating'|'ready'|'partial'|'low_confidence'|'control_required'|'failed'|'cancelled'|'stale'|'superseded'
export type PolicyOcrLanguageMode='tur'|'eng'|'tur+eng'
export type PolicyOcrRenderProfile='standard'|'high_quality'
export interface PolicyOcrRunRecord{readonly id:string;readonly caseId:string;readonly documentId:string;readonly documentVersionId:string;readonly textExtractionId:string;readonly ocrVersion:number;readonly status:PolicyOcrRunStatus;readonly engineName:'tesseract.js';readonly engineVersion:'7.0.0';readonly languageDataVersion:'tessdata-4.0.0-full/1.0.0';readonly languageDataHash:string;readonly languageMode:PolicyOcrLanguageMode;readonly renderProfile:PolicyOcrRenderProfile;readonly renderProfileVersion:'policy-ocr-render-standard/1.0.0'|'policy-ocr-render-high-quality/1.0.0';readonly preprocessingVersion:'policy-ocr-preprocessing/1.0.0';readonly qualityVersion:'policy-ocr-quality/1.0.0';readonly normalizationVersion:'policy-ocr-normalization/1.0.0';readonly locatorVersion:'policy-ocr-locator/1.0.0';readonly offsetUnit:'unicode_code_point';readonly sourceHash:string;readonly sourceSize:number;readonly eligiblePageCount:number;readonly processedPageCount:number;readonly readyPageCount:number;readonly lowQualityPageCount:number;readonly emptyPageCount:number;readonly failedPageCount:number;readonly blockCount:number;readonly lineCount:number;readonly wordCount:number;readonly normalizedCharacterCount:number;readonly meanConfidence:number|null;readonly outputHash:string|null;readonly failureCode:string|null;readonly activeJobId:string|null;readonly version:number;readonly createdAt:string;readonly startedAt:string|null;readonly completedAt:string|null}
export interface PolicyOcrPageRecord{readonly id:string;readonly ocrRunId:string;readonly textPageId:string;readonly pageNumber:number;readonly status:'accepted_candidate'|'partial'|'low_confidence'|'unreadable'|'unsupported'|'failed'|'control_required';readonly languageMode:PolicyOcrLanguageMode;readonly imageWidth:number;readonly imageHeight:number;readonly renderDpi:number;readonly rotationDegrees:0|90|180|270;readonly deskewDegrees:number;readonly threshold:number;readonly rawOcrText:string;readonly rawTextHash:string;readonly normalizedText:string;readonly normalizedTextHash:string;readonly normalizedCharacterCount:number;readonly meanConfidence:number;readonly minimumConfidence:number;readonly qualityStatus:'high'|'medium'|'low'|'insufficient'|'control_required';readonly readingOrderQuality:'reliable'|'probable'|'ambiguous'|'control_required';readonly compositeStatus:'pdf_text_only'|'ocr_only'|'combined_non_overlapping'|'conflict_detected'|'control_required';readonly qualityReasonCode:string;readonly requiresHumanReview:boolean;readonly blockCount:number;readonly lineCount:number;readonly wordCount:number;readonly lowConfidenceWordCount:number;readonly unreadableRegionCount:number;readonly processingDurationMs:number}
export interface PolicyOcrElementRecord{readonly id:string;readonly ocrRunId:string;readonly pageId:string;readonly pageNumber:number;readonly type:'block'|'line'|'word';readonly parentId:string|null;readonly elementIndex:number;readonly readingOrder:number;readonly startOffset:number;readonly endOffset:number;readonly text:string;readonly textHash:string;readonly confidence:number;readonly bbox:{readonly x:number;readonly y:number;readonly width:number;readonly height:number};readonly sourceLayer:'ocr'}
export interface PolicyOcrSourceReferenceRecord{readonly sourceKey:string;readonly documentId:string;readonly documentVersionId:string;readonly pageNumber:number;readonly sectionHeading:string;readonly clauseIdentifier:string;readonly rawExcerpt:string;readonly locator:string;readonly sourceType:string;readonly confidence:number;readonly ocrLocator:{readonly ocrRunId:string;readonly pageId:string;readonly blockId:string|null;readonly lineId:string|null;readonly wordId:string|null;readonly startOffset:number;readonly endOffset:number;readonly engineVersion:'7.0.0';readonly languageDataVersion:'tessdata-4.0.0-full/1.0.0';readonly locatorVersion:'policy-ocr-locator/1.0.0';readonly qualityStatus:'high'|'medium'|'low'|'insufficient'|'control_required';readonly readingOrderQuality:'reliable'|'probable'|'ambiguous'|'control_required';readonly bbox:{readonly x:number;readonly y:number;readonly width:number;readonly height:number}}}
export interface PolicyOcrDataPort{listRuns(caseId:string,source:PdfPolicySourceRecord):Promise<readonly PolicyOcrRunRecord[]>;createRun(caseId:string,source:PdfPolicySourceRecord,textExtractionId:string,languageMode:PolicyOcrLanguageMode,renderProfile:PolicyOcrRenderProfile,idempotencyKey:string):Promise<PolicyOcrRunRecord>;getRun(caseId:string,ocrRunId:string):Promise<PolicyOcrRunRecord>;listPages(caseId:string,ocrRunId:string):Promise<readonly PolicyOcrPageRecord[]>;listElements(caseId:string,ocrRunId:string,page?:number):Promise<readonly PolicyOcrElementRecord[]>;retryRun(caseId:string,run:PolicyOcrRunRecord,idempotencyKey:string):Promise<PolicyOcrRunRecord>;createSourceReference(caseId:string,run:PolicyOcrRunRecord,element:PolicyOcrElementRecord,elements:readonly PolicyOcrElementRecord[],idempotencyKey:string):Promise<PolicyOcrSourceReferenceRecord>}

export type PolicyAiRunStatus='planned'|'provider_disabled'|'budget_blocked'|'running'|'validating'|'review_required'|'failed'|'stale'|'cancelled'|'superseded'
export type PolicyAiProviderId='deterministic-success'|'deterministic-invalid-schema'|'deterministic-timeout'|'deterministic-failure'|'deterministic-prompt-injection-attempt'|'openai-responses'|'gemini-generate-content'
export type PolicyAiCandidateCategory='policy_identity'|'coverage'|'deductible'|'service_rule'|'part_rule'|'replacement_vehicle'|'assistance'|'valuation'|'exclusion'|'required_document'|'special_condition'
export interface PolicyAiSourceSelectionRecord{readonly sourceType:'pdf_text'|'ocr';readonly documentId:string;readonly documentVersionId:string;readonly documentVersionNumber:number;readonly documentDisplayName:string;readonly extractionId?:string;readonly extractionVersion:number;readonly segmentId?:string;readonly ocrRunId?:string;readonly elementId?:string;readonly pageNumber:number;readonly label:string;readonly quality:'high'|'medium'|'low'|'control_required';readonly warnings:readonly string[]}
export interface PolicyAiSourceOverviewRecord{readonly key:string;readonly sourceType:'pdf_text'|'ocr';readonly documentVersionId:string;readonly documentVersionNumber:number;readonly documentDisplayName:string;readonly extractionId:string;readonly extractionVersion:number;readonly status:string;readonly pageCount:number;readonly selectedItemCount:number;readonly quality:'high'|'medium'|'low'|'control_required';readonly ocrRequiredPageNumbers:readonly number[];readonly warnings:readonly string[]}
export interface PolicyAiSourceItemRecord{readonly sourceAnchorId:string;readonly sourceType:'pdf_text'|'ocr';readonly documentId:string;readonly documentVersionId:string;readonly extractionId:string;readonly sourceItemId:string;readonly pageNumber:number;readonly boundedExcerpt:string;readonly textHash:string;readonly sourceQuality:'high'|'medium'|'low'|'control_required';readonly warnings:readonly string[];readonly historicalSelected:boolean}
export type PolicyAiReviewAction='accepted'|'edited'|'rejected'|'control_required'
export interface PolicyAiCandidateReviewRecord{readonly schemaVersion:string;readonly runId:string;readonly candidateId:string;readonly reviewVersion:number;readonly action:PolicyAiReviewAction;readonly normalizedValue:unknown;readonly originalValue:string;readonly conditions:readonly string[];readonly exceptions:readonly string[];readonly sourceAnchorIds:readonly string[];readonly reason:string|null;readonly evidenceStatus:'validated'|'control_required'|'rejected_evidence';readonly reviewedByUserId:string;readonly reviewedAt:string}
export interface PolicyAiCandidateRecord{readonly candidateId:string;readonly category:PolicyAiCandidateCategory;readonly canonicalField:string;readonly normalizedValue:unknown;readonly originalValue:string;readonly conditions:readonly string[];readonly exceptions:readonly string[];readonly sourceAnchorIds:readonly string[];readonly providerConfidence:number;readonly sourceQuality:'high'|'medium'|'low'|'control_required';readonly validationStatus:'validated'|'control_required'|'rejected_evidence';readonly conflictStatus:'none'|'duplicate'|'conflict_detected'|'control_required';readonly humanReviewStatus:'pending'|'control_required';readonly review:PolicyAiCandidateReviewRecord|null}
export type PolicyAiCandidateReviewInput={readonly action:'accepted'|'rejected'|'control_required';readonly expectedReviewVersion:number;readonly reason?:string}|{readonly action:'edited';readonly expectedReviewVersion:number;readonly reason:string;readonly normalizedValue:unknown;readonly originalValue:string;readonly conditions:readonly string[];readonly exceptions:readonly string[]}
export interface PolicyAiPromotionPreviewRecord{readonly schemaVersion:string;readonly runId:string;readonly runVersion:number;readonly reviewSetHash:string;readonly totalCandidateCount:number;readonly acceptedCount:number;readonly editedCount:number;readonly rejectedCount:number;readonly controlRequiredCount:number;readonly pendingCount:number;readonly promotableCount:number;readonly sourceCount:number;readonly conflictCount:number;readonly preservedConflictCount:number;readonly canPromote:boolean;readonly blockers:readonly string[];readonly warnings:readonly string[];readonly targetAnalysisId:string|null;readonly targetAnalysisVersion:number|null;readonly nextAnalysisVersion:number}
export interface PolicyAiPromotionRecord{readonly id:string;readonly schemaVersion:string;readonly runId:string;readonly reviewSetHash:string;readonly analysisId:string;readonly analysisVersionId:string;readonly analysisVersion:number;readonly promotedCandidateCount:number;readonly preservedConflictCount:number;readonly promotedByUserId:string;readonly promotedAt:string}
export interface PolicyAiRunRecord{readonly id:string;readonly caseId:string;readonly status:PolicyAiRunStatus;readonly providerId:string;readonly providerVersion:string;readonly modelId:string;readonly promptTemplateVersion:string;readonly outputSchemaVersion:string;readonly sourceBundleHash:string;readonly sourceBundleId:string;readonly candidateCount:number;readonly conflictCount:number;readonly controlRequiredCount:number;readonly inputCharacters:number;readonly estimatedCostMinor:number;readonly actualCostMinor:number|null;readonly safeErrorCode:string|null;readonly version:number;readonly createdAt:string;readonly startedAt:string|null;readonly completedAt:string|null;readonly privacy:{readonly externalProvider:boolean;readonly policyVersion:string;readonly outboundPayloadHash:string|null;readonly outboundInputCharacters:number;readonly redactedValueCount:number;readonly redactedCategories:readonly string[];readonly retentionMode:'local_only'|'store_false'|'free_tier_product_improvement';readonly pricingVersion:string};readonly budget:{readonly enabled:boolean;readonly providerAvailable:boolean;readonly providerAllowed:boolean;readonly estimatedCostMinor:number;readonly currentMonthCostMinor:number;readonly monthlyBudgetMinor:number;readonly perRequestBudgetMinor:number;readonly allowed:boolean;readonly reasonCode:string|null};readonly bundle:{readonly id:string;readonly sourceBundleHash:string;readonly bundleSchemaVersion:string;readonly documentVersionIds:readonly string[];readonly inputCharacters:number;readonly sourceCount:number;readonly completeness:'complete'|'partial'|'control_required';readonly missingPages:readonly number[];readonly ocrRequiredPages:readonly number[];readonly qualityWarnings:readonly string[];readonly createdAt:string;readonly items:readonly PolicyAiSourceItemRecord[]}}
export interface PolicyAiProviderPolicyRecord{readonly enabled:boolean;readonly monthlyBudgetMinor:number;readonly perRequestBudgetMinor:number;readonly monthlyHardStop:boolean;readonly currentMonthCostMinor:number;readonly maximumInputCharacters:number;readonly maximumCandidates:number;readonly requestTimeoutMs:number}
export interface PolicyAiProviderAvailabilityRecord{readonly providerId:PolicyAiProviderId;readonly configured:boolean;readonly organizationEnabled:boolean;readonly providerAllowed:boolean;readonly callReady:boolean;readonly providerVersion:string|null;readonly modelId:string|null;readonly externalProvider:boolean;readonly retentionMode:'local_only'|'store_false'|'free_tier_product_improvement'|null;readonly pricingVersion:string|null;readonly maximumInputCharacters:number|null;readonly reasonCode:'AI_PROVIDER_DISABLED'|'AI_PROVIDER_NOT_CONFIGURED'|'AI_PROVIDER_NOT_ALLOWED'|null}
export interface PolicyAiWorkspaceRecord{readonly run:PolicyAiRunRecord|null;readonly candidates:readonly PolicyAiCandidateRecord[];readonly conflicts:readonly {readonly id:string;readonly leftCandidateId:string;readonly rightCandidateId:string;readonly status:string;readonly reason:string}[];readonly availableSources:readonly PolicyAiSourceSelectionRecord[];readonly sourceOverviews:readonly PolicyAiSourceOverviewRecord[];readonly providerPolicy:PolicyAiProviderPolicyRecord;readonly providers:readonly PolicyAiProviderAvailabilityRecord[];readonly promotionPreview:PolicyAiPromotionPreviewRecord|null;readonly promotion:PolicyAiPromotionRecord|null}
export interface PolicyAiDataPort{load(caseId:string):Promise<PolicyAiWorkspaceRecord>;plan(caseId:string,providerId:PolicyAiProviderId,sources:readonly PolicyAiSourceSelectionRecord[],idempotencyKey:string):Promise<PolicyAiRunRecord>;start(caseId:string,run:PolicyAiRunRecord,idempotencyKey:string):Promise<PolicyAiRunRecord>;review(caseId:string,runId:string,candidateId:string,input:PolicyAiCandidateReviewInput,idempotencyKey:string):Promise<PolicyAiCandidateReviewRecord>;previewPromotion(caseId:string,runId:string):Promise<PolicyAiPromotionPreviewRecord>;promote(caseId:string,preview:PolicyAiPromotionPreviewRecord,idempotencyKey:string):Promise<PolicyAiPromotionRecord>}

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
