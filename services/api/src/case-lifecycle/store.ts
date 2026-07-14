import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  caseLifecycleOperationSchema,
  caseLifecycleOperationResponseSchema,
  type CaseLifecycleOperation,
  type ClosePlanRequest,
  type LifecycleApproveRequest,
  type LifecycleCancelRequest,
  type LifecycleRequirementItem,
  type LifecycleRequirementSummary,
  type ReopenPlanRequest,
  type ServiceAgreementEvaluation,
} from '@hasarbotu/contracts'
import {
  buildClosedCaseWorkspacePath,
  evaluateClosureRequirements,
  type ClosureMetadataCandidate,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { insertIdempotent, type IdempotentRecord } from '../db/idempotency.js'
import { withTransaction } from '../db/executor.js'
import { evaluateCaseDocumentRequirements } from '../document-requirements/evaluation.js'
import { enqueueLifecycleFileOperation } from '../file-operations/store.js'
import { loadServiceProfile } from '../service-agreements/service.js'

export const LIFECYCLE_CLOSE_PLAN_SCOPE = 'case.lifecycle.close.plan'
export const LIFECYCLE_REOPEN_PLAN_SCOPE = 'case.lifecycle.reopen.plan'
export const LIFECYCLE_APPROVE_SCOPE = 'case.lifecycle.approve'
export const LIFECYCLE_CANCEL_SCOPE = 'case.lifecycle.cancel'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}
interface IdempotencyInput { readonly key: string; readonly requestHash: string; readonly scope: string }

interface LifecycleRow {
  id: string
  case_id: string
  operation_type: 'close' | 'reopen'
  expected_case_version: number
  expected_location_version: number
  source_storage_root_key: string
  source_relative_path: string
  destination_storage_root_key: string
  destination_relative_path: string
  linked_file_operation_id: string | null
  linked_file_operation_status: string | null
  closure_mode: 'normal' | 'with_missing_requirements' | null
  requirement_snapshot: LifecycleRequirementSummary
  blockers: string[]
  warnings: string[]
  user_reason: string | null
  previous_lifecycle_status: 'open' | 'closed'
  target_lifecycle_status: 'open' | 'closed'
  previous_workflow_stage: string
  target_workflow_stage: string
  status: string
  failure_reason_code: string | null
  version: number
  approved_at: Date | null
  finalized_at: Date | null
  created_at: Date
  updated_at: Date
}

const LIFECYCLE_FIELDS = `lo.id,lo.case_id,lo.operation_type,lo.expected_case_version,lo.expected_location_version,
  lo.source_storage_root_key,lo.source_relative_path,lo.destination_storage_root_key,lo.destination_relative_path,
  lo.linked_file_operation_id,fo.status AS linked_file_operation_status,lo.closure_mode,lo.requirement_snapshot,
  lo.blockers,lo.warnings,lo.user_reason,lo.previous_lifecycle_status,lo.target_lifecycle_status,
  lo.previous_workflow_stage,lo.target_workflow_stage,lo.status,lo.failure_reason_code,lo.version,
  lo.approved_at,lo.finalized_at,lo.created_at,lo.updated_at`

