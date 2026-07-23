import type pg from 'pg'
import {
  buildLaborWorkbookApplySnapshot,
  LABOR_WORKBOOK_APPLY_RULE_VERSION,
  parseLaborWorkbookMinorValue,
  type LaborWorkbookApprovedCategoryAmount,
} from '@hasarbotu/domain'
import {
  laborWorkbookApplyResponseSchema,
  laborWorkbookPreviewResultSummarySchema,
  utcDateTimeSchema,
  type JobPayload,
  type JobResultRequest,
  type LaborWorkbookApply,
  type LaborWorkbookApplyApproveRequest,
  type LaborWorkbookAppliesResponse,
  type LaborWorkbookApplyResponse,
  type LaborWorkbookApplyPreviewRequest,
  type LaborWorkbookAuditEventRequest,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { withTransaction, type Queryable } from '../db/executor.js'
import {
  findIdempotent,
  hashRequestBody,
  insertIdempotent,
} from '../db/idempotency.js'

const PREVIEW_SCOPE = 'labor-workbook-apply.preview'
const APPROVE_SCOPE = 'labor-workbook-apply.approve'

export class LaborWorkbookApplyError extends Error {
  constructor(
    readonly code:
      | 'CASE_NOT_FOUND'
      | 'CASE_CLOSED'
      | 'LOCATION_NOT_VERIFIED'
      | 'APPLICATION_NOT_FOUND'
      | 'REVISION_STALE'
      | 'PROFILE_NOT_WRITABLE'
      | 'PROFILE_MISMATCH'
      | 'IDENTITY_CELL_REQUIRED'
      | 'CONTROL_REQUIRED'
      | 'OPERATION_NOT_FOUND'
      | 'OPERATION_NOT_APPROVABLE'
      | 'PLAN_STALE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'VERSION_CONFLICT',
    readonly status: number,
  ) {
    super(code)
    this.name = 'LaborWorkbookApplyError'
  }
}

export interface LaborWorkbookApplyActor {
  readonly organizationId: string
  readonly userId: string
  readonly requestId: string
}
type LaborWorkbookApplyJobPayload =
  Extract<JobPayload, { readonly kind: 'labor_workbook_apply' }>

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error('unsafe_integer')
  return parsed
}

function categoryAmounts(value: unknown): LaborWorkbookApprovedCategoryAmount[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.entries(value as Record<string, unknown>).map(([category, amount]) => ({
    category: category as LaborWorkbookApprovedCategoryAmount['category'],
    amountMinor: safeNumber(amount),
  }))
}

function rowToDto(row: Record<string, unknown>): LaborWorkbookApply {
  const request = row.immutable_request_snapshot as {
    rows: Array<Record<string, unknown>>
  }
  const preview = row.preview_plan as {
    observations?: Array<Record<string, unknown>>
    changes?: Array<Record<string, unknown>>
  } | null
  const previewByCell = new Map(
    (preview?.observations ?? []).map((change) => [String(change.cell), change]),
  )
  const rows = request.rows.map((snapshot) => {
    const cell = String(snapshot.cell)
    const observed = previewByCell.get(cell)
    return {
      lineOrdinal: safeNumber(snapshot.lineOrdinal),
      rowNumber: safeNumber(snapshot.rowNumber),
      cell,
      sourceRowHash: String(observed?.sourceRowHash ?? snapshot.sourceRowHash
        ?? '0'.repeat(64)),
      partCode: snapshot.partCode === null ? null : String(snapshot.partCode),
      partName: String(snapshot.partName),
      operationType: String(snapshot.operationType),
      previousValue: observed?.previousValue === undefined
        ? null
        : observed.previousValue as string | null,
      newValue: String(snapshot.newValue),
      valueSource: 'approved_final' as const,
      manuallyModified: Boolean(snapshot.manuallyModified),
      matchConfidence: snapshot.matchConfidence as 'exact_source_row' | 'control_required',
      conflictCodes: snapshot.conflictCodes as never,
    }
  })
  return laborWorkbookApplyResponseSchema.shape.operation.parse({
    id: String(row.id),
    caseId: String(row.case_id),
    applicationId: String(row.application_id),
    revisionId: String(row.revision_id),
    revisionVersion: safeNumber(row.revision_version),
    profileId: String(row.profile_id),
    workbookReference: String(row.relative_workbook_path),
    sheetName: String(row.sheet_name),
    status: String(row.status),
    version: safeNumber(row.version),
    ruleVersion: LABOR_WORKBOOK_APPLY_RULE_VERSION,
    approvedRevisionSnapshotHash: String(row.approved_revision_snapshot_hash),
    sourceWorkbookHash: row.source_workbook_hash === null ? null : String(row.source_workbook_hash),
    planHash: row.preview_plan_hash === null ? null : String(row.preview_plan_hash),
    resultWorkbookHash: row.result_workbook_hash === null ? null : String(row.result_workbook_hash),
    backupReference: row.backup_file_name === null ? null : String(row.backup_file_name),
    previousTotalMinor: row.previous_total_minor === null
      ? null
      : safeNumber(row.previous_total_minor),
    newTotalMinor: safeNumber(row.new_total_minor),
    changedRowCount: safeNumber(row.changed_row_count),
    unchangedRowCount: safeNumber(row.unchanged_row_count),
    controlRequiredRowCount: safeNumber(row.control_required_row_count),
    rows,
    approvedByUserId: row.approved_by_user_id === null ? null : String(row.approved_by_user_id),
    approvedAt: row.approved_at === null ? null : new Date(String(row.approved_at)).toISOString(),
    jobId: row.apply_job_id === null
      ? (row.preview_job_id === null ? null : String(row.preview_job_id))
      : String(row.apply_job_id),
    safeErrorCode: row.safe_error_code === null ? null : String(row.safe_error_code),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  })
}

