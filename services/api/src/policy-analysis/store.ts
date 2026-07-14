import { createHash } from 'node:crypto'
import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import {
  POLICY_SCENARIO_RULE_VERSION,
  evaluatePolicyScenario,
  type PolicyConflictFact,
  type PolicyDeductible,
  type PolicyScenarioRule,
  type PolicySourceReference,
  type ServiceType,
} from '@hasarbotu/domain'
import {
  policyAnalysisDetailSchema,
  policyAnalysisSummarySchema,
  policyAnalysisVersionSchema,
  policyConflictSchema,
  policyScenarioEvaluationSchema,
  type PolicyAnalysisApprovalRequest,
  type PolicyAnalysisCreateRequest,
  type PolicyAnalysisDetailDto,
  type PolicyAnalysisRejectRequest,
  type PolicyAnalysisSummaryDto,
  type PolicyAnalysisVersionCreateRequest,
  type PolicyAnalysisVersionDto,
  type PolicyConflictDto,
  type PolicyConflictResolutionRequest,
  type PolicyScenarioEvaluateRequest,
  type PolicyScenarioEvaluationDto,
} from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction, type Queryable } from '../db/executor.js'
import { loadServiceProfile } from '../service-agreements/service.js'

interface ActorContext { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string; readonly caseId: string }
interface IdempotencyContext { readonly scope: string; readonly key: string; readonly requestHash: string }
interface CommandResult<T> { readonly replay: boolean; readonly status: number; readonly body: T | unknown }
type ActorBase = Omit<ActorContext, 'caseId'>

interface PolicyAnalysisStore {
  list(organizationId: string, caseId: string): Promise<readonly PolicyAnalysisSummaryDto[] | undefined>
  find(organizationId: string, caseId: string, analysisId: string): Promise<PolicyAnalysisDetailDto | undefined>
  versions(organizationId: string, caseId: string, analysisId: string): Promise<readonly PolicyAnalysisVersionDto[] | undefined>
  conflicts(organizationId: string, caseId: string): Promise<readonly PolicyConflictDto[] | undefined>
  create(actor: ActorBase, caseId: string, input: PolicyAnalysisCreateRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly analysis: PolicyAnalysisDetailDto }>>
  createVersion(actor: ActorBase, caseId: string, analysisId: string, input: PolicyAnalysisVersionCreateRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly analysis: PolicyAnalysisDetailDto }>>
  approve(actor: ActorBase, caseId: string, analysisId: string, input: PolicyAnalysisApprovalRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly analysis: PolicyAnalysisDetailDto }>>
  reject(actor: ActorBase, caseId: string, analysisId: string, input: PolicyAnalysisRejectRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly analysis: PolicyAnalysisDetailDto }>>
  resolveConflict(actor: ActorBase, caseId: string, conflictId: string, input: PolicyConflictResolutionRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly analysis: PolicyAnalysisDetailDto }>>
  evaluate(actor: ActorBase, caseId: string, input: PolicyScenarioEvaluateRequest, idem: IdempotencyContext): Promise<CommandResult<{ readonly evaluation: PolicyScenarioEvaluationDto }>>
}

export type PolicyStoreErrorCode =
  | 'not_found' | 'wrong_case_type' | 'invalid_source' | 'invalid_insurer'
  | 'version_conflict' | 'state_conflict' | 'conflict_open' | 'idempotency_conflict'

export class PolicyStoreError extends Error {
  constructor(readonly code: PolicyStoreErrorCode) { super(code) }
}

function localDate(value: Date | string | null): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
function numeric(value: string | number | null): number | null { return value === null ? null : Number(value) }
function normalizeExcerpt(value: string): string { return value.trim().replace(/\s+/g, ' ') }
function excerptHash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

interface AnalysisRow {
  id: string; case_id: string; insurer_id: string | null; source_document_id: string; source_document_version_id: string
  current_version_id: string; version: number; created_at: Date; updated_at: Date
  analysis_version: number; analysis_status: PolicyAnalysisSummaryDto['currentStatus']
}

function summary(row: AnalysisRow): PolicyAnalysisSummaryDto {
  return policyAnalysisSummarySchema.parse({
    id: row.id, caseId: row.case_id, insurerId: row.insurer_id,
    sourceDocumentId: row.source_document_id, sourceDocumentVersionId: row.source_document_version_id,
    currentAnalysisVersion: row.analysis_version, currentStatus: row.analysis_status,
    version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  })
}

const ANALYSIS_SELECT = `SELECT a.id,a.case_id,a.insurer_id,a.source_document_id,a.source_document_version_id,
  a.current_version_id,a.version,a.created_at,a.updated_at,v.analysis_version,v.analysis_status
  FROM policy_analyses a JOIN policy_analysis_versions v ON v.id=a.current_version_id`

