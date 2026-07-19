import { z } from 'zod'
import { failureEnvelopeSchema } from './common/envelope.js'
import { healthResponseSchema } from './health/index.js'
import { loginRequestSchema, sessionResponseSchema } from './v1/auth/index.js'
import { casesQuerySchema } from './v1/cases/query.js'
import { caseCreateRequestSchema, caseUpdateRequestSchema } from './v1/cases/commands.js'
import {
  caseDetailParamsSchema,
  caseDetailResponseSchema,
  caseListResponseSchema,
} from './v1/cases/dto.js'
import { auditEventsQuerySchema } from './v1/audit/query.js'
import { auditEventsResponseSchema } from './v1/audit/dto.js'
import { caseLocationAssignRequestSchema } from './v1/storage/commands.js'
import {
  caseLocationHistoryResponseSchema,
  caseLocationResponseSchema,
  storageRootsResponseSchema,
} from './v1/storage/dto.js'
import { registerDocumentRequestSchema, registerPhotoRequestSchema } from './v1/documents/commands.js'
import {
  documentDetailResponseSchema,
  documentsListResponseSchema,
  photosListResponseSchema,
} from './v1/documents/dto.js'
import { jobResultRequestSchema } from './v1/agent/commands.js'
import { agentRegisterResponseSchema, claimResponseSchema } from './v1/agent/dto.js'
import { documentRequirementsParamsSchema, documentRequirementsResponseSchema } from './v1/document-requirements/dto.js'
import {
  expertsReferenceResponseSchema,
  insurersReferenceResponseSchema,
  servicesReferenceResponseSchema,
  usersReferenceResponseSchema,
} from './v1/references/dto.js'
import { servicesReferenceQuerySchema } from './v1/references/query.js'
import { workspacePlanRequestSchema } from './v1/workspace/commands.js'
import { workspaceProvisioningResponseSchema } from './v1/workspace/dto.js'
import { fileOperationPlanRequestSchema } from './v1/file-operations/commands.js'
import { fileOperationResponseSchema } from './v1/file-operations/dto.js'
import { closePlanRequestSchema, reopenPlanRequestSchema } from './v1/case-lifecycle/commands.js'
import { caseLifecycleOperationResponseSchema } from './v1/case-lifecycle/dto.js'
import {
  policyAnalysisApprovalRequestSchema,
  policyAnalysisCreateRequestSchema,
  policyAnalysisVersionCreateRequestSchema,
  policyConflictResolutionRequestSchema,
  policyScenarioEvaluateRequestSchema,
} from './v1/policy-analysis/commands.js'
import {
  policyAnalysisResponseSchema,
  policyScenarioEvaluationResponseSchema,
} from './v1/policy-analysis/dto.js'
import {
  pdfTextExtractionCancelRequestSchema,
  pdfTextExtractionCreateRequestSchema,
  pdfTextSourceReferenceRequestSchema,
} from './v1/pdf-text-extractions/commands.js'
import {
  pdfExtractionChunkRequestSchema,
  pdfTextExtractionResponseSchema,
  pdfTextPagesResponseSchema,
  pdfTextSegmentsResponseSchema,
} from './v1/pdf-text-extractions/dto.js'
import {
  policyOcrRunCancelRequestSchema,
  policyOcrRunCreateRequestSchema,
  policyOcrRunRetryRequestSchema,
  policyOcrSourceReferenceRequestSchema,
} from './v1/policy-ocr/commands.js'
import {
  policyOcrChunkRequestSchema,
  policyOcrElementsResponseSchema,
  policyOcrPagesResponseSchema,
  policyOcrRunResponseSchema,
} from './v1/policy-ocr/dto.js'
import {policyAiCancelRequestSchema,policyAiCandidateReviewRequestSchema,policyAiPlanRequestSchema,policyAiPromotionRequestSchema,policyAiStartRequestSchema} from './v1/policy-ai/commands.js'
import {policyAiCandidateReviewResponseSchema,policyAiCandidatesResponseSchema,policyAiPromotionPreviewResponseSchema,policyAiPromotionResponseSchema,policyAiProviderOutputSchema,policyAiProvidersResponseSchema,policyAiRunResponseSchema,policyAiUsageResponseSchema} from './v1/policy-ai/dto.js'
import {
  trafficValueLossApproveRequestSchema,
  trafficValueLossRejectRequestSchema,
  trafficValueLossSubmitRequestSchema,
  trafficValueLossVersionCreateRequestSchema,
} from './v1/traffic-value-loss/commands.js'
import {
  trafficValueLossResponseSchema,
  trafficValueLossVersionsResponseSchema,
} from './v1/traffic-value-loss/dto.js'
import {
  trafficValueLossReportGenerateRequestSchema,
  trafficValueLossReportPreviewRequestSchema,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossReportResponseSchema,
  trafficValueLossReportsResponseSchema,
} from './v1/traffic-value-loss/report.js'
import { trafficValueLossClosureListResponseSchema } from './v1/traffic-value-loss/closure.js'
import { dashboardResponseSchema } from './v1/dashboard/dto.js'
import {
  caseNoteCreateRequestSchema,
  caseTaskCancelRequestSchema,
  caseTaskCompleteRequestSchema,
  caseTaskCreateRequestSchema,
} from './v1/case-operations/commands.js'
import {
  caseNoteResponseSchema,
  caseOperationsResponseSchema,
  caseTaskResponseSchema,
} from './v1/case-operations/dto.js'
import {
  closureFeeApproveRequestSchema,
  closureFeeCandidateCreateRequestSchema,
  closureFeeCorrectRequestSchema,
} from './v1/fees/commands.js'
import {
  caseClosureFeeResponseSchema,
  caseSummaryReportResponseSchema,
  closureFeeListResponseSchema,
} from './v1/fees/dto.js'
import {
  emailDraftCreateRequestSchema,
  emailDraftHandoffRequestSchema,
  emailDraftPreviewRequestSchema,
  emailDraftReviseRequestSchema,
} from './v1/email-drafts/commands.js'
import {
  emailDraftHandoffResponseSchema,
  emailDraftPreviewResponseSchema,
  emailDraftResponseSchema,
  emailDraftWorkspaceResponseSchema,
} from './v1/email-drafts/dto.js'
import {
  emailAiPlanRequestSchema,
  emailAiStartRequestSchema,
} from './v1/email-ai/commands.js'
import {
  emailAiPlanResponseSchema,
  emailAiRunResponseSchema,
  emailAiRunsResponseSchema,
} from './v1/email-ai/dto.js'
import {
  laborSheetCreateRequestSchema,
  laborSheetReviseRequestSchema,
} from './v1/labor/commands.js'
import {
  laborSheetResponseSchema,
  laborSheetWorkspaceResponseSchema,
} from './v1/labor/dto.js'
import {
  laborAiPlanRequestSchema,
  laborAiStartRequestSchema,
} from './v1/labor-ai/commands.js'
import {
  laborAiPlanResponseSchema,
  laborAiRunResponseSchema,
  laborAiRunsResponseSchema,
} from './v1/labor-ai/dto.js'
import {
  pertAssessmentCreateRequestSchema,
  pertAssessmentReviseRequestSchema,
} from './v1/pert/commands.js'
import {
  pertAssessmentResponseSchema,
  pertAssessmentWorkspaceResponseSchema,
} from './v1/pert/dto.js'
import {
  laborDictionaryQuerySchema,
  laborDictionaryResponseSchema,
} from './v1/labor-dictionary/dto.js'
import {
  operationalAlertsQuerySchema,
  operationalAlertsResponseSchema,
} from './v1/operational-alerts/dto.js'
import {
  caseVehicleProfileResponseSchema,
  caseVehicleProfileSaveRequestSchema,
} from './v1/case-vehicle-profile/dto.js'
import {
  laborExcelProfileSaveRequestSchema,
  laborExcelProfilesResponseSchema,
  laborExcelProjectionResponseSchema,
} from './v1/labor-excel-profile/dto.js'
import {
  laborAllocationAnalyzeRequestSchema,
  laborAllocationApplicationsResponseSchema,
  laborAllocationApplyPreviewRequestSchema,
  laborAllocationApplyPreviewResponseSchema,
  laborAllocationApplyRequestSchema,
  laborAllocationApplyResponseSchema,
  laborAllocationRunResponseSchema,
  laborAllocationWorkspaceResponseSchema,
} from './v1/labor-allocation-ai/dto.js'