async function readOperation(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  operationId: string,
  forUpdate = false,
): Promise<Record<string, unknown>> {
  const found = await exec.query(
    `SELECT * FROM labor_workbook_apply_operations
      WHERE organization_id=$1 AND case_id=$2 AND id=$3${forUpdate ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId, operationId],
  )
  const row = found.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) throw new LaborWorkbookApplyError('OPERATION_NOT_FOUND', 404)
  return row
}

function response(
  row: Record<string, unknown>,
  canPreview: boolean,
  canApprove: boolean,
): LaborWorkbookApplyResponse {
  return laborWorkbookApplyResponseSchema.parse({
    operation: rowToDto(row),
    permissions: { canPreview, canApprove },
  })
}

export interface LaborWorkbookApplyStore {
  preview(
    actor: LaborWorkbookApplyActor,
    caseId: string,
    input: LaborWorkbookApplyPreviewRequest,
    idempotencyKey: string,
  ): Promise<LaborWorkbookApplyResponse>
  approve(
    actor: LaborWorkbookApplyActor,
    caseId: string,
    operationId: string,
    input: LaborWorkbookApplyApproveRequest,
    idempotencyKey: string,
  ): Promise<LaborWorkbookApplyResponse>
  get(
    organizationId: string,
    caseId: string,
    operationId: string,
    canApprove: boolean,
  ): Promise<LaborWorkbookApplyResponse>
  list(
    organizationId: string,
    caseId: string,
    canApprove: boolean,
  ): Promise<LaborWorkbookAppliesResponse>
  markClaimed(
    exec: Queryable,
    organizationId: string,
    agentId: string,
    jobId: string,
    targetId: string,
    jobType: string,
  ): Promise<void>
  recordAgentAudit(
    exec: Queryable,
    organizationId: string,
    agentId: string,
    jobId: string,
    event: LaborWorkbookAuditEventRequest,
  ): Promise<boolean>
  finalizeAgentResult(
    exec: Queryable,
    organizationId: string,
    agentId: string,
    job: { id: string; type: string; target_id: string },
    result: JobResultRequest,
  ): Promise<{ readonly success: boolean; readonly errorCode: string | null }>
  markAttemptsExhausted(
    exec: Queryable,
    organizationId: string,
    agentId: string,
    targetId: string,
    jobId: string,
  ): Promise<void>
}

export function createLaborWorkbookApplyStore(
  pool: pg.Pool,
): LaborWorkbookApplyStore {
  const audit = createAuditService()

  return {
    async preview(
      actor: LaborWorkbookApplyActor,
      caseId: string,
      input: LaborWorkbookApplyPreviewRequest,
      idempotencyKey: string,
    ) {
      const requestHash = hashRequestBody({ caseId, input })
      return withTransaction<LaborWorkbookApplyResponse>(pool, async (client) => {
        const replay = await findIdempotent(
          client, actor.organizationId, PREVIEW_SCOPE, idempotencyKey,
        )
        if (replay !== undefined) {
          if (replay.requestHash !== requestHash) {
            throw new LaborWorkbookApplyError('IDEMPOTENCY_CONFLICT', 409)
          }
          return laborWorkbookApplyResponseSchema.parse(replay.responseBody)
        }

        const source = await client.query(
          `SELECT c.plate,c.office_number,c.lifecycle_status,c.insurer_id::text,
                  l.storage_root_key,l.relative_path,
                  a.target_sheet_version_id::text AS revision_id,
                  a.target_sheet_version AS revision_version,
                  s.current_version_id::text AS current_revision_id,
                  pv.id::text AS profile_version_id,pv.profile_version,
                  pv.schema_version,pv.target_sheet,pv.identity_checks,
                  p.status AS profile_status,pv.insurer_id::text AS profile_insurer_id
             FROM cases c
             JOIN case_locations l
               ON l.organization_id=c.organization_id AND l.case_id=c.id
                  AND l.verification_status='verified'
             JOIN labor_allocation_applications a
               ON a.organization_id=c.organization_id AND a.case_id=c.id
                  AND a.id=$3 AND a.status='completed'
             JOIN labor_sheets s
               ON s.organization_id=c.organization_id AND s.case_id=c.id
             JOIN labor_excel_profiles p
               ON p.organization_id=c.organization_id AND p.id=$4
             JOIN labor_excel_profile_versions pv ON pv.id=p.current_version_id
            WHERE c.organization_id=$1 AND c.id=$2`,
          [actor.organizationId, caseId, input.applicationId, input.profileId],
        )
        const src = source.rows[0] as Record<string, unknown> | undefined
        if (src === undefined) {
          const exists = await client.query(
            'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id=$2',
            [actor.organizationId, caseId],
          )
          if (exists.rows[0] === undefined) {
            throw new LaborWorkbookApplyError('CASE_NOT_FOUND', 404)
          }
          throw new LaborWorkbookApplyError('APPLICATION_NOT_FOUND', 404)
        }
        if (String(src.lifecycle_status) !== 'open') {
          throw new LaborWorkbookApplyError('CASE_CLOSED', 409)
        }
        if (String(src.revision_id) !== String(src.current_revision_id)) {
          throw new LaborWorkbookApplyError('REVISION_STALE', 409)
        }
        if (String(src.profile_status) !== 'active'
          || String(src.schema_version) !== 'labor-excel-profile/2.0.0'
          || src.target_sheet === null) {
          throw new LaborWorkbookApplyError('PROFILE_NOT_WRITABLE', 409)
        }
        if (src.profile_insurer_id !== null
          && String(src.profile_insurer_id) !== String(src.insurer_id)) {
          throw new LaborWorkbookApplyError('PROFILE_MISMATCH', 409)
        }
        const checks = src.identity_checks as { plate: boolean; officeNumber: boolean }
        if ((checks.plate && input.identityCellReferences.plateCell === null)
          || (checks.officeNumber && input.identityCellReferences.officeNumberCell === null)) {
          throw new LaborWorkbookApplyError('IDENTITY_CELL_REQUIRED', 409)
        }

        const lineResult = await client.query(
          `SELECT l.line_ordinal,l.target_line_ordinal,
                  l.suggested_labor_amount_minor::text AS proposed_labor,
                  l.applied_labor_amount_minor::text AS final_labor,
                  l.proposed_category_amounts,l.applied_category_amounts,
                  l.modified,l.category_modified,l.control_required,
                  i.description,i.action,i.part_code,i.part_code_source,i.damage_region
             FROM labor_allocation_applied_lines l
             LEFT JOIN labor_sheet_items i
               ON i.organization_id=l.organization_id
                  AND i.sheet_version_id=$3
                  AND i.ordinal=l.target_line_ordinal
            WHERE l.organization_id=$1 AND l.application_id=$2
            ORDER BY l.line_ordinal`,
          [actor.organizationId, input.applicationId, String(src.revision_id)],
        )
        const snapshot = buildLaborWorkbookApplySnapshot({
          organizationId: actor.organizationId,
          caseId,
          applicationId: input.applicationId,
          revisionId: String(src.revision_id),
          revisionVersion: safeNumber(src.revision_version),
          currentRevisionId: String(src.current_revision_id),
          currentRevisionVersion: safeNumber(src.revision_version),
          approvalStatus: 'approved',
          sourceRows: input.sourceRows,
          lines: (lineResult.rows as Record<string, unknown>[]).map((line) => ({
            lineOrdinal: safeNumber(line.line_ordinal),
            description: String(line.description ?? ''),
            operationType: String(line.action ?? ''),
            partCode: line.part_code === null ? null : String(line.part_code),
            partCodeSource: line.part_code_source as 'user_entered' | 'dictionary_suggested' | null,
            damageRegion: line.damage_region === null ? null : String(line.damage_region),
            proposedLaborAmountMinor: safeNumber(line.proposed_labor),
            finalLaborAmountMinor: safeNumber(line.final_labor),
            proposedCategoryAmounts: categoryAmounts(line.proposed_category_amounts),
            finalCategoryAmounts: categoryAmounts(line.applied_category_amounts),
            manuallyModified: Boolean(line.modified) || Boolean(line.category_modified),
            // AI satırındaki eksik-evidence bayrağı yalnız kullanıcı nihai değeri
            // açıkça düzeltmemişse çözümsüzdür. Öneri provenance'ı kaybolmaz;
            // düzeltme ise approved/final snapshot için insan çözüm sinyalidir.
            controlRequired: Boolean(line.control_required)
              && !line.modified
              && !line.category_modified,
          })),
        })

        const operationId = uuidv7()
        const jobId = snapshot.canPreview ? uuidv7() : null
        const fullRelativePath =
          `${String(src.relative_path).replace(/\/+$/u, '')}/${input.workbookRelativePath}`
        const identityCells = [
          ...(checks.plate && input.identityCellReferences.plateCell !== null
            ? [{ cell: input.identityCellReferences.plateCell, text: String(src.plate) }]
            : []),
          ...(checks.officeNumber && input.identityCellReferences.officeNumberCell !== null
            ? [{
                cell: input.identityCellReferences.officeNumberCell,
                text: String(src.office_number),
              }]
            : []),
        ]
        const signature = {
          sheetName: String(src.target_sheet),
          headers: input.headers,
          identityCells,
        }
        const rows = snapshot.rows.map((row) => ({ ...row, sourceRowHash: null }))
        const immutableRequest = {
          expectedSourceSha256: input.expectedSourceSha256,
          signature,
          rows,
        }
        const payload: JobPayload | null = jobId === null ? null : {
          kind: 'labor_workbook_preview',
          operationId,
          operationVersion: 1,
          storageRootKey: String(src.storage_root_key),
          relativePath: fullRelativePath,
          expectedSourceSha256: input.expectedSourceSha256,
          signature,
          changes: snapshot.rows.map((row) => ({
            cell: row.cell as string,
            newValue: row.newValue as string,
          })),
        }
        if (jobId !== null && payload !== null) {
          await client.query(
            `INSERT INTO jobs
               (id,organization_id,type,target_type,target_id,target_version,payload,max_attempts)
             VALUES ($1,$2,'preview_labor_workbook_apply','labor_workbook_apply',$3,1,$4::jsonb,3)`,
            [jobId, actor.organizationId, operationId, JSON.stringify(payload)],
          )
        }
        await client.query(
          `INSERT INTO labor_workbook_apply_operations
             (id,organization_id,case_id,application_id,revision_id,revision_version,
              profile_id,profile_version_id,profile_version,storage_root_key,
              relative_workbook_path,sheet_name,rule_version,
              approved_revision_snapshot_hash,immutable_request_snapshot,status,
              new_total_minor,control_required_row_count,preview_job_id,
              preview_idempotency_key,created_by_user_id,safe_error_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
                   $16,$17,$18,$19,$20,$21,$22)`,
          [
            operationId, actor.organizationId, caseId, input.applicationId,
            String(src.revision_id), safeNumber(src.revision_version), input.profileId,
            String(src.profile_version_id), safeNumber(src.profile_version),
            String(src.storage_root_key), fullRelativePath, String(src.target_sheet),
            LABOR_WORKBOOK_APPLY_RULE_VERSION, snapshot.snapshotHash,
            JSON.stringify(immutableRequest),
            snapshot.canPreview ? 'preview_pending' : 'control_required',
            snapshot.changedValueTotalMinor, snapshot.controlRequiredCount, jobId,
            idempotencyKey, actor.userId,
            snapshot.canPreview ? null : 'CONTROL_REQUIRED',
          ],
        )
        const created = await readOperation(
          client, actor.organizationId, caseId, operationId,
        )
        const body = response(created, true, true)
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: PREVIEW_SCOPE,
          key: idempotencyKey,
          requestHash,
          responseStatus: 202,
          responseBody: body,
          caseId,
        })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          action: snapshot.canPreview
            ? 'labor_workbook.preview_queued'
            : 'labor_workbook.control_required',
          entityType: 'labor_workbook_apply',
          entityId: operationId,
          details: {
            caseId,
            applicationId: input.applicationId,
            revisionId: String(src.revision_id),
            profileId: input.profileId,
            jobId,
            snapshotHash: snapshot.snapshotHash,
            controlRequiredRowCount: snapshot.controlRequiredCount,
          },
        })
        return body
      })
    },

    async approve(
      actor: LaborWorkbookApplyActor,
      caseId: string,
      operationId: string,
      input: LaborWorkbookApplyApproveRequest,
      idempotencyKey: string,
    ) {
      const requestHash = hashRequestBody({ caseId, operationId, input })
      return withTransaction<LaborWorkbookApplyResponse>(pool, async (client) => {
        const replay = await findIdempotent(
          client, actor.organizationId, APPROVE_SCOPE, idempotencyKey,
        )
        if (replay !== undefined) {
          if (replay.requestHash !== requestHash) {
            throw new LaborWorkbookApplyError('IDEMPOTENCY_CONFLICT', 409)
          }
          return laborWorkbookApplyResponseSchema.parse(replay.responseBody)
        }
        const row = await readOperation(
          client, actor.organizationId, caseId, operationId, true,
        )
        if (safeNumber(row.version) !== input.expectedVersion) {
          throw new LaborWorkbookApplyError('VERSION_CONFLICT', 409)
        }
        if (String(row.status) !== 'preview_ready'
          || String(row.preview_plan_hash) !== input.planHash
          || String(row.approved_revision_snapshot_hash)
            !== input.approvedRevisionSnapshotHash) {
          throw new LaborWorkbookApplyError('OPERATION_NOT_APPROVABLE', 409)
        }
        const current = await client.query(
          `SELECT s.current_version_id::text,
                  p.current_version_id::text AS current_profile_version_id,
                  p.status AS profile_status,a.status AS application_status
             FROM labor_sheets s
             JOIN labor_excel_profiles p
               ON p.organization_id=s.organization_id AND p.id=$3
             JOIN labor_allocation_applications a
               ON a.organization_id=s.organization_id AND a.case_id=s.case_id
                  AND a.id=$4
            WHERE s.organization_id=$1 AND s.case_id=$2`,
          [
            actor.organizationId, caseId, String(row.profile_id),
            String(row.application_id),
          ],
        )
        const currentRow = current.rows[0] as Record<string, unknown> | undefined
        if (currentRow === undefined
          || String(currentRow.current_version_id) !== String(row.revision_id)
          || String(currentRow.current_profile_version_id)
            !== String(row.profile_version_id)
          || String(currentRow.profile_status) !== 'active'
          || String(currentRow.application_status) !== 'completed') {
          throw new LaborWorkbookApplyError('REVISION_STALE', 409)
        }
        const preview = laborWorkbookPreviewResultSummarySchema.parse(
          row.preview_plan,
        )
        const immutable = row.immutable_request_snapshot as {
          signature: LaborWorkbookApplyJobPayload['signature']
          rows: Array<{ cell: string; newValue: string }>
        }
        const jobId = uuidv7()
        const approvedAt = utcDateTimeSchema.parse(new Date().toISOString())
        const payload = {
          kind: 'labor_workbook_apply' as const,
          operationId,
          operationVersion: safeNumber(row.version) + 1,
          storageRootKey: String(row.storage_root_key),
          relativePath: String(row.relative_workbook_path),
          expectedSourceSha256: String(row.source_workbook_hash),
          signature: immutable.signature,
          changes: immutable.rows.map((item) => ({
            cell: item.cell,
            newValue: item.newValue,
          })),
          preview: {
            version: preview.version,
            planHash: preview.planHash,
            createdAt: preview.createdAt,
            relativeWorkbookPath: preview.relativeWorkbookPath,
            sourceSha256: preview.sourceSha256,
            sourceSize: preview.sourceSize,
            sourceModifiedIso: preview.sourceModifiedIso,
            targetSheetName: preview.targetSheetName,
            targetWorksheetPart: preview.targetWorksheetPart,
            observations: preview.observations,
            changes: preview.changes,
          },
          approval: {
            confirmed: true as const,
            planHash: input.planHash,
            approvedByUserId: actor.userId,
            approvedAt,
          },
        } satisfies JobPayload
        await client.query(
          `INSERT INTO jobs
             (id,organization_id,type,target_type,target_id,target_version,payload,max_attempts)
           VALUES ($1,$2,'apply_labor_workbook','labor_workbook_apply',$3,$4,$5::jsonb,1)`,
          [
            jobId, actor.organizationId, operationId,
            safeNumber(row.version) + 1, JSON.stringify(payload),
          ],
        )
        await client.query(
          `UPDATE labor_workbook_apply_operations
              SET status='approved',version=version+1,apply_job_id=$4,
                  approval_idempotency_key=$5,approved_by_user_id=$6,
                  approved_at=$7,updated_at=now()
            WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
          [
            actor.organizationId, caseId, operationId, jobId,
            idempotencyKey, actor.userId, approvedAt,
          ],
        )
        const updated = await readOperation(
          client, actor.organizationId, caseId, operationId,
        )
        const body = response(updated, true, true)
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: APPROVE_SCOPE,
          key: idempotencyKey,
          requestHash,
          responseStatus: 202,
          responseBody: body,
          caseId,
        })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          action: 'labor_workbook.apply_approved',
          entityType: 'labor_workbook_apply',
          entityId: operationId,
          details: {
            caseId,
            applicationId: String(row.application_id),
            revisionId: String(row.revision_id),
            jobId,
            planHash: input.planHash,
            snapshotHash: input.approvedRevisionSnapshotHash,
          },
        })
        return body
      })
    },

    async get(
      organizationId: string,
      caseId: string,
      operationId: string,
      canApprove: boolean,
    ) {
      return response(
        await readOperation(pool, organizationId, caseId, operationId),
        true,
        canApprove,
      )
    },

    async list(
      organizationId: string,
      caseId: string,
      canApprove: boolean,
    ): Promise<LaborWorkbookAppliesResponse> {
      const found = await pool.query(
        `SELECT * FROM labor_workbook_apply_operations
          WHERE organization_id=$1 AND case_id=$2
          ORDER BY created_at DESC,id DESC LIMIT 100`,
        [organizationId, caseId],
      )
      return {
        operations: (found.rows as Record<string, unknown>[]).map(rowToDto),
        permissions: { canPreview: true, canApprove },
      }
    },

    async markClaimed(
      exec: Queryable,
      organizationId: string,
      agentId: string,
      jobId: string,
      targetId: string,
      jobType: string,
    ) {
      if (jobType !== 'apply_labor_workbook') return
      const changed = await exec.query(
        `UPDATE labor_workbook_apply_operations
            SET status='applying',version=version+1,updated_at=now()
          WHERE id=$1 AND organization_id=$2 AND apply_job_id=$3
            AND status='approved'
          RETURNING case_id::text,approved_by_user_id::text`,
        [targetId, organizationId, jobId],
      )
      const row = changed.rows[0] as Record<string, unknown> | undefined
      if (row !== undefined) {
        await audit.record(exec, {
          organizationId,
          actorUserId: String(row.approved_by_user_id),
          action: 'labor_workbook.apply_claimed',
          entityType: 'labor_workbook_apply',
          entityId: targetId,
          details: { caseId: String(row.case_id), jobId, agentId },
        })
      }
    },

    async recordAgentAudit(
      exec: Queryable,
      organizationId: string,
      agentId: string,
      jobId: string,
      event: LaborWorkbookAuditEventRequest,
    ): Promise<boolean> {
      const found = await exec.query(
        `SELECT o.id::text,o.case_id::text,o.application_id::text,o.revision_id::text,
                o.approved_by_user_id::text,o.preview_plan_hash
           FROM labor_workbook_apply_operations o
           JOIN jobs j ON j.id=o.apply_job_id
          WHERE o.organization_id=$1 AND j.id=$2
            AND j.leased_by_agent_id=$3 AND j.status='leased'`,
        [organizationId, jobId, agentId],
      )
      const row = found.rows[0] as Record<string, unknown> | undefined
      if (row === undefined
        || String(row.preview_plan_hash) !== event.planHash
        || String(row.approved_by_user_id) !== event.approvedByUserId) {
        return false
      }
      await audit.record(exec, {
        organizationId,
        actorUserId: event.approvedByUserId,
        action: `labor_workbook.writer_${event.phase}`,
        entityType: 'labor_workbook_apply',
        entityId: String(row.id),
        details: {
          caseId: String(row.case_id),
          applicationId: String(row.application_id),
          revisionId: String(row.revision_id),
          jobId,
          agentId,
          planHash: event.planHash,
          targetSheetName: event.targetSheetName,
          changedCellCount: event.cells.length,
          startSha256: event.startSha256,
          resultSha256: event.resultSha256,
          backupFileName: event.backupFileName,
          errorCode: event.errorCode,
        },
      })
      return true
    },

    async finalizeAgentResult(
      exec: Queryable,
      organizationId: string,
      agentId: string,
      job: { id: string; type: string; target_id: string },
      result: JobResultRequest,
    ): Promise<{ readonly success: boolean; readonly errorCode: string | null }> {
      if (job.type !== 'preview_labor_workbook_apply'
        && job.type !== 'apply_labor_workbook') {
        return { success: true, errorCode: null }
      }
      const found = await exec.query(
        `SELECT * FROM labor_workbook_apply_operations
          WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [job.target_id, organizationId],
      )
      const operation = found.rows[0] as Record<string, unknown> | undefined
      if (operation === undefined) {
        return { success: false, errorCode: 'LABOR_WORKBOOK_OPERATION_NOT_FOUND' }
      }
      const isPreview = job.type === 'preview_labor_workbook_apply'
      if (result.outcome !== 'verified' || result.laborWorkbook === undefined) {
        await exec.query(
          `UPDATE labor_workbook_apply_operations
              SET status=$3,version=version+1,safe_error_code=$4,updated_at=now()
            WHERE id=$1 AND organization_id=$2`,
          [
            job.target_id, organizationId,
            isPreview ? 'control_required' : 'failed',
            (result.errorCode ?? 'writer_failed').toUpperCase(),
          ],
        )
        return {
          success: false,
          errorCode: (result.errorCode ?? 'writer_failed').toUpperCase(),
        }
      }
      if (isPreview && result.laborWorkbook.kind === 'preview') {
        const immutable = operation.immutable_request_snapshot as {
          rows: Array<Record<string, unknown>>
        }
        const plannedByCell = new Map(
          immutable.rows.map((row) => [String(row.cell), row]),
        )
        let previousTotal = 0
        let changed = 0
        let unchanged = 0
        let invalid = false
        const observedCells = new Set<string>()
        for (const item of result.laborWorkbook.observations) {
          const planned = plannedByCell.get(item.cell)
          const oldMinor = parseLaborWorkbookMinorValue(item.previousValue)
          if (planned === undefined
            || String(planned.newValue) !== item.newValue
            || oldMinor === null
            || observedCells.has(item.cell)) {
            invalid = true
            continue
          }
          observedCells.add(item.cell)
          previousTotal += oldMinor
          if (item.previousValue === item.newValue) unchanged += 1
          else changed += 1
        }
        if (observedCells.size !== plannedByCell.size
          || changed !== result.laborWorkbook.changes.length) {
          invalid = true
        }
        await exec.query(
          `UPDATE labor_workbook_apply_operations
              SET status=$3,version=version+1,source_workbook_hash=$4,
                  preview_plan_hash=$5,preview_plan=$6::jsonb,
                  previous_total_minor=$7,changed_row_count=$8,
                  unchanged_row_count=$9,control_required_row_count=$10,
                  safe_error_code=$11,updated_at=now()
            WHERE id=$1 AND organization_id=$2`,
          [
            job.target_id, organizationId,
            invalid ? 'control_required' : 'preview_ready',
            result.laborWorkbook.sourceSha256,
            result.laborWorkbook.planHash,
            JSON.stringify(result.laborWorkbook),
            previousTotal, changed, unchanged,
            invalid ? 1 : 0,
            invalid ? 'SOURCE_ROW_VALUE_INVALID' : null,
          ],
        )
        await audit.record(exec, {
          organizationId,
          action: invalid
            ? 'labor_workbook.preview_control_required'
            : 'labor_workbook.preview_ready',
          entityType: 'labor_workbook_apply',
          entityId: job.target_id,
          details: {
            jobId: job.id,
            agentId,
            planHash: result.laborWorkbook.planHash,
            sourceSha256: result.laborWorkbook.sourceSha256,
            changedRowCount: changed,
            unchangedRowCount: unchanged,
            controlRequiredRowCount: invalid ? 1 : 0,
          },
        })
        return {
          success: !invalid,
          errorCode: invalid ? 'SOURCE_ROW_VALUE_INVALID' : null,
        }
      } else if (!isPreview && result.laborWorkbook.kind === 'apply') {
        if (String(operation.preview_plan_hash) !== result.laborWorkbook.planHash
          || String(operation.source_workbook_hash) !== result.laborWorkbook.startSha256) {
          await exec.query(
            `UPDATE labor_workbook_apply_operations
                SET status='failed',version=version+1,
                    safe_error_code='RESULT_HASH_MISMATCH',updated_at=now()
              WHERE id=$1 AND organization_id=$2`,
            [job.target_id, organizationId],
          )
          return { success: false, errorCode: 'RESULT_HASH_MISMATCH' }
        }
        await exec.query(
          `UPDATE labor_workbook_apply_operations
              SET status='completed',version=version+1,result_workbook_hash=$3,
                  backup_file_name=$4,safe_error_code=NULL,
                  completed_at=now(),updated_at=now()
            WHERE id=$1 AND organization_id=$2`,
          [
            job.target_id, organizationId,
            result.laborWorkbook.resultSha256,
            result.laborWorkbook.backupFileName,
          ],
        )
        await audit.record(exec, {
          organizationId,
          actorUserId: operation.approved_by_user_id === null
            ? undefined
            : String(operation.approved_by_user_id),
          action: 'labor_workbook.apply_completed',
          entityType: 'labor_workbook_apply',
          entityId: job.target_id,
          details: {
            caseId: String(operation.case_id),
            applicationId: String(operation.application_id),
            revisionId: String(operation.revision_id),
            jobId: job.id,
            agentId,
            planHash: result.laborWorkbook.planHash,
            startSha256: result.laborWorkbook.startSha256,
            resultSha256: result.laborWorkbook.resultSha256,
            changedRowCount: result.laborWorkbook.cells.length,
            backupFileName: result.laborWorkbook.backupFileName,
          },
        })
        return { success: true, errorCode: null }
      }
      return { success: false, errorCode: 'LABOR_WORKBOOK_RESULT_KIND_INVALID' }
    },

    async markAttemptsExhausted(
      exec: Queryable,
      organizationId: string,
      agentId: string,
      targetId: string,
      jobId: string,
    ) {
      await exec.query(
        `UPDATE labor_workbook_apply_operations
            SET status='failed',version=version+1,
                safe_error_code='ATTEMPTS_EXHAUSTED',updated_at=now()
          WHERE id=$1 AND organization_id=$2
            AND status NOT IN ('completed','control_required','failed')`,
        [targetId, organizationId],
      )
      await audit.record(exec, {
        organizationId,
        action: 'labor_workbook.apply_failed',
        entityType: 'labor_workbook_apply',
        entityId: targetId,
        details: { jobId, agentId, errorCode: 'ATTEMPTS_EXHAUSTED' },
      })
    },
  }
}