async function loadVersion(exec: Queryable, organizationId: string, caseId: string, versionId: string): Promise<PolicyAnalysisVersionDto | undefined> {
  const versionResult = await exec.query(
    `SELECT * FROM policy_analysis_versions WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
    [organizationId, caseId, versionId],
  )
  const version = versionResult.rows[0] as Record<string, unknown> | undefined
  if (version === undefined) return undefined
  // PoolClient tek bağlantıdır; aynı istemcide paralel query pg@9'da kaldırılacağı
  // için transaction içinde bu okumalar bilinçli olarak sıralıdır.
  const sourcesResult = await exec.query('SELECT * FROM policy_source_references WHERE analysis_version_id=$1 ORDER BY page_number,id', [versionId])
  const coverageResult = await exec.query('SELECT * FROM policy_coverages WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const deductibleResult = await exec.query('SELECT * FROM policy_deductibles WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const serviceResult = await exec.query('SELECT * FROM policy_service_rules WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const partResult = await exec.query('SELECT * FROM policy_part_rules WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const replacementResult = await exec.query('SELECT * FROM policy_replacement_vehicle_rules WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const exclusionResult = await exec.query('SELECT * FROM policy_exclusions WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const requiredResult = await exec.query('SELECT * FROM policy_required_documents WHERE analysis_version_id=$1 ORDER BY code,id', [versionId])
  const scenarioResult = await exec.query('SELECT * FROM policy_scenario_rules WHERE analysis_version_id=$1 ORDER BY precedence DESC,rule_id', [versionId])
  const evidenceResult = await exec.query('SELECT owner_type,owner_id,source_reference_id FROM policy_evidence_links WHERE analysis_version_id=$1 ORDER BY source_reference_id', [versionId])
  const conflictResult = await exec.query('SELECT * FROM policy_conflicts WHERE analysis_version_id=$1 ORDER BY created_at,id', [versionId])
  const evidence = new Map<string, string[]>()
  for (const row of evidenceResult.rows as Array<{ owner_type: string; owner_id: string; source_reference_id: string }>) {
    const key = `${row.owner_type}:${row.owner_id}`; const values = evidence.get(key) ?? []
    values.push(row.source_reference_id); evidence.set(key, values)
  }
  const refs = sourcesResult.rows.map((row: Record<string, unknown>) => ({
    id: row.id, documentId: row.document_id, documentVersionId: row.document_version_id,
    pageNumber: row.page_number, sectionHeading: row.section_heading, clauseIdentifier: row.clause_identifier,
    rawExcerpt: row.raw_excerpt, excerptHash: row.excerpt_hash, locator: row.locator,
    sourceType: row.source_type, confidence: Number(row.confidence),
    extractionLocator: row.text_extraction_id === null ? null : {
      extractionId: row.text_extraction_id,
      pageId: row.text_page_id,
      segmentId: row.text_segment_id,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
    },
  }))
  const ids = (type: string, id: unknown) => evidence.get(`${type}:${String(id)}`) ?? []
  return policyAnalysisVersionSchema.parse({
    id: version.id, analysisVersion: version.analysis_version, analysisStatus: version.analysis_status,
    sourceDocumentId: version.source_document_id, sourceDocumentVersionId: version.source_document_version_id,
    policyNumber: version.policy_number, endorsementNumber: version.endorsement_number, productName: version.product_name,
    productType: version.product_type, insurerFormat: version.insurer_format,
    policyStartDate: localDate(version.policy_start_date as Date | string | null),
    policyEndDate: localDate(version.policy_end_date as Date | string | null), issueDate: localDate(version.issue_date as Date | string | null),
    insuredVehicleReference: version.insured_vehicle_reference, sourceCompleteness: version.source_completeness,
    humanApprovalStatus: version.human_approval_status, approvedBy: version.approved_by_user_id,
    approvedAt: version.approved_at instanceof Date ? version.approved_at.toISOString() : version.approved_at,
    isActive: version.is_active, version: version.version,
    createdAt: (version.created_at as Date).toISOString(), sourceReferences: refs,
    coverages: coverageResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, canonicalType: row.canonical_type, originalHeading: row.original_heading,
      originalWording: row.original_wording, inclusion: row.inclusion, limit: row.limit_data,
      conditions: row.conditions, exceptions: row.exceptions, requiredDocuments: row.required_documents,
      sourceReferenceIds: ids('coverage', row.id), confidence: Number(row.confidence),
    })),
    deductibles: deductibleResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, type: row.deductible_type, trigger: row.trigger_text, conditions: row.conditions,
      calculationType: row.calculation_type, fixedAmount: numeric(row.fixed_amount as string | number | null),
      percentage: numeric(row.percentage as string | number | null), minimumAmount: numeric(row.minimum_amount as string | number | null),
      maximumAmount: numeric(row.maximum_amount as string | number | null), insurerShare: numeric(row.insurer_share as string | number | null),
      insuredShare: numeric(row.insured_share as string | number | null), affectedCoverage: row.affected_coverage,
      affectedRepairMethod: row.affected_repair_method, affectedServiceType: row.affected_service_type,
      affectedPartRule: row.affected_part_rule, exception: row.exception_text,
      sourceReferenceIds: ids('deductible', row.id), confidence: Number(row.confidence), approvalStatus: row.approval_status,
    })),
    serviceRules: serviceResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, authorizedServiceRequirement: row.authorized_service_requirement,
      insurerContractedServiceRequirement: row.insurer_contracted_service_requirement, serviceFreedom: row.service_freedom,
      glassNetwork: row.glass_network, mobileRepairRestriction: row.mobile_repair_restriction,
      miniRepairRestriction: row.mini_repair_restriction, towingDestination: row.towing_destination,
      laborRestriction: row.labor_restriction, condition: row.condition_text,
      sourceReferenceIds: ids('service_rule', row.id), confidence: Number(row.confidence),
    })),
    partRules: partResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, allowedPartTypes: row.allowed_part_types, procurementRule: row.procurement_rule,
      repairVsReplacementCondition: row.repair_vs_replacement_condition, bettermentCondition: row.betterment_condition,
      condition: row.condition_text, sourceReferenceIds: ids('part_rule', row.id), confidence: Number(row.confidence),
    })),
    replacementVehicleRules: replacementResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, available: row.available, vehicleClass: row.vehicle_class, duration: row.duration_text,
      maximumDays: row.maximum_days, eventLimit: row.event_limit, waitingPeriodDays: row.waiting_period_days,
      serviceCondition: row.service_condition, exclusions: row.exclusions,
      sourceReferenceIds: ids('replacement_vehicle_rule', row.id), confidence: Number(row.confidence),
    })),
    exclusions: exclusionResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, originalWording: row.original_wording, trigger: row.trigger_text,
      affectedCoverage: row.affected_coverage, exceptionToExclusion: row.exception_to_exclusion,
      requiredDocuments: row.required_documents, sourceReferenceIds: ids('exclusion', row.id), confidence: Number(row.confidence),
    })),
    requiredDocuments: requiredResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, code: row.code, description: row.description, trigger: row.trigger_text,
      sourceReferenceIds: ids('required_document', row.id),
    })),
    scenarioRules: scenarioResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id, ruleId: row.rule_id, ruleVersion: row.rule_version, scenarioType: row.scenario_type,
      trigger: row.trigger_text, conditions: row.conditions, coverageOutcome: row.coverage_outcome,
      coverageCode: row.coverage_code, deductibleCodes: row.deductible_codes, limit: row.limit_text,
      exception: row.exception_text, requiredDocuments: row.required_documents, serviceCondition: row.service_condition,
      partCondition: row.part_condition, action: row.action_text, sourceReferenceIds: ids('scenario_rule', row.id),
      confidence: Number(row.confidence), humanApprovalRequired: row.human_approval_required, precedence: row.precedence,
      effectiveFrom: localDate(row.effective_from as Date | string | null), effectiveTo: localDate(row.effective_to as Date | string | null),
    })),
    conflicts: conflictResult.rows.map((row: Record<string, unknown>) => policyConflictSchema.parse({
      id: row.id, conflictType: row.conflict_type, affectedTopic: row.affected_topic,
      sourceAId: row.source_a_id, sourceBId: row.source_b_id, explanation: row.explanation,
      severity: row.severity, resolutionStatus: row.resolution_status, resolvedBy: row.resolved_by_user_id,
      resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at,
      resolutionReason: row.resolution_reason, version: row.version,
    })),
  })
}

async function loadDetail(exec: Queryable, organizationId: string, caseId: string, analysisId: string): Promise<PolicyAnalysisDetailDto | undefined> {
  const result = await exec.query(`${ANALYSIS_SELECT} WHERE a.organization_id=$1 AND a.case_id=$2 AND a.id=$3`, [organizationId, caseId, analysisId])
  const row = result.rows[0] as AnalysisRow | undefined
  if (row === undefined) return undefined
  const currentVersion = await loadVersion(exec, organizationId, caseId, row.current_version_id)
  return currentVersion === undefined ? undefined : policyAnalysisDetailSchema.parse({ ...summary(row), currentVersion })
}

async function validateSource(exec: Queryable, organizationId: string, caseId: string, documentId: string, documentVersionId: string, requirePolicy: boolean): Promise<void> {
  const result = await exec.query(
    `SELECT c.case_type,d.document_type FROM cases c
     JOIN documents d ON d.organization_id=c.organization_id AND d.case_id=c.id
     JOIN document_versions dv ON dv.document_id=d.id AND dv.organization_id=d.organization_id AND dv.case_id=d.case_id
     WHERE c.organization_id=$1 AND c.id=$2 AND d.id=$3 AND dv.id=$4
       AND dv.status='ready' AND dv.hash_verified=true AND dv.size_verified=true AND dv.verified_at IS NOT NULL`,
    [organizationId, caseId, documentId, documentVersionId],
  )
  const row = result.rows[0] as { case_type: string; document_type: string } | undefined
  if (row === undefined) throw new PolicyStoreError('invalid_source')
  if (row.case_type !== 'casco') throw new PolicyStoreError('wrong_case_type')
  if (requirePolicy && row.document_type !== 'casco_policy') throw new PolicyStoreError('invalid_source')
}

async function validatePayloadSources(exec: Queryable, organizationId: string, caseId: string, input: PolicyAnalysisCreateRequest): Promise<void> {
  await validateSource(exec, organizationId, caseId, input.sourceDocumentId, input.sourceDocumentVersionId, true)
  for (const source of input.sourceReferences) {
    await validateSource(exec, organizationId, caseId, source.documentId, source.documentVersionId, false)
    if (source.extractionLocator !== null) {
      const locator = source.extractionLocator
      const selected = await exec.query(
        `SELECT p.normalized_text,p.page_number,s.start_offset segment_start,s.end_offset segment_end
         FROM document_text_extractions e JOIN document_text_extraction_pages p ON p.extraction_id=e.id
         LEFT JOIN document_text_extraction_segments s ON s.id=$6
         WHERE e.organization_id=$1 AND e.case_id=$2 AND e.id=$3 AND e.document_version_id=$4
           AND p.id=$5 AND p.extraction_id=e.id AND p.status='text' AND e.status IN ('ready','partial')
           AND ($6::uuid IS NULL OR (s.page_id=p.id AND s.extraction_id=e.id))`,
        [organizationId, caseId, locator.extractionId, source.documentVersionId, locator.pageId, locator.segmentId],
      )
      const row = selected.rows[0] as { normalized_text:string;page_number:number;segment_start:number|null;segment_end:number|null }|undefined
      const excerpt = row === undefined ? '' : Array.from(row.normalized_text).slice(locator.startOffset, locator.endOffset).join('')
      if (row === undefined || row.page_number !== source.pageNumber || locator.endOffset > Array.from(row.normalized_text).length
        || (locator.segmentId !== null && (row.segment_start === null || row.segment_start > locator.startOffset || row.segment_end! < locator.endOffset))
        || excerpt !== normalizeExcerpt(source.rawExcerpt)) throw new PolicyStoreError('invalid_source')
    }
  }
  if (input.insurerId !== null) {
    const insurer = await exec.query('SELECT 1 FROM insurers WHERE organization_id=$1 AND id=$2', [organizationId, input.insurerId])
    if ((insurer.rowCount ?? 0) === 0) throw new PolicyStoreError('invalid_insurer')
  }
}

type VersionPayload = PolicyAnalysisCreateRequest | Omit<PolicyAnalysisVersionCreateRequest, 'expectedVersion'>
async function insertVersion(exec: pg.PoolClient, actor: ActorContext, analysisId: string, analysisVersion: number, input: VersionPayload): Promise<string> {
  const versionId = uuidv7()
  const status = input.conflicts.length > 0 ? 'conflict_detected' : input.sourceCompleteness !== 'complete' ? 'control_required' : input.initialStatus
  await exec.query(
    `INSERT INTO policy_analysis_versions
     (id,organization_id,case_id,analysis_id,source_document_id,source_document_version_id,analysis_version,analysis_status,
      policy_number,endorsement_number,product_name,product_type,insurer_format,policy_start_date,policy_end_date,issue_date,
      insured_vehicle_reference,source_completeness,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [versionId, actor.organizationId, actor.caseId, analysisId, input.sourceDocumentId, input.sourceDocumentVersionId,
      analysisVersion, status, input.policyNumber, input.endorsementNumber, input.productName, input.productType,
      input.insurerFormat, input.policyStartDate, input.policyEndDate, input.issueDate, input.insuredVehicleReference,
      input.sourceCompleteness, actor.actorUserId],
  )
  const sourceIds = new Map<string, string>()
  for (const source of input.sourceReferences) {
    const id = uuidv7(); const excerpt = normalizeExcerpt(source.rawExcerpt); sourceIds.set(source.sourceKey, id)
    await exec.query(
      `INSERT INTO policy_source_references
       (id,organization_id,case_id,analysis_version_id,document_id,document_version_id,page_number,section_heading,
        clause_identifier,raw_excerpt,excerpt_hash,locator,source_type,confidence,text_extraction_id,text_page_id,text_segment_id,start_offset,end_offset)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, actor.organizationId, actor.caseId, versionId, source.documentId, source.documentVersionId,
        source.pageNumber, source.sectionHeading.trim(), source.clauseIdentifier.trim(), excerpt, excerptHash(excerpt),
        source.locator, source.sourceType, source.confidence, source.extractionLocator?.extractionId ?? null,
        source.extractionLocator?.pageId ?? null, source.extractionLocator?.segmentId ?? null,
        source.extractionLocator?.startOffset ?? null, source.extractionLocator?.endOffset ?? null],
    )
  }
  const link = async (ownerType: string, ownerId: string, keys: readonly string[]) => {
    for (const key of keys) await exec.query(
      `INSERT INTO policy_evidence_links (id,organization_id,case_id,analysis_version_id,owner_type,owner_id,source_reference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv7(), actor.organizationId, actor.caseId, versionId, ownerType, ownerId, sourceIds.get(key)],
    )
  }
  for (const item of input.coverages) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_coverages
      (id,organization_id,case_id,analysis_version_id,code,canonical_type,original_heading,original_wording,inclusion,limit_data,conditions,exceptions,required_documents,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.canonicalType,item.originalHeading,item.originalWording,item.inclusion,item.limit===null?null:JSON.stringify(item.limit),JSON.stringify(item.conditions),JSON.stringify(item.exceptions),JSON.stringify(item.requiredDocuments),item.confidence]); await link('coverage',id,item.sourceKeys)
  }
  for (const item of input.deductibles) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_deductibles
      (id,organization_id,case_id,analysis_version_id,code,deductible_type,trigger_text,conditions,calculation_type,fixed_amount,percentage,minimum_amount,maximum_amount,insurer_share,insured_share,affected_coverage,affected_repair_method,affected_service_type,affected_part_rule,exception_text,confidence,approval_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.type,item.trigger,JSON.stringify(item.conditions),item.calculationType,item.fixedAmount,item.percentage,item.minimumAmount,item.maximumAmount,item.insurerShare,item.insuredShare,item.affectedCoverage,item.affectedRepairMethod,item.affectedServiceType,item.affectedPartRule,item.exception,item.confidence,item.approvalStatus]); await link('deductible',id,item.sourceKeys)
  }
  for (const item of input.serviceRules) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_service_rules
      (id,organization_id,case_id,analysis_version_id,code,authorized_service_requirement,insurer_contracted_service_requirement,service_freedom,glass_network,mobile_repair_restriction,mini_repair_restriction,towing_destination,labor_restriction,condition_text,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.authorizedServiceRequirement,item.insurerContractedServiceRequirement,item.serviceFreedom,item.glassNetwork,item.mobileRepairRestriction,item.miniRepairRestriction,item.towingDestination,item.laborRestriction,item.condition,item.confidence]); await link('service_rule',id,item.sourceKeys)
  }
  for (const item of input.partRules) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_part_rules
      (id,organization_id,case_id,analysis_version_id,code,allowed_part_types,procurement_rule,repair_vs_replacement_condition,betterment_condition,condition_text,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.allowedPartTypes,item.procurementRule,item.repairVsReplacementCondition,item.bettermentCondition,item.condition,item.confidence]); await link('part_rule',id,item.sourceKeys)
  }
  for (const item of input.replacementVehicleRules) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_replacement_vehicle_rules
      (id,organization_id,case_id,analysis_version_id,code,available,vehicle_class,duration_text,maximum_days,event_limit,waiting_period_days,service_condition,exclusions,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.available,item.vehicleClass,item.duration,item.maximumDays,item.eventLimit,item.waitingPeriodDays,item.serviceCondition,JSON.stringify(item.exclusions),item.confidence]); await link('replacement_vehicle_rule',id,item.sourceKeys)
  }
  for (const item of input.exclusions) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_exclusions
      (id,organization_id,case_id,analysis_version_id,code,original_wording,trigger_text,affected_coverage,exception_to_exclusion,required_documents,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.originalWording,item.trigger,item.affectedCoverage,item.exceptionToExclusion,JSON.stringify(item.requiredDocuments),item.confidence]); await link('exclusion',id,item.sourceKeys)
  }
  for (const item of input.requiredDocuments) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_required_documents
      (id,organization_id,case_id,analysis_version_id,code,description,trigger_text) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id,actor.organizationId,actor.caseId,versionId,item.code,item.description,item.trigger]); await link('required_document',id,item.sourceKeys)
  }
  for (const item of input.scenarioRules) {
    const id=uuidv7(); await exec.query(`INSERT INTO policy_scenario_rules
      (id,organization_id,case_id,analysis_version_id,rule_id,rule_version,scenario_type,trigger_text,conditions,coverage_outcome,coverage_code,deductible_codes,limit_text,exception_text,required_documents,service_condition,part_condition,action_text,confidence,human_approval_required,precedence,effective_from,effective_to)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [id,actor.organizationId,actor.caseId,versionId,item.ruleId,item.ruleVersion,item.scenarioType,item.trigger,JSON.stringify(item.conditions),item.coverageOutcome,item.coverageCode,item.deductibleCodes,item.limit,item.exception,item.requiredDocuments,item.serviceCondition,item.partCondition,item.action,item.confidence,item.humanApprovalRequired,item.precedence,item.effectiveFrom,item.effectiveTo]); await link('scenario_rule',id,item.sourceKeys)
  }
  for (const item of input.conflicts) await exec.query(`INSERT INTO policy_conflicts
    (id,organization_id,case_id,analysis_id,analysis_version_id,conflict_type,affected_topic,source_a_id,source_b_id,explanation,severity)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [uuidv7(),actor.organizationId,actor.caseId,analysisId,versionId,item.conflictType,item.affectedTopic,sourceIds.get(item.sourceAKey),sourceIds.get(item.sourceBKey),item.explanation,item.severity])
  return versionId
}

