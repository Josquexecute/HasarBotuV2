import type pg from 'pg'
import {
  workspaceProvisioningSchema,
  workspaceProvisioningResponseSchema,
  type WorkspaceProvisioning,
  type WorkspacePlanRequest,
} from '@hasarbotu/contracts'
import {
  CASE_WORKSPACE_SUBDIRECTORIES,
  buildCaseWorkspaceBasePath,
  selectAvailableCaseWorkspacePath,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { insertIdempotent, type IdempotentRecord } from '../db/idempotency.js'

export const WORKSPACE_PLAN_SCOPE = 'case.workspace.plan'
export const WORKSPACE_APPROVE_SCOPE = 'case.workspace.approve'

interface WorkspaceRow {
  id: string
  case_id: string
  storage_root_key: string
  relative_path: string
  status: string
  last_error_code: string | null
  approved_at: Date | null
  ready_at: Date | null
  created_at: Date
  updated_at: Date
}

const WORKSPACE_FIELDS = `id, case_id, storage_root_key, relative_path, status, last_error_code,
  approved_at, ready_at, created_at, updated_at`

function toDto(row: WorkspaceRow): WorkspaceProvisioning {
  return workspaceProvisioningSchema.parse({
    id: row.id,
    caseId: row.case_id,
    storageRootKey: row.storage_root_key,
    relativePath: row.relative_path,
    status: row.status,
    requiredSubdirectories: CASE_WORKSPACE_SUBDIRECTORIES,
    lastErrorCode: row.last_error_code,
    canApprove: row.status === 'planned',
    canRetry: row.status === 'failed',
    approvedAt: row.approved_at?.toISOString() ?? null,
    readyAt: row.ready_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface IdempotencyInput {
  readonly key: string
  readonly requestHash: string
}

export type PlanOutcome =
  | { readonly kind: 'ok'; readonly provisioning: WorkspaceProvisioning }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_root' }
  | { readonly kind: 'notification_date_required' }
  | { readonly kind: 'location_conflict' }
  | { readonly kind: 'active_conflict' }
  | { readonly kind: 'path_exhausted' }

export type ApproveOutcome =
  | { readonly kind: 'ok'; readonly provisioning: WorkspaceProvisioning }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'stale' }

export function createWorkspaceStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    async findIdempotent(
      organizationId: string,
      scope: string,
      key: string,
    ): Promise<IdempotentRecord | undefined> {
      const result = await pool.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE organization_id=$1 AND scope=$2 AND idem_key=$3',
        [organizationId, scope, key],
      )
      const row = result.rows[0] as { request_hash: string; response_status: number; response_body: unknown } | undefined
      return row === undefined
        ? undefined
        : { requestHash: row.request_hash, responseStatus: row.response_status, responseBody: row.response_body }
    },

    async findPlan(organizationId: string, caseId: string, planId: string): Promise<WorkspaceProvisioning | undefined> {
      const result = await pool.query(
        `SELECT ${WORKSPACE_FIELDS} FROM case_workspace_provisionings
         WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3`,
        [organizationId, caseId, planId],
      )
      const row = result.rows[0] as WorkspaceRow | undefined
      return row === undefined ? undefined : toDto(row)
    },

    async findCurrentPlan(organizationId: string, caseId: string): Promise<WorkspaceProvisioning | undefined> {
      const result = await pool.query(
        `SELECT ${WORKSPACE_FIELDS} FROM case_workspace_provisionings
         WHERE organization_id=$1 AND case_id::text=$2`,
        [organizationId, caseId],
      )
      const row = result.rows[0] as WorkspaceRow | undefined
      return row === undefined ? undefined : toDto(row)
    },

    async createPlan(
      actor: ActorContext,
      caseId: string,
      input: WorkspacePlanRequest,
      idempotency: IdempotencyInput,
      transaction?: pg.PoolClient,
    ): Promise<PlanOutcome> {
      return withTransaction(pool, async (client): Promise<PlanOutcome> => {
        const caseResult = await client.query(
          `SELECT plate, notification_date::text AS notification_date
           FROM cases WHERE organization_id=$1 AND id::text=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const caseRow = caseResult.rows[0] as { plate: string; notification_date: string | null } | undefined
        if (caseRow === undefined) return { kind: 'not_found' }
        if (caseRow.notification_date === null) return { kind: 'notification_date_required' }

        const root = await client.query(
          'SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active=true',
          [actor.organizationId, input.storageRootKey],
        )
        if (root.rowCount === 0) return { kind: 'unknown_root' }

        const location = await client.query(
          'SELECT 1 FROM case_locations WHERE organization_id=$1 AND case_id::text=$2',
          [actor.organizationId, caseId],
        )
        if (location.rowCount !== 0) return { kind: 'location_conflict' }

        const existing = await client.query(
          'SELECT 1 FROM case_workspace_provisionings WHERE organization_id=$1 AND case_id::text=$2',
          [actor.organizationId, caseId],
        )
        if (existing.rowCount !== 0) return { kind: 'active_conflict' }

        const base = buildCaseWorkspaceBasePath(caseRow.notification_date, caseRow.plate)
        if (!base.ok) return { kind: base.error === 'path_limit_exhausted' ? 'path_exhausted' : 'notification_date_required' }

        // Aynı org/root/ay/plaka için sıra tahsisini transaction boyunca tekilleştirir.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${actor.organizationId}:${input.storageRootKey}:${base.relativePath}`,
        ])
        const occupied = await client.query(
          `SELECT relative_path FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           UNION ALL
           SELECT relative_path FROM case_workspace_provisionings WHERE organization_id=$1 AND storage_root_key=$2`,
          [actor.organizationId, input.storageRootKey],
        )
        const selected = selectAvailableCaseWorkspacePath(
          base.relativePath,
          (occupied.rows as { relative_path: string }[]).map((row) => row.relative_path),
        )
        if (!selected.ok) return { kind: 'path_exhausted' }

        const inserted = await client.query(
          `INSERT INTO case_workspace_provisionings
           (id,organization_id,case_id,storage_root_key,relative_path,status,created_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,'planned',$6,$7)
           RETURNING ${WORKSPACE_FIELDS}`,
          [uuidv7(), actor.organizationId, caseId, input.storageRootKey, selected.relativePath, actor.actorUserId, actor.requestId],
        )
        const provisioning = toDto(inserted.rows[0] as WorkspaceRow)
        const response = workspaceProvisioningResponseSchema.parse({ provisioning })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'case.workspace_planned',
          entityType: 'case_workspace_provisioning',
          entityId: provisioning.id,
          details: {
            caseId,
            storageRootKey: provisioning.storageRootKey,
            relativePath: provisioning.relativePath,
            requiredSubdirectoryCount: CASE_WORKSPACE_SUBDIRECTORIES.length,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: WORKSPACE_PLAN_SCOPE,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody: response,
          caseId,
        })
        return { kind: 'ok', provisioning }
      }, transaction)
    },

    async approvePlan(
      actor: ActorContext,
      caseId: string,
      planId: string,
      idempotency: IdempotencyInput,
      transaction?: pg.PoolClient,
    ): Promise<ApproveOutcome> {
      return withTransaction(pool, async (client): Promise<ApproveOutcome> => {
        const selected = await client.query(
          `SELECT ${WORKSPACE_FIELDS}, active_job_id FROM case_workspace_provisionings
           WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
          [actor.organizationId, caseId, planId],
        )
        const row = selected.rows[0] as (WorkspaceRow & { active_job_id: string | null }) | undefined
        if (row === undefined) return { kind: 'not_found' }
        if (row.status === 'stale' || row.status === 'cancelled') return { kind: 'stale' }

        if (!['queued', 'applying', 'verifying', 'ready'].includes(row.status)) {
          const active = await client.query(
            `SELECT id FROM jobs WHERE organization_id=$1 AND target_type='workspace_provisioning'
             AND target_id=$2 AND status IN ('pending','leased') ORDER BY created_at DESC LIMIT 1`,
            [actor.organizationId, planId],
          )
          const jobId = (active.rows[0] as { id: string } | undefined)?.id ?? uuidv7()
          if (active.rowCount === 0) {
            await client.query(
              `INSERT INTO jobs
               (id,organization_id,type,status,target_type,target_id,target_version,payload,max_attempts)
               VALUES ($1,$2,'provision_case_workspace','pending','workspace_provisioning',$3,0,$4::jsonb,5)`,
              [
                jobId,
                actor.organizationId,
                planId,
                JSON.stringify({
                  storageRootKey: row.storage_root_key,
                  relativePath: row.relative_path,
                  kind: 'workspace',
                  requiredSubdirectories: CASE_WORKSPACE_SUBDIRECTORIES,
                }),
              ],
            )
          }
          await client.query(
            `UPDATE case_workspace_provisionings SET status='approved', approved_by_user_id=$2,
             approved_at=COALESCE(approved_at,now()), active_job_id=$3, last_error_code=NULL, updated_at=now()
             WHERE id=$1`,
            [planId, actor.actorUserId, jobId],
          )
          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: row.status === 'failed' ? 'case.workspace_retry_approved' : 'case.workspace_approved',
            entityType: 'case_workspace_provisioning',
            entityId: planId,
            details: { caseId, jobId, storageRootKey: row.storage_root_key, relativePath: row.relative_path },
          })
          await client.query(
            "UPDATE case_workspace_provisionings SET status='queued', updated_at=now() WHERE id=$1",
            [planId],
          )
          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: 'case.workspace_queued',
            entityType: 'case_workspace_provisioning',
            entityId: planId,
            details: { caseId, jobId },
          })
        }

        const finalResult = await client.query(
          `SELECT ${WORKSPACE_FIELDS} FROM case_workspace_provisionings WHERE id=$1`,
          [planId],
        )
        const provisioning = toDto(finalResult.rows[0] as WorkspaceRow)
        const response = workspaceProvisioningResponseSchema.parse({ provisioning })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: WORKSPACE_APPROVE_SCOPE,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 202,
          responseBody: response,
          caseId,
        })
        return { kind: 'ok', provisioning }
      }, transaction)
    },
  }
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>