function toDto(row: LifecycleRow): CaseLifecycleOperation {
  return caseLifecycleOperationSchema.parse({
    id: row.id,
    caseId: row.case_id,
    operationType: row.operation_type,
    status: row.status,
    version: row.version,
    expectedCaseVersion: row.expected_case_version,
    expectedLocationVersion: row.expected_location_version,
    source: { storageRootKey: row.source_storage_root_key, relativePath: row.source_relative_path },
    destination: { storageRootKey: row.destination_storage_root_key, relativePath: row.destination_relative_path },
    closeMode: row.closure_mode,
    reason: row.user_reason,
    previousLifecycleStatus: row.previous_lifecycle_status,
    targetLifecycleStatus: row.target_lifecycle_status,
    previousWorkflowStage: row.previous_workflow_stage,
    targetWorkflowStage: row.target_workflow_stage,
    requirementSummary: row.requirement_snapshot,
    blockers: row.blockers,
    warnings: row.warnings,
    linkedFileOperation: row.linked_file_operation_id === null ? null : {
      id: row.linked_file_operation_id,
      status: row.linked_file_operation_status,
    },
    failureReasonCode: row.failure_reason_code,
    canApprove: row.status === 'approval_required',
    canCancel: row.status === 'approval_required',
    approvedAt: row.approved_at?.toISOString() ?? null,
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function dateOnly(value: Date | null): string | null {
  if (value === null) return null
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function readDto(client: pg.PoolClient | pg.Pool, organizationId: string, caseId: string, operationId: string): Promise<CaseLifecycleOperation | undefined> {
  const selected = await client.query(
    `SELECT ${LIFECYCLE_FIELDS} FROM case_lifecycle_operations lo
     LEFT JOIN case_file_operations fo ON fo.id=lo.linked_file_operation_id
     WHERE lo.organization_id=$1 AND lo.case_id::text=$2 AND lo.id::text=$3`,
    [organizationId, caseId, operationId],
  )
  const row = selected.rows[0] as LifecycleRow | undefined
  return row === undefined ? undefined : toDto(row)
}

async function requirementSummary(
  client: pg.PoolClient,
  organizationId: string,
  caseId: string,
  evaluatedAt: string,
  hasService: boolean,
  serviceEligibility: ServiceAgreementEvaluation | null,
): Promise<LifecycleRequirementSummary> {
  const base = await evaluateCaseDocumentRequirements(client, organizationId, caseId, evaluatedAt)
  if (base === undefined) throw new Error('case_missing_during_requirement_evaluation')
  const documents = await client.query(
    `SELECT dv.id,d.document_type,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at
     FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id
     WHERE d.organization_id=$1 AND d.case_id=$2
       AND d.document_type IN ('expert_report','preliminary_report','invoice','delivery_release_assignment','commitment')`,
    [organizationId, caseId],
  )
  const photos = await client.query(
    `SELECT id,relative_path,status,hash_verified,size_verified,verified_at
     FROM photos WHERE organization_id=$1 AND case_id=$2`,
    [organizationId, caseId],
  )
  const toCandidate = (row: {
    id: string; document_type?: string; status: ClosureMetadataCandidate['status']; hash_verified: boolean; size_verified: boolean; verified_at: Date | null
  }, canonicalType: string): ClosureMetadataCandidate => ({
    id: row.id,
    canonicalType,
    status: row.status,
    hashVerified: row.hash_verified,
    sizeVerified: row.size_verified,
    verifiedAt: row.verified_at?.toISOString() ?? null,
  })
  const documentCandidates = (documents.rows as Array<{
    id: string; document_type: string; status: ClosureMetadataCandidate['status']; hash_verified: boolean; size_verified: boolean; verified_at: Date | null
  }>).map((row) => toCandidate(row, row.document_type))
  const repairPhotos = (photos.rows as Array<{
    id: string; relative_path: string; status: ClosureMetadataCandidate['status']; hash_verified: boolean; size_verified: boolean; verified_at: Date | null
  }>).filter((row) => row.relative_path.split('/').some((segment) => segment.toLocaleUpperCase('tr-TR') === 'ONARIM'))
    .map((row) => toCandidate(row, 'repair_photos'))
  const closure = evaluateClosureRequirements({ documents: documentCandidates, repairPhotos, hasService, serviceEligibility })
  const baseItems: LifecycleRequirementItem[] = base.requirements.map((item) => ({
    requirementCode: item.requirementCode,
    sourceType: 'document',
    canonicalType: item.canonicalDocumentType,
    status: item.status === 'required' ? 'missing' : item.status,
    reason: item.reason,
    matchedMetadataIds: [...item.matchedDocumentIds],
    relatedMetadataStatuses: item.relatedDocumentStatuses.map((related) => ({ metadataId: related.documentId, status: related.status })),
    requiresHumanReview: item.requiresHumanReview,
  }))
  const closureItems: LifecycleRequirementItem[] = closure.requirements.map((item) => ({
    ...item,
    matchedMetadataIds: [...item.matchedMetadataIds],
    relatedMetadataStatuses: item.relatedMetadataStatuses.map((related) => ({ ...related })),
  }))
  const requirements = [...baseItems, ...closureItems]
  return {
    documentRuleVersion: base.ruleSetVersion,
    documentOverallStatus: base.overallStatus,
    closureRuleVersion: closure.version,
    serviceEligibility,
    missingCount: requirements.filter((item) => item.status === 'missing').length,
    controlRequiredCount: requirements.filter((item) => item.status === 'control_required').length,
    requirements,
  }
}

type PlanOutcome =
  | { readonly kind: 'ok'; readonly operation: CaseLifecycleOperation }
  | { readonly kind: 'not_found' | 'lifecycle_conflict' | 'location_required' | 'location_not_verified' | 'version_conflict' | 'destination_conflict' | 'active_file_operation' | 'manual_recovery_required' | 'invalid_location' }

type CommandOutcome =
  | { readonly kind: 'ok'; readonly operation: CaseLifecycleOperation }
  | { readonly kind: 'not_found' | 'version_conflict' | 'stale' | 'conflict' | 'destination_conflict' }

export function createCaseLifecycleStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async findIdempotent(organizationId: string, scope: string, key: string): Promise<IdempotentRecord | undefined> {
      const result = await pool.query(
        'SELECT request_hash,response_status,response_body FROM idempotency_keys WHERE organization_id=$1 AND scope=$2 AND idem_key=$3',
        [organizationId, scope, key],
      )
      const row = result.rows[0] as { request_hash: string; response_status: number; response_body: unknown } | undefined
      return row === undefined ? undefined : { requestHash: row.request_hash, responseStatus: row.response_status, responseBody: row.response_body }
    },

    async find(organizationId: string, caseId: string, operationId: string): Promise<CaseLifecycleOperation | undefined> {
      return readDto(pool, organizationId, caseId, operationId)
    },

    async list(organizationId: string, caseId: string): Promise<readonly CaseLifecycleOperation[] | undefined> {
      const exists = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id::text=$2', [organizationId, caseId])
      if (exists.rowCount === 0) return undefined
      const result = await pool.query(
        `SELECT ${LIFECYCLE_FIELDS} FROM case_lifecycle_operations lo
         LEFT JOIN case_file_operations fo ON fo.id=lo.linked_file_operation_id
         WHERE lo.organization_id=$1 AND lo.case_id::text=$2 ORDER BY lo.created_at DESC,lo.id DESC`,
        [organizationId, caseId],
      )
      return (result.rows as LifecycleRow[]).map(toDto)
    },

    async planClose(actor: ActorContext, caseId: string, input: ClosePlanRequest, idem: IdempotencyInput): Promise<PlanOutcome> {
      return withTransaction(pool, async (client): Promise<PlanOutcome> => {
        const selected = await client.query(
          `SELECT c.version,c.lifecycle_status,c.workflow_stage,c.notification_date,c.loss_date,c.insurer_id,c.service_center_id
           FROM cases c
           WHERE c.organization_id=$1 AND c.id::text=$2 FOR UPDATE OF c`,
          [actor.organizationId, caseId],
        )
        const current = selected.rows[0] as {
          version: number; lifecycle_status: 'open' | 'closed'; workflow_stage: string; notification_date: Date | null;
          loss_date: Date | null; insurer_id: string | null; service_center_id: string | null
        } | undefined
        if (current === undefined) return { kind: 'not_found' }
        if (current.lifecycle_status !== 'open') return { kind: 'lifecycle_conflict' }
        if (current.version !== input.expectedCaseVersion) return { kind: 'version_conflict' }
        const activeLifecycle = await client.query(
          `SELECT 1 FROM case_lifecycle_operations WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')`, [actor.organizationId, caseId],
        )
        if (activeLifecycle.rowCount !== 0) return { kind: 'lifecycle_conflict' }
        const locationResult = await client.query(
          `SELECT id,storage_root_key,relative_path,verification_status,version FROM case_locations
           WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`, [actor.organizationId, caseId],
        )
        const location = locationResult.rows[0] as { id: string; storage_root_key: string; relative_path: string; verification_status: string; version: number } | undefined
        if (location === undefined) return { kind: 'location_required' }
        if (location.verification_status !== 'verified') return { kind: 'location_not_verified' }
        if (location.version !== input.expectedLocationVersion) return { kind: 'version_conflict' }
        const activeFile = await client.query(
          `SELECT status FROM case_file_operations WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('ready','stale','cancelled')`, [actor.organizationId, caseId],
        )
        if (activeFile.rowCount !== 0) {
          const status = (activeFile.rows[0] as { status: string }).status
          return { kind: status === 'manual_recovery_required' ? 'manual_recovery_required' : 'active_file_operation' }
        }
        const activeProvisioning = await client.query(
          `SELECT 1 FROM case_workspace_provisionings WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('ready','stale','cancelled')`, [actor.organizationId, caseId],
        )
        if (activeProvisioning.rowCount !== 0) return { kind: 'active_file_operation' }
        const target = buildClosedCaseWorkspacePath(dateOnly(current.notification_date), location.relative_path)
        if (!target.ok) return { kind: 'invalid_location' }
        const destinationConflict = await client.query(
          `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           AND lower(relative_path)=lower($3) AND id<>$4`,
          [actor.organizationId, location.storage_root_key, target.value, location.id],
        )
        if (destinationConflict.rowCount !== 0) return { kind: 'destination_conflict' }
        const serviceProfile = current.service_center_id === null ? null : await loadServiceProfile(client, actor.organizationId, {
          serviceId: current.service_center_id,
          insurerId: current.insurer_id,
          evaluationDate: dateOnly(current.loss_date),
          dateSource: 'loss_date',
          operation: 'closure_documents',
        })
        const summary = await requirementSummary(
          client, actor.organizationId, caseId, new Date().toISOString(),
          current.service_center_id !== null, serviceProfile?.agreement ?? null,
        )
        const incomplete = summary.missingCount + summary.controlRequiredCount > 0
        const blockers = input.closeMode === 'normal' && incomplete ? ['requirements_incomplete'] : []
        const warnings = input.closeMode === 'with_missing_requirements' && incomplete ? ['closing_with_missing_requirements'] : []
        const status = blockers.length > 0 ? 'blocked' : 'approval_required'
        const operationId = uuidv7()
        await client.query(
          `INSERT INTO case_lifecycle_operations
           (id,organization_id,case_id,operation_type,expected_case_version,expected_location_id,expected_location_version,
            source_storage_root_key,source_relative_path,destination_storage_root_key,destination_relative_path,
            closure_mode,requirement_snapshot,blockers,warnings,user_reason,previous_lifecycle_status,target_lifecycle_status,
            previous_workflow_stage,target_workflow_stage,status,idempotency_key_hash,request_hash,created_by_user_id,request_id)
           VALUES ($1,$2,$3,'close',$4,$5,$6,$7,$8,$7,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,'open','closed',$15,'closed',$16,$17,$18,$19,$20)`,
          [operationId, actor.organizationId, caseId, current.version, location.id, location.version,
            location.storage_root_key, location.relative_path, target.value, input.closeMode, JSON.stringify(summary),
            JSON.stringify(blockers), JSON.stringify(warnings), input.reason ?? null, current.workflow_stage, status,
            keyHash(idem.key), idem.requestHash, actor.actorUserId, actor.requestId],
        )
        await audit.record(client, {
          organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
          action: blockers.length > 0 ? 'case_lifecycle.close_blocked' : input.closeMode === 'with_missing_requirements' && incomplete
            ? 'case_lifecycle.close_with_missing_requirements' : 'case_lifecycle.close_planned',
          entityType: 'case_lifecycle_operation', entityId: operationId,
          details: { caseId, closeMode: input.closeMode, missingCount: summary.missingCount, controlRequiredCount: summary.controlRequiredCount,
            source: { storageRootKey: location.storage_root_key, relativePath: location.relative_path },
            destination: { storageRootKey: location.storage_root_key, relativePath: target.value }, blockers, warnings,
            serviceEligibility: serviceProfile?.agreement ?? null },
        })
        const operation = await readDto(client, actor.organizationId, caseId, operationId)
        if (operation === undefined) throw new Error('lifecycle_operation_insert_failed')
        const response = caseLifecycleOperationResponseSchema.parse({ operation })
        await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
          requestHash: idem.requestHash, responseStatus: 201, responseBody: response, caseId })
        return { kind: 'ok', operation }
      })
    },

    async planReopen(actor: ActorContext, caseId: string, input: ReopenPlanRequest, idem: IdempotencyInput): Promise<PlanOutcome> {
      return withTransaction(pool, async (client): Promise<PlanOutcome> => {
        const selected = await client.query(
          `SELECT version,lifecycle_status,workflow_stage,service_center_id,insurer_id,loss_date FROM cases
           WHERE organization_id=$1 AND id::text=$2 FOR UPDATE`, [actor.organizationId, caseId],
        )
        const current = selected.rows[0] as { version: number; lifecycle_status: 'open' | 'closed'; workflow_stage: string; service_center_id: string | null; insurer_id: string | null; loss_date: Date | null } | undefined
        if (current === undefined) return { kind: 'not_found' }
        if (current.lifecycle_status !== 'closed') return { kind: 'lifecycle_conflict' }
        if (current.version !== input.expectedCaseVersion) return { kind: 'version_conflict' }
        const activeLifecycle = await client.query(
          `SELECT 1 FROM case_lifecycle_operations WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')`, [actor.organizationId, caseId],
        )
        if (activeLifecycle.rowCount !== 0) return { kind: 'lifecycle_conflict' }
        const locationResult = await client.query(
          `SELECT id,storage_root_key,relative_path,verification_status,version FROM case_locations
           WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`, [actor.organizationId, caseId],
        )
        const location = locationResult.rows[0] as { id: string; storage_root_key: string; relative_path: string; verification_status: string; version: number } | undefined
        if (location === undefined) return { kind: 'location_required' }
        if (location.verification_status !== 'verified') return { kind: 'location_not_verified' }
        if (location.version !== input.expectedLocationVersion) return { kind: 'version_conflict' }
        const prior = await client.query(
          `SELECT source_storage_root_key,source_relative_path FROM case_lifecycle_history
           WHERE organization_id=$1 AND case_id=$2 AND operation_type='close'
           ORDER BY occurred_at DESC,id DESC LIMIT 1`, [actor.organizationId, caseId],
        )
        const openLocation = prior.rows[0] as { source_storage_root_key: string; source_relative_path: string } | undefined
        if (openLocation === undefined) return { kind: 'invalid_location' }
        const activeFile = await client.query(
          `SELECT status FROM case_file_operations WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('ready','stale','cancelled')`, [actor.organizationId, caseId],
        )
        if (activeFile.rowCount !== 0) return { kind: (activeFile.rows[0] as { status: string }).status === 'manual_recovery_required' ? 'manual_recovery_required' : 'active_file_operation' }
        const destinationConflict = await client.query(
          `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           AND lower(relative_path)=lower($3) AND id<>$4`,
          [actor.organizationId, openLocation.source_storage_root_key, openLocation.source_relative_path, location.id],
        )
        if (destinationConflict.rowCount !== 0) return { kind: 'destination_conflict' }
        const serviceProfile = current.service_center_id === null ? null : await loadServiceProfile(client, actor.organizationId, {
          serviceId: current.service_center_id,
          insurerId: current.insurer_id,
          evaluationDate: dateOnly(current.loss_date),
          dateSource: 'loss_date',
          operation: 'closure_documents',
        })
        const summary = await requirementSummary(client, actor.organizationId, caseId, new Date().toISOString(),
          current.service_center_id !== null, serviceProfile?.agreement ?? null)
        const operationId = uuidv7()
        await client.query(
          `INSERT INTO case_lifecycle_operations
           (id,organization_id,case_id,operation_type,expected_case_version,expected_location_id,expected_location_version,
            source_storage_root_key,source_relative_path,destination_storage_root_key,destination_relative_path,
            closure_mode,requirement_snapshot,blockers,warnings,user_reason,previous_lifecycle_status,target_lifecycle_status,
            previous_workflow_stage,target_workflow_stage,status,idempotency_key_hash,request_hash,created_by_user_id,request_id)
           VALUES ($1,$2,$3,'reopen',$4,$5,$6,$7,$8,$9,$10,NULL,$11::jsonb,'[]'::jsonb,'[]'::jsonb,$12,'closed','open',$13,$14,'approval_required',$15,$16,$17,$18)`,
          [operationId, actor.organizationId, caseId, current.version, location.id, location.version,
            location.storage_root_key, location.relative_path, openLocation.source_storage_root_key, openLocation.source_relative_path,
            JSON.stringify(summary), input.reason, current.workflow_stage, input.targetWorkflowStage,
            keyHash(idem.key), idem.requestHash, actor.actorUserId, actor.requestId],
        )
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
          action: 'case_lifecycle.reopen_planned', entityType: 'case_lifecycle_operation', entityId: operationId,
          details: { caseId, previousLifecycle: 'closed', targetLifecycle: 'open', reason: input.reason,
            source: { storageRootKey: location.storage_root_key, relativePath: location.relative_path },
            destination: { storageRootKey: openLocation.source_storage_root_key, relativePath: openLocation.source_relative_path } } })
        const operation = await readDto(client, actor.organizationId, caseId, operationId)
        if (operation === undefined) throw new Error('lifecycle_operation_insert_failed')
        const response = caseLifecycleOperationResponseSchema.parse({ operation })
        await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
          requestHash: idem.requestHash, responseStatus: 201, responseBody: response, caseId })
        return { kind: 'ok', operation }
      })
    },

    async approve(actor: ActorContext, caseId: string, operationId: string, expectedOperationType: 'close' | 'reopen', input: LifecycleApproveRequest, idem: IdempotencyInput): Promise<CommandOutcome> {
      return withTransaction(pool, async (client): Promise<CommandOutcome> => {
        const selected = await client.query(
          `SELECT lo.*,c.lifecycle_status,c.workflow_stage,c.version AS case_version,cl.storage_root_key AS location_root,
             cl.relative_path AS location_path,cl.verification_status,cl.version AS location_version
           FROM case_lifecycle_operations lo JOIN cases c ON c.id=lo.case_id
           JOIN case_locations cl ON cl.id=lo.expected_location_id
           WHERE lo.organization_id=$1 AND lo.case_id::text=$2 AND lo.id::text=$3 FOR UPDATE OF lo,c,cl`,
          [actor.organizationId, caseId, operationId],
        )
        const row = selected.rows[0] as (LifecycleRow & {
          expected_location_id: string; lifecycle_status: string; workflow_stage: string; case_version: number;
          location_root: string; location_path: string; verification_status: string; location_version: number
        }) | undefined
        if (row === undefined) return { kind: 'not_found' }
        if (row.operation_type !== expectedOperationType) return { kind: 'conflict' }
        if (row.version !== input.expectedVersion) return { kind: 'version_conflict' }
        if (row.status !== 'approval_required') return { kind: row.status === 'stale' ? 'stale' : 'conflict' }
        const expectedLifecycle = row.operation_type === 'close' ? 'open' : 'closed'
        if (row.case_version !== row.expected_case_version || row.lifecycle_status !== expectedLifecycle
          || row.location_version !== row.expected_location_version || row.location_root !== row.source_storage_root_key
          || row.location_path !== row.source_relative_path || row.verification_status !== 'verified') {
          await client.query("UPDATE case_lifecycle_operations SET status='stale',failure_reason_code='snapshot_changed',version=version+1,updated_at=now() WHERE id=$1", [operationId])
          await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
            action: 'case_lifecycle.stale', entityType: 'case_lifecycle_operation', entityId: operationId,
            details: { caseId, errorCode: 'snapshot_changed' } })
          return { kind: 'stale' }
        }
        const conflict = await client.query(
          `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           AND lower(relative_path)=lower($3) AND id<>$4`,
          [actor.organizationId, row.destination_storage_root_key, row.destination_relative_path, row.expected_location_id],
        )
        if (conflict.rowCount !== 0) return { kind: 'destination_conflict' }
        const file = await enqueueLifecycleFileOperation(client, {
          organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
          caseId, lifecycleOperationId: operationId,
          source: { locationId: row.expected_location_id, storageRootKey: row.source_storage_root_key,
            relativePath: row.source_relative_path, version: row.expected_location_version },
          destination: { storageRootKey: row.destination_storage_root_key, relativePath: row.destination_relative_path },
        })
        await client.query(
          `UPDATE case_lifecycle_operations SET status='queued',linked_file_operation_id=$2,approved_by_user_id=$3,
           approved_at=now(),version=version+1,updated_at=now() WHERE id=$1`,
          [operationId, file.operationId, actor.actorUserId],
        )
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
          action: row.operation_type === 'close' ? 'case_lifecycle.close_approved' : 'case_lifecycle.reopen_approved',
          entityType: 'case_lifecycle_operation', entityId: operationId,
          details: { caseId, linkedFileOperationId: file.operationId, jobId: file.jobId,
            previousLifecycle: row.previous_lifecycle_status, targetLifecycle: row.target_lifecycle_status,
            previousWorkflowStage: row.previous_workflow_stage, targetWorkflowStage: row.target_workflow_stage } })
        const operation = await readDto(client, actor.organizationId, caseId, operationId)
        if (operation === undefined) throw new Error('lifecycle_operation_update_failed')
        const response = caseLifecycleOperationResponseSchema.parse({ operation })
        await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
          requestHash: idem.requestHash, responseStatus: 202, responseBody: response, caseId })
        return { kind: 'ok', operation }
      })
    },

    async cancel(actor: ActorContext, caseId: string, operationId: string, input: LifecycleCancelRequest, idem: IdempotencyInput): Promise<CommandOutcome> {
      return withTransaction(pool, async (client): Promise<CommandOutcome> => {
        const selected = await client.query(
          `SELECT version,status FROM case_lifecycle_operations WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
          [actor.organizationId, caseId, operationId],
        )
        const row = selected.rows[0] as { version: number; status: string } | undefined
        if (row === undefined) return { kind: 'not_found' }
        if (row.version !== input.expectedVersion) return { kind: 'version_conflict' }
        if (row.status !== 'approval_required') return { kind: 'conflict' }
        await client.query(
          `UPDATE case_lifecycle_operations SET status='cancelled',cancelled_by_user_id=$2,version=version+1,updated_at=now() WHERE id=$1`,
          [operationId, actor.actorUserId],
        )
        const operation = await readDto(client, actor.organizationId, caseId, operationId)
        if (operation === undefined) throw new Error('lifecycle_operation_update_failed')
        const response = caseLifecycleOperationResponseSchema.parse({ operation })
        await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
          requestHash: idem.requestHash, responseStatus: 200, responseBody: response, caseId })
        return { kind: 'ok', operation }
      })
    },
  }
}

export type CaseLifecycleStore = ReturnType<typeof createCaseLifecycleStore>