async function idempotentWrite<T>(pool: pg.Pool, actor: ActorContext, idem: IdempotencyContext, status: number,
  work: (client: pg.PoolClient) => Promise<T>): Promise<CommandResult<T>> {
  const existing = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
  if (existing !== undefined) {
    if (existing.requestHash !== idem.requestHash) throw new PolicyStoreError('idempotency_conflict')
    return { replay: true, status: existing.responseStatus, body: existing.responseBody }
  }
  return withTransaction(pool, async (client) => {
    const raced = await findIdempotent(client, actor.organizationId, idem.scope, idem.key)
    if (raced !== undefined) {
      if (raced.requestHash !== idem.requestHash) throw new PolicyStoreError('idempotency_conflict')
      return { replay: true, status: raced.responseStatus, body: raced.responseBody }
    }
    const body = await work(client)
    await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
      requestHash: idem.requestHash, responseStatus: status, responseBody: body, caseId: actor.caseId })
    return { replay: false, status, body }
  })
}

export function createPolicyAnalysisStore(pool: pg.Pool): PolicyAnalysisStore {
  const audit = createAuditService()
  return {
    async list(organizationId: string, caseId: string): Promise<readonly PolicyAnalysisSummaryDto[] | undefined> {
      const caseResult = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2', [organizationId, caseId])
      if ((caseResult.rowCount ?? 0) === 0) return undefined
      const result = await pool.query(`${ANALYSIS_SELECT} WHERE a.organization_id=$1 AND a.case_id=$2 ORDER BY a.updated_at DESC,a.id`, [organizationId, caseId])
      return (result.rows as AnalysisRow[]).map(summary)
    },
    find: (organizationId: string, caseId: string, analysisId: string) => loadDetail(pool, organizationId, caseId, analysisId),
    async versions(organizationId: string, caseId: string, analysisId: string): Promise<readonly PolicyAnalysisVersionDto[] | undefined> {
      const rows = await pool.query('SELECT id FROM policy_analysis_versions WHERE organization_id=$1 AND case_id=$2 AND analysis_id=$3 ORDER BY analysis_version DESC', [organizationId, caseId, analysisId])
      if (rows.rows.length === 0) return undefined
      return Promise.all((rows.rows as Array<{ id: string }>).map((row) => loadVersion(pool, organizationId, caseId, row.id) as Promise<PolicyAnalysisVersionDto>))
    },
    async conflicts(organizationId: string, caseId: string): Promise<readonly PolicyConflictDto[] | undefined> {
      const exists = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2', [organizationId, caseId])
      if ((exists.rowCount ?? 0) === 0) return undefined
      const rows = await pool.query('SELECT * FROM policy_conflicts WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id', [organizationId, caseId])
      return rows.rows.map((row: Record<string, unknown>) => policyConflictSchema.parse({ id:row.id,conflictType:row.conflict_type,
        affectedTopic:row.affected_topic,sourceAId:row.source_a_id,sourceBId:row.source_b_id,explanation:row.explanation,
        severity:row.severity,resolutionStatus:row.resolution_status,resolvedBy:row.resolved_by_user_id,
        resolvedAt:row.resolved_at instanceof Date?row.resolved_at.toISOString():row.resolved_at,resolutionReason:row.resolution_reason,version:row.version }))
    },
    async create(actorBase: Omit<ActorContext,'caseId'>, caseId: string, input: PolicyAnalysisCreateRequest, idem: IdempotencyContext) {
      const actor = { ...actorBase, caseId }
      return idempotentWrite(pool, actor, idem, 201, async (client) => {
        await validatePayloadSources(client, actor.organizationId, caseId, input)
        const analysisId=uuidv7()
        await client.query(`INSERT INTO policy_analyses
          (id,organization_id,case_id,insurer_id,source_document_id,source_document_version_id,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [analysisId,actor.organizationId,caseId,input.insurerId,input.sourceDocumentId,input.sourceDocumentVersionId,actor.actorUserId])
        const versionId=await insertVersion(client,actor,analysisId,1,input)
        await client.query('UPDATE policy_analyses SET current_version_id=$1 WHERE id=$2',[versionId,analysisId])
        const detail=await loadDetail(client,actor.organizationId,caseId,analysisId)
        if (detail===undefined) throw new PolicyStoreError('not_found')
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_analysis.created',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,
          details:{caseId,analysisVersion:1,sourceDocumentId:input.sourceDocumentId,sourceDocumentVersionId:input.sourceDocumentVersionId,sourceReferenceCount:input.sourceReferences.length,conflictCount:input.conflicts.length,status:detail.currentStatus}})
        if(detail.currentStatus==='control_required'||detail.currentStatus==='conflict_detected') await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,
          action:detail.currentStatus==='conflict_detected'?'policy_analysis.conflict_detected':'policy_analysis.control_required',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,
          details:{caseId,analysisVersion:1,sourceReferenceCount:input.sourceReferences.length,conflictCount:input.conflicts.length}})
        return {analysis:detail}
      })
    },
    async createVersion(actorBase: Omit<ActorContext,'caseId'>, caseId:string, analysisId:string, input:PolicyAnalysisVersionCreateRequest, idem:IdempotencyContext){
      const actor={...actorBase,caseId}
      return idempotentWrite(pool,actor,idem,201,async(client)=>{
        const locked=await client.query('SELECT * FROM policy_analyses WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',[actor.organizationId,caseId,analysisId])
        const row=locked.rows[0] as {version:number;current_version_id:string}|undefined
        if(row===undefined) throw new PolicyStoreError('not_found'); if(row.version!==input.expectedVersion) throw new PolicyStoreError('version_conflict')
        await validatePayloadSources(client,actor.organizationId,caseId,input)
        const max=await client.query('SELECT max(analysis_version)::int AS n FROM policy_analysis_versions WHERE analysis_id=$1',[analysisId])
        const next=(max.rows[0] as {n:number}).n+1
        const previous=await client.query('SELECT analysis_status,is_active FROM policy_analysis_versions WHERE id=$1',[row.current_version_id])
        const previousState=previous.rows[0] as {analysis_status:string;is_active:boolean}
        if(previousState.analysis_status==='approved') await client.query("UPDATE policy_analysis_versions SET analysis_status='superseded',is_active=false WHERE id=$1",[row.current_version_id])
        const versionId=await insertVersion(client,actor,analysisId,next,input)
        await client.query(`UPDATE policy_analyses SET insurer_id=$1,source_document_id=$2,source_document_version_id=$3,current_version_id=$4,version=version+1,updated_at=now() WHERE id=$5`,
          [input.insurerId,input.sourceDocumentId,input.sourceDocumentVersionId,versionId,analysisId])
        const detail=await loadDetail(client,actor.organizationId,caseId,analysisId); if(detail===undefined) throw new PolicyStoreError('not_found')
        if(previousState.analysis_status==='approved') await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_analysis.superseded',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,details:{caseId,previousVersion:next-1,newVersion:next}})
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_analysis.version_created',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,details:{caseId,analysisVersion:next,sourceDocumentId:input.sourceDocumentId,sourceDocumentVersionId:input.sourceDocumentVersionId,sourceReferenceCount:input.sourceReferences.length,conflictCount:input.conflicts.length,status:detail.currentStatus}})
        return {analysis:detail}
      })
    },
    async approve(actorBase:Omit<ActorContext,'caseId'>,caseId:string,analysisId:string,input:PolicyAnalysisApprovalRequest,idem:IdempotencyContext){
      const actor={...actorBase,caseId}; return idempotentWrite(pool,actor,idem,200,async(client)=>{
        const locked=await client.query('SELECT version,current_version_id,source_document_id FROM policy_analyses WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',[actor.organizationId,caseId,analysisId])
        const row=locked.rows[0] as {version:number;current_version_id:string;source_document_id:string}|undefined
        if(row===undefined)throw new PolicyStoreError('not_found');if(row.version!==input.expectedVersion)throw new PolicyStoreError('version_conflict')
        const current=await client.query('SELECT analysis_status,source_completeness,analysis_version,created_by_user_id FROM policy_analysis_versions WHERE id=$1 FOR UPDATE',[row.current_version_id])
        const v=current.rows[0] as {analysis_status:string;source_completeness:string;analysis_version:number;created_by_user_id:string|null}
        if(!['awaiting_approval','control_required'].includes(v.analysis_status)||v.source_completeness!=='complete')throw new PolicyStoreError('state_conflict')
        const open=await client.query("SELECT count(*)::int AS n FROM policy_conflicts WHERE analysis_version_id=$1 AND resolution_status IN ('open','control_required')",[row.current_version_id])
        if((open.rows[0] as {n:number}).n>0)throw new PolicyStoreError('conflict_open')
        await client.query("UPDATE policy_analysis_versions SET analysis_status='superseded',is_active=false WHERE organization_id=$1 AND case_id=$2 AND source_document_id=$3 AND analysis_status='approved' AND is_active=true AND id<>$4",[actor.organizationId,caseId,row.source_document_id,row.current_version_id])
        await client.query("UPDATE policy_analysis_versions SET analysis_status='approved',human_approval_status='approved',approved_by_user_id=$1,approved_at=now(),approval_reason=$2,is_active=true WHERE id=$3",[actor.actorUserId,input.reason,row.current_version_id])
        await client.query('UPDATE policy_analyses SET version=version+1,updated_at=now() WHERE id=$1',[analysisId])
        const detail=await loadDetail(client,actor.organizationId,caseId,analysisId);if(detail===undefined)throw new PolicyStoreError('not_found')
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_analysis.approved',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,details:{caseId,analysisVersion:v.analysis_version,sourceReferenceCount:detail.currentVersion.sourceReferences.length,conflictCount:detail.currentVersion.conflicts.length,selfApproved:v.created_by_user_id===actor.actorUserId}})
        return {analysis:detail}
      })
    },
    async reject(actorBase:Omit<ActorContext,'caseId'>,caseId:string,analysisId:string,input:PolicyAnalysisRejectRequest,idem:IdempotencyContext){
      const actor={...actorBase,caseId};return idempotentWrite(pool,actor,idem,200,async(client)=>{
        const locked=await client.query('SELECT version,current_version_id FROM policy_analyses WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',[actor.organizationId,caseId,analysisId]);const row=locked.rows[0]as{version:number;current_version_id:string}|undefined
        if(row===undefined)throw new PolicyStoreError('not_found');if(row.version!==input.expectedVersion)throw new PolicyStoreError('version_conflict')
        const current=await client.query('SELECT analysis_status,analysis_version FROM policy_analysis_versions WHERE id=$1',[row.current_version_id]);const v=current.rows[0]as{analysis_status:string;analysis_version:number}
        if(['approved','superseded','rejected'].includes(v.analysis_status))throw new PolicyStoreError('state_conflict')
        await client.query("UPDATE policy_analysis_versions SET analysis_status='rejected',human_approval_status='rejected',approved_by_user_id=$1,approved_at=now(),approval_reason=$2,is_active=false WHERE id=$3",[actor.actorUserId,input.reason,row.current_version_id]);await client.query('UPDATE policy_analyses SET version=version+1,updated_at=now() WHERE id=$1',[analysisId])
        const detail=await loadDetail(client,actor.organizationId,caseId,analysisId);if(detail===undefined)throw new PolicyStoreError('not_found')
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_analysis.rejected',entityType:'policy_analysis',entityId:analysisId,requestId:actor.requestId,details:{caseId,analysisVersion:v.analysis_version,reasonProvided:true}});return{analysis:detail}
      })
    },
    async resolveConflict(actorBase:Omit<ActorContext,'caseId'>,caseId:string,conflictId:string,input:PolicyConflictResolutionRequest,idem:IdempotencyContext){
      const actor={...actorBase,caseId};return idempotentWrite(pool,actor,idem,200,async(client)=>{
        const locked=await client.query('SELECT * FROM policy_conflicts WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',[actor.organizationId,caseId,conflictId]);const row=locked.rows[0]as{version:number;analysis_id:string;analysis_version_id:string;resolution_status:string}|undefined
        if(row===undefined)throw new PolicyStoreError('not_found');if(row.version!==input.expectedVersion)throw new PolicyStoreError('version_conflict');if(!['open','control_required'].includes(row.resolution_status))throw new PolicyStoreError('state_conflict')
        await client.query('UPDATE policy_conflicts SET resolution_status=$1,resolved_by_user_id=$2,resolved_at=now(),resolution_reason=$3,version=version+1 WHERE id=$4',[input.resolutionStatus,actor.actorUserId,input.resolutionReason,conflictId])
        const remaining=await client.query("SELECT count(*)::int AS n FROM policy_conflicts WHERE analysis_version_id=$1 AND resolution_status IN ('open','control_required')",[row.analysis_version_id])
        if((remaining.rows[0]as{n:number}).n===0)await client.query("UPDATE policy_analysis_versions SET analysis_status='awaiting_approval' WHERE id=$1 AND analysis_status='conflict_detected'",[row.analysis_version_id])
        await client.query('UPDATE policy_analyses SET version=version+1,updated_at=now() WHERE id=$1',[row.analysis_id])
        const detail=await loadDetail(client,actor.organizationId,caseId,row.analysis_id);if(detail===undefined)throw new PolicyStoreError('not_found')
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_conflict.resolved',entityType:'policy_conflict',entityId:conflictId,requestId:actor.requestId,details:{caseId,analysisId:row.analysis_id,resolutionStatus:input.resolutionStatus}});return{analysis:detail}
      })
    },
    async evaluate(actorBase:Omit<ActorContext,'caseId'>,caseId:string,input:PolicyScenarioEvaluateRequest,idem:IdempotencyContext){
      const actor={...actorBase,caseId};return idempotentWrite(pool,actor,idem,200,async(client)=>{
        const caseResult=await client.query('SELECT case_type,loss_date,notification_date,insurer_id,service_center_id FROM cases WHERE organization_id=$1 AND id=$2',[actor.organizationId,caseId]);const c=caseResult.rows[0]as{case_type:'traffic'|'casco';loss_date:Date|string|null;notification_date:Date|string|null;insurer_id:string|null;service_center_id:string|null}|undefined
        if(c===undefined)throw new PolicyStoreError('not_found');if(c.case_type!=='casco')throw new PolicyStoreError('wrong_case_type')
        const analysis=await client.query('SELECT id FROM policy_analyses WHERE organization_id=$1 AND case_id=$2 AND id=$3',[actor.organizationId,caseId,input.analysisId]);if((analysis.rowCount??0)===0)throw new PolicyStoreError('not_found')
        const versionRow=await client.query('SELECT id,analysis_status,human_approval_status,source_document_version_id FROM policy_analysis_versions WHERE analysis_id=$1 AND analysis_version=$2',[input.analysisId,input.policyAnalysisVersion]);const vr=versionRow.rows[0]as{id:string;analysis_status:string;human_approval_status:string;source_document_version_id:string}|undefined;if(vr===undefined)throw new PolicyStoreError('not_found')
        const version=await loadVersion(client,actor.organizationId,caseId,vr.id);if(version===undefined)throw new PolicyStoreError('not_found')
        const physical=await client.query("SELECT status,hash_verified,size_verified,verified_at FROM document_versions WHERE id=$1",[vr.source_document_version_id]);const pv=physical.rows[0]as{status:string;hash_verified:boolean;size_verified:boolean;verified_at:Date|null}
        const documentState=pv.status==='ready'&&pv.hash_verified&&pv.size_verified&&pv.verified_at!==null?'verified':pv.status==='missing'?'missing':'unverified'
        const service=c.service_center_id===null?null:await loadServiceProfile(client,actor.organizationId,{serviceId:c.service_center_id,insurerId:c.insurer_id,evaluationDate:localDate(c.loss_date),dateSource:'loss_date',operation:'policy_assessment'})
        const sourceById=new Map(version.sourceReferences.map((source)=>[source.id,source]));const sourceFor=(ids:readonly string[])=>ids.map((id)=>sourceById.get(id)).filter((item)=>item!==undefined) as PolicySourceReference[]
        const deductibles:PolicyDeductible[]=version.deductibles.map((item)=>({code:item.code,type:item.type,trigger:item.trigger,calculationType:item.calculationType,fixedAmount:item.fixedAmount,percentage:item.percentage,minimumAmount:item.minimumAmount,maximumAmount:item.maximumAmount,insurerShare:item.insurerShare,insuredShare:item.insuredShare,affectedCoverage:item.affectedCoverage,affectedRepairMethod:item.affectedRepairMethod,affectedServiceType:item.affectedServiceType,affectedPartRule:item.affectedPartRule,exception:item.exception,sourceReferences:sourceFor(item.sourceReferenceIds),confidence:item.confidence,approvalStatus:item.approvalStatus}))
        const rules:PolicyScenarioRule[]=version.scenarioRules.map((item)=>({ruleId:item.ruleId,ruleVersion:item.ruleVersion,scenarioType:item.scenarioType,trigger:item.trigger,conditions:item.conditions,coverageOutcome:item.coverageOutcome,coverageCode:item.coverageCode,deductibleCodes:item.deductibleCodes,limit:item.limit,exception:item.exception,requiredDocuments:item.requiredDocuments,serviceCondition:item.serviceCondition,partCondition:item.partCondition,action:item.action,sourceReferences:sourceFor(item.sourceReferenceIds),confidence:item.confidence,humanApprovalRequired:item.humanApprovalRequired,precedence:item.precedence,effectiveFrom:item.effectiveFrom,effectiveTo:item.effectiveTo}))
        const conflicts:PolicyConflictFact[]=version.conflicts.map((item)=>({id:item.id,affectedTopic:item.affectedTopic,explanation:item.explanation,severity:item.severity,resolutionStatus:item.resolutionStatus,sourceA:sourceById.get(item.sourceAId)!,sourceB:sourceById.get(item.sourceBId)!})).filter((item)=>item.sourceA!==undefined&&item.sourceB!==undefined)
        const evaluation=evaluatePolicyScenario({facts:{caseType:c.case_type,lossDate:localDate(c.loss_date),notificationDate:localDate(c.notification_date),insurerId:c.insurer_id,serviceCenterId:c.service_center_id,serviceType:(service?.serviceType??null)as ServiceType|null,insurerAgreementStatus:service?.agreement.agreementStatus??null,damageCategory:input.damageCategory,repairMethod:input.repairMethod,requestedOperation:input.requestedOperation,documentState,policyAnalysisVersion:input.policyAnalysisVersion},scenarioType:input.scenarioType,analysisApproved:vr.analysis_status==='approved'&&vr.human_approval_status==='approved',rules,deductibles,conflicts,ruleVersion:rules[0]?.ruleVersion??POLICY_SCENARIO_RULE_VERSION})
        const evaluationId=uuidv7();const evaluatedAt=new Date()
        const dto=policyScenarioEvaluationSchema.parse({evaluationId,analysisId:input.analysisId,evaluatedAt:evaluatedAt.toISOString(),...evaluation,
          deductibles:evaluation.deductibles.map((item)=>version.deductibles.find((dtoItem)=>dtoItem.code===item.code)),
          conflicts:evaluation.conflicts.map((item)=>version.conflicts.find((dtoItem)=>dtoItem.id===item.id))})
        const safeSnapshot={...dto,sourceReferences:dto.sourceReferences.map((source)=>({id:source.id,documentId:source.documentId,documentVersionId:source.documentVersionId,pageNumber:source.pageNumber,sectionHeading:source.sectionHeading,clauseIdentifier:source.clauseIdentifier,excerptHash:source.excerptHash,locator:source.locator,sourceType:source.sourceType,confidence:source.confidence,extractionLocator:source.extractionLocator})),deductibles:dto.deductibles.map((item)=>({...item,sourceReferenceIds:item.sourceReferenceIds})),conflicts:dto.conflicts}
        await client.query(`INSERT INTO policy_scenario_evaluations
          (id,organization_id,case_id,analysis_id,analysis_version_id,policy_analysis_version,scenario_type,rule_version,input_summary,result_code,result_snapshot,evaluated_by_user_id,request_id,evaluated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[evaluationId,actor.organizationId,caseId,input.analysisId,vr.id,input.policyAnalysisVersion,input.scenarioType,dto.ruleVersion,JSON.stringify({damageCategory:input.damageCategory,repairMethod:input.repairMethod,requestedOperation:input.requestedOperation,documentState}),dto.result,JSON.stringify(safeSnapshot),actor.actorUserId,actor.requestId,evaluatedAt])
        await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,action:'policy_scenario.evaluated',entityType:'policy_scenario_evaluation',entityId:evaluationId,requestId:actor.requestId,details:{caseId,analysisId:input.analysisId,analysisVersion:input.policyAnalysisVersion,ruleVersion:dto.ruleVersion,resultCode:dto.result,sourceReferenceCount:dto.sourceReferences.length,conflictCount:dto.conflicts.length}})
        return{evaluation:dto}
      })
    },
  }
}