/**
 * JSON Schema uretim hedefleri. Zod 4 yerlesik `z.toJSONSchema` ile uretilir;
 * ek OpenAPI bagimliligi yoktur.
 */
export const JSON_SCHEMA_TARGETS = {
  'health-response': healthResponseSchema,
  'failure-envelope': failureEnvelopeSchema,
  'auth-login-request': loginRequestSchema,
  'auth-session-response': sessionResponseSchema,
  'cases-query': casesQuerySchema,
  'case-create-request': caseCreateRequestSchema,
  'case-update-request': caseUpdateRequestSchema,
  'cases-list-response': caseListResponseSchema,
  'case-detail-params': caseDetailParamsSchema,
  'case-detail-response': caseDetailResponseSchema,
  'audit-events-query': auditEventsQuerySchema,
  'audit-events-response': auditEventsResponseSchema,
  'storage-roots-response': storageRootsResponseSchema,
  'case-location-assign-request': caseLocationAssignRequestSchema,
  'case-location-response': caseLocationResponseSchema,
  'case-location-history-response': caseLocationHistoryResponseSchema,
  'document-register-request': registerDocumentRequestSchema,
  'photo-register-request': registerPhotoRequestSchema,
  'documents-list-response': documentsListResponseSchema,
  'document-detail-response': documentDetailResponseSchema,
  'photos-list-response': photosListResponseSchema,
  'job-claim-response': claimResponseSchema,
  'job-result-request': jobResultRequestSchema,
  'agent-register-response': agentRegisterResponseSchema,
  'document-requirements-response': documentRequirementsResponseSchema,
  'document-requirements-params': documentRequirementsParamsSchema,
  'reference-insurers-response': insurersReferenceResponseSchema,
  'reference-services-response': servicesReferenceResponseSchema,
  'reference-services-query': servicesReferenceQuerySchema,
  'reference-users-response': usersReferenceResponseSchema,
  'reference-experts-response': expertsReferenceResponseSchema,
  'workspace-plan-request': workspacePlanRequestSchema,
  'workspace-provisioning-response': workspaceProvisioningResponseSchema,
  'file-operation-plan-request': fileOperationPlanRequestSchema,
  'file-operation-response': fileOperationResponseSchema,
  'case-close-plan-request': closePlanRequestSchema,
  'case-reopen-plan-request': reopenPlanRequestSchema,
  'case-lifecycle-operation-response': caseLifecycleOperationResponseSchema,
  'policy-analysis-create-request': policyAnalysisCreateRequestSchema,
  'policy-analysis-version-create-request': policyAnalysisVersionCreateRequestSchema,
  'policy-analysis-approval-request': policyAnalysisApprovalRequestSchema,
  'policy-analysis-response': policyAnalysisResponseSchema,
  'policy-conflict-resolution-request': policyConflictResolutionRequestSchema,
  'policy-scenario-evaluate-request': policyScenarioEvaluateRequestSchema,
  'policy-scenario-evaluation-response': policyScenarioEvaluationResponseSchema,
  'pdf-text-extraction-create-request': pdfTextExtractionCreateRequestSchema,
  'pdf-text-extraction-cancel-request': pdfTextExtractionCancelRequestSchema,
  'pdf-text-extraction-response': pdfTextExtractionResponseSchema,
  'pdf-text-pages-response': pdfTextPagesResponseSchema,
  'pdf-text-segments-response': pdfTextSegmentsResponseSchema,
  'pdf-text-source-reference-request': pdfTextSourceReferenceRequestSchema,
  'pdf-extraction-chunk-request': pdfExtractionChunkRequestSchema,
  'policy-ocr-run-create-request': policyOcrRunCreateRequestSchema,
  'policy-ocr-run-cancel-request': policyOcrRunCancelRequestSchema,
  'policy-ocr-run-retry-request': policyOcrRunRetryRequestSchema,
  'policy-ocr-run-response': policyOcrRunResponseSchema,
  'policy-ocr-pages-response': policyOcrPagesResponseSchema,
  'policy-ocr-elements-response': policyOcrElementsResponseSchema,
  'policy-ocr-source-reference-request': policyOcrSourceReferenceRequestSchema,
  'policy-ocr-chunk-request': policyOcrChunkRequestSchema,
  'policy-ai-plan-request': policyAiPlanRequestSchema,
  'policy-ai-start-request': policyAiStartRequestSchema,
  'policy-ai-cancel-request': policyAiCancelRequestSchema,
  'policy-ai-candidate-review-request': policyAiCandidateReviewRequestSchema,
  'policy-ai-candidate-review-response': policyAiCandidateReviewResponseSchema,
  'policy-ai-promotion-request': policyAiPromotionRequestSchema,
  'policy-ai-promotion-preview-response': policyAiPromotionPreviewResponseSchema,
  'policy-ai-promotion-response': policyAiPromotionResponseSchema,
  'policy-ai-provider-output': policyAiProviderOutputSchema,
  'policy-ai-providers-response': policyAiProvidersResponseSchema,
  'policy-ai-run-response': policyAiRunResponseSchema,
  'policy-ai-candidates-response': policyAiCandidatesResponseSchema,
  'policy-ai-usage-response': policyAiUsageResponseSchema,
  'traffic-value-loss-version-create-request': trafficValueLossVersionCreateRequestSchema,
  'traffic-value-loss-submit-request': trafficValueLossSubmitRequestSchema,
  'traffic-value-loss-approve-request': trafficValueLossApproveRequestSchema,
  'traffic-value-loss-reject-request': trafficValueLossRejectRequestSchema,
  'traffic-value-loss-response': trafficValueLossResponseSchema,
  'traffic-value-loss-versions-response': trafficValueLossVersionsResponseSchema,
  'traffic-value-loss-report-preview-request': trafficValueLossReportPreviewRequestSchema,
  'traffic-value-loss-report-generate-request': trafficValueLossReportGenerateRequestSchema,
  'traffic-value-loss-report-preview-response': trafficValueLossReportPreviewResponseSchema,
  'traffic-value-loss-report-response': trafficValueLossReportResponseSchema,
  'traffic-value-loss-reports-response': trafficValueLossReportsResponseSchema,
  'traffic-value-loss-closure-list-response': trafficValueLossClosureListResponseSchema,
  'dashboard-response': dashboardResponseSchema,
  'case-operations-response': caseOperationsResponseSchema,
  'case-note-create-request': caseNoteCreateRequestSchema,
  'case-note-response': caseNoteResponseSchema,
  'case-task-create-request': caseTaskCreateRequestSchema,
  'case-task-complete-request': caseTaskCompleteRequestSchema,
  'case-task-cancel-request': caseTaskCancelRequestSchema,
  'case-task-response': caseTaskResponseSchema,
  'closure-fee-candidate-create-request': closureFeeCandidateCreateRequestSchema,
  'closure-fee-approve-request': closureFeeApproveRequestSchema,
  'closure-fee-correct-request': closureFeeCorrectRequestSchema,
  'case-closure-fee-response': caseClosureFeeResponseSchema,
  'closure-fees-list-response': closureFeeListResponseSchema,
  'case-summary-report-response': caseSummaryReportResponseSchema,
  'email-draft-preview-request': emailDraftPreviewRequestSchema,
  'email-draft-preview-response': emailDraftPreviewResponseSchema,
  'email-draft-create-request': emailDraftCreateRequestSchema,
  'email-draft-revise-request': emailDraftReviseRequestSchema,
  'email-draft-handoff-request': emailDraftHandoffRequestSchema,
  'email-draft-response': emailDraftResponseSchema,
  'email-draft-handoff-response': emailDraftHandoffResponseSchema,
  'email-draft-workspace-response': emailDraftWorkspaceResponseSchema,
  'email-ai-plan-request': emailAiPlanRequestSchema,
  'email-ai-start-request': emailAiStartRequestSchema,
  'email-ai-plan-response': emailAiPlanResponseSchema,
  'email-ai-run-response': emailAiRunResponseSchema,
  'email-ai-runs-response': emailAiRunsResponseSchema,
  'labor-sheet-create-request': laborSheetCreateRequestSchema,
  'labor-sheet-revise-request': laborSheetReviseRequestSchema,
  'labor-sheet-response': laborSheetResponseSchema,
  'labor-sheet-workspace-response': laborSheetWorkspaceResponseSchema,
  'labor-ai-plan-request': laborAiPlanRequestSchema,
  'labor-ai-start-request': laborAiStartRequestSchema,
  'labor-ai-plan-response': laborAiPlanResponseSchema,
  'labor-ai-run-response': laborAiRunResponseSchema,
  'labor-ai-runs-response': laborAiRunsResponseSchema,
  'pert-assessment-create-request': pertAssessmentCreateRequestSchema,
  'pert-assessment-revise-request': pertAssessmentReviseRequestSchema,
  'pert-assessment-response': pertAssessmentResponseSchema,
  'pert-assessment-workspace-response': pertAssessmentWorkspaceResponseSchema,
  'labor-excel-profile-save-request': laborExcelProfileSaveRequestSchema,
  'labor-excel-profiles-response': laborExcelProfilesResponseSchema,
  'labor-excel-projection-response': laborExcelProjectionResponseSchema,
  'labor-dictionary-query': laborDictionaryQuerySchema,
  'labor-dictionary-response': laborDictionaryResponseSchema,
  'case-vehicle-profile-response': caseVehicleProfileResponseSchema,
  'case-vehicle-profile-save-request': caseVehicleProfileSaveRequestSchema,
  'labor-allocation-analyze-request': laborAllocationAnalyzeRequestSchema,
  'labor-allocation-applications-response': laborAllocationApplicationsResponseSchema,
  'labor-allocation-apply-preview-request': laborAllocationApplyPreviewRequestSchema,
  'labor-allocation-apply-preview-response': laborAllocationApplyPreviewResponseSchema,
  'labor-allocation-apply-request': laborAllocationApplyRequestSchema,
  'labor-allocation-apply-response': laborAllocationApplyResponseSchema,
  'labor-allocation-run-response': laborAllocationRunResponseSchema,
  'labor-allocation-workspace-response': laborAllocationWorkspaceResponseSchema,
  'operational-alerts-query': operationalAlertsQuerySchema,
  'operational-alerts-response': operationalAlertsResponseSchema,
} as const

export type JsonSchemaName = keyof typeof JSON_SCHEMA_TARGETS

/**
 * Butun hedef semalarin JSON Schema karsiligini deterministik (ada gore sirali)
 * uretir. Ayni girdi icin cikti her zaman ayni olur.
 */
export function buildJsonSchemas(): Record<JsonSchemaName, unknown> {
  const names = (Object.keys(JSON_SCHEMA_TARGETS) as JsonSchemaName[]).sort()
  const output = {} as Record<JsonSchemaName, unknown>
  for (const name of names) {
    output[name] = z.toJSONSchema(JSON_SCHEMA_TARGETS[name])
  }
  return output
}
