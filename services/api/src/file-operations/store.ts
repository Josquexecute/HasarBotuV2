import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  fileOperationResponseSchema,
  fileOperationSchema,
  type FileOperation,
  type FileOperationPlanRequest,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { insertIdempotent, type IdempotentRecord } from '../db/idempotency.js'

export const FILE_OPERATION_PLAN_SCOPE = 'case.file_operation.plan'
export const FILE_OPERATION_APPROVE_SCOPE = 'case.file_operation.approve'
export const FILE_OPERATION_CANCEL_SCOPE = 'case.file_operation.cancel'
export const FILE_OPERATION_IDEMPOTENCY_CONSTRAINT = 'case_file_operations_idempotency_unique'

const TERMINAL_STATUSES = new Set(['ready', 'stale', 'cancelled'])

interface FileOperationRow {
  id: string
  case_id: string
  operation_type: 'rename_case_workspace' | 'move_case_workspace'
  source_storage_root_key: string
  source_relative_path: string
  destination_storage_root_key: string
  destination_relative_path: string
  expected_location_id: string
  expected_location_version: number
  status: string
  strategy: 'atomic_rename' | 'staged_copy'
  manifest_hash: string | null
  file_count: number | null
  directory_count: number | null
  total_bytes: string | null
  cleanup_state: string
  failure_reason_code: string | null
  version: number
  active_job_id: string | null
  approved_at: Date | null
  finalized_at: Date | null
  created_at: Date
  updated_at: Date
}

const OPERATION_FIELDS = `id,case_id,operation_type,source_storage_root_key,source_relative_path,
  destination_storage_root_key,destination_relative_path,expected_location_id,expected_location_version,
  status,strategy,manifest_hash,file_count,directory_count,total_bytes,cleanup_state,failure_reason_code,
  version,active_job_id,approved_at,finalized_at,created_at,updated_at`

function toDto(row: FileOperationRow): FileOperation {
  return fileOperationSchema.parse({
    id: row.id,
    caseId: row.case_id,
    operationType: row.operation_type,
    source: { storageRootKey: row.source_storage_root_key, relativePath: row.source_relative_path },
    destination: { storageRootKey: row.destination_storage_root_key, relativePath: row.destination_relative_path },
    expectedLocationVersion: row.expected_location_version,
    status: row.status,
    strategy: row.strategy,
    manifestHash: row.manifest_hash,
    fileCount: row.file_count,
    directoryCount: row.directory_count,
    totalBytes: row.total_bytes === null ? null : Number(row.total_bytes),
    cleanupState: row.cleanup_state,
    failureReasonCode: row.failure_reason_code,
    version: row.version,
    canApprove: row.status === 'planned',
    canCancel: row.status === 'planned' || row.status === 'queued',
    approvedAt: row.approved_at?.toISOString() ?? null,
    finalizedAt: row.finalized_at?.toISOString() ?? null,
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

export type FileOperationPlanOutcome =
  | { readonly kind: 'ok'; readonly operation: FileOperation }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'location_required' }
  | { readonly kind: 'location_not_verified' }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'unknown_root' }
  | { readonly kind: 'active_conflict' }
  | { readonly kind: 'destination_conflict' }
  | { readonly kind: 'invalid_rename' }
  | { readonly kind: 'same_destination' }

export type FileOperationCommandOutcome =
  | { readonly kind: 'ok'; readonly operation: FileOperation }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'conflict' }

function idempotencyKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function parentPath(relativePath: string): string {
  const segments = relativePath.split('/')
  segments.pop()
  return segments.join('/')
}

function caseFold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('tr-TR')
}

function operationTempPath(destinationPath: string, operationId: string): string {
  const parent = parentPath(destinationPath)
  return `${parent.length === 0 ? '' : `${parent}/`}.hasarbotu-rename-${operationId}`
}

export interface LifecycleFileOperationInput {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
  readonly caseId: string
  readonly lifecycleOperationId: string
  readonly source: { readonly locationId: string; readonly storageRootKey: string; readonly relativePath: string; readonly version: number }
  readonly destination: { readonly storageRootKey: string; readonly relativePath: string }
}

/**
 * Paket 21 icin server-turetilmis hedefi mevcut Paket 20 saga/job protokolune
 * plan+approve+enqueue eder. Cagiran transaction icinde case/location kilidini
 * ve lifecycle optimistic snapshot'ini dogrulamis olmalidir.
 */
export async function enqueueLifecycleFileOperation(
  client: pg.PoolClient,
  input: LifecycleFileOperationInput,
): Promise<{ readonly operationId: string; readonly jobId: string; readonly status: 'queued' }> {
  const audit = createAuditService()
  const active = await client.query(
    `SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND case_id=$2
     AND status NOT IN ('ready','stale','cancelled')`,
    [input.organizationId, input.caseId],
  )
  if (active.rowCount !== 0) throw new Error('lifecycle_file_operation_conflict')
  const root = await client.query(
    'SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active=true',
    [input.organizationId, input.destination.storageRootKey],
  )
  if (root.rowCount === 0) throw new Error('lifecycle_destination_root_inactive')
  const collision = await client.query(
    `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
     AND lower(relative_path)=lower($3) AND id<>$4`,
    [input.organizationId, input.destination.storageRootKey, input.destination.relativePath, input.source.locationId],
  )
  if (collision.rowCount !== 0) throw new Error('lifecycle_destination_conflict')

  const operationId = uuidv7()
  const jobId = uuidv7()
  const sameRoot = input.source.storageRootKey === input.destination.storageRootKey
  const operationType = sameRoot ? 'rename_case_workspace' : 'move_case_workspace'
  const strategy = sameRoot ? 'atomic_rename' : 'staged_copy'
  const keyHash = createHash('sha256').update(`lifecycle:${input.lifecycleOperationId}`).digest('hex')
  const requestHash = createHash('sha256').update(JSON.stringify({
    lifecycleOperationId: input.lifecycleOperationId,
    source: input.source,
    destination: input.destination,
  })).digest('hex')
  await client.query(
    `INSERT INTO case_file_operations
     (id,organization_id,case_id,operation_type,source_storage_root_key,source_relative_path,
      destination_storage_root_key,destination_relative_path,expected_location_id,expected_location_version,
      status,strategy,idempotency_key_hash,request_hash,created_by_user_id,approved_by_user_id,
      request_id,approved_at,version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,$13,$14,$14,$15,now(),2)`,
    [
      operationId, input.organizationId, input.caseId, operationType,
      input.source.storageRootKey, input.source.relativePath,
      input.destination.storageRootKey, input.destination.relativePath,
      input.source.locationId, input.source.version, strategy, keyHash, requestHash,
      input.actorUserId, input.requestId,
    ],
  )
  await client.query(
    `INSERT INTO jobs
     (id,organization_id,type,status,target_type,target_id,target_version,payload,max_attempts)
     VALUES ($1,$2,$3,'pending','file_operation',$4,2,$5::jsonb,5)`,
    [jobId, input.organizationId, operationType, operationId, JSON.stringify({
      kind: 'file_operation',
      operationId,
      operationVersion: 2,
      operationType,
      source: { storageRootKey: input.source.storageRootKey, relativePath: input.source.relativePath },
      destination: input.destination,
      strategy,
      plannedAt: new Date().toISOString(),
      stagingRelativePath: `.hasarbotu-staging/${operationId}`,
      temporaryRelativePath: operationTempPath(input.destination.relativePath, operationId),
    })],
  )
  await client.query('UPDATE case_file_operations SET active_job_id=$2 WHERE id=$1', [operationId, jobId])
  for (const action of ['file_operation.planned', 'file_operation.approved', 'file_operation.queued']) {
    await audit.record(client, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action,
      entityType: 'case_file_operation',
      entityId: operationId,
      details: {
        caseId: input.caseId,
        lifecycleOperationId: input.lifecycleOperationId,
        jobId,
        operationType,
        source: { storageRootKey: input.source.storageRootKey, relativePath: input.source.relativePath },
        destination: input.destination,
        strategy,
      },
    })
  }
  return { operationId, jobId, status: 'queued' }
}

export function createFileOperationStore(pool: pg.Pool) {
  const audit = createAuditService()

  async function findIdempotent(organizationId: string, scope: string, key: string): Promise<IdempotentRecord | undefined> {
    const result = await pool.query(
      'SELECT request_hash,response_status,response_body FROM idempotency_keys WHERE organization_id=$1 AND scope=$2 AND idem_key=$3',
      [organizationId, scope, key],
    )
    const row = result.rows[0] as { request_hash: string; response_status: number; response_body: unknown } | undefined
    return row === undefined ? undefined : {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    }
  }

  return {
    findIdempotent,

    async findOperation(organizationId: string, caseId: string, operationId: string): Promise<FileOperation | undefined> {
      const result = await pool.query(
        `SELECT ${OPERATION_FIELDS} FROM case_file_operations
         WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3`,
        [organizationId, caseId, operationId],
      )
      const row = result.rows[0] as FileOperationRow | undefined
      return row === undefined ? undefined : toDto(row)
    },

    async createPlan(
      actor: ActorContext,
      caseId: string,
      input: FileOperationPlanRequest,
      idempotency: IdempotencyInput,
    ): Promise<FileOperationPlanOutcome> {
      return withTransaction(pool, async (client): Promise<FileOperationPlanOutcome> => {
        const caseResult = await client.query(
          'SELECT 1 FROM cases WHERE organization_id=$1 AND id::text=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        if (caseResult.rowCount === 0) return { kind: 'not_found' }
        const locationResult = await client.query(
          `SELECT id,storage_root_key,relative_path,verification_status,version FROM case_locations
           WHERE organization_id=$1 AND case_id::text=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const location = locationResult.rows[0] as {
          id: string
          storage_root_key: string
          relative_path: string
          verification_status: string
          version: number
        } | undefined
        if (location === undefined) return { kind: 'location_required' }
        if (location.verification_status !== 'verified') return { kind: 'location_not_verified' }
        if (location.version !== input.expectedLocationVersion) return { kind: 'version_conflict' }

        const root = await client.query(
          'SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active=true',
          [actor.organizationId, input.destinationStorageRootKey],
        )
        if (root.rowCount === 0) return { kind: 'unknown_root' }

        const sourceFolded = caseFold(location.relative_path)
        const destinationFolded = caseFold(input.destinationRelativePath)
        const sameRoot = location.storage_root_key === input.destinationStorageRootKey
        if (sameRoot && location.relative_path === input.destinationRelativePath) return { kind: 'same_destination' }
        if (input.operationType === 'rename_case_workspace'
          && (!sameRoot || parentPath(location.relative_path) !== parentPath(input.destinationRelativePath))) {
          return { kind: 'invalid_rename' }
        }

        const active = await client.query(
          `SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND case_id=$2
           AND status NOT IN ('ready','stale','cancelled')`,
          [actor.organizationId, caseId],
        )
        if (active.rowCount !== 0) return { kind: 'active_conflict' }

        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${actor.organizationId}:${input.destinationStorageRootKey}:${destinationFolded}`,
        ])
        const occupiedLocation = await client.query(
          `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           AND lower(relative_path)=lower($3) AND id<>$4`,
          [actor.organizationId, input.destinationStorageRootKey, input.destinationRelativePath, location.id],
        )
        const occupiedReservation = await client.query(
          `SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND destination_storage_root_key=$2
           AND lower(destination_relative_path)=lower($3) AND status NOT IN ('ready','stale','cancelled')`,
          [actor.organizationId, input.destinationStorageRootKey, input.destinationRelativePath],
        )
        if (occupiedLocation.rowCount !== 0 || occupiedReservation.rowCount !== 0) return { kind: 'destination_conflict' }
        // Case-only rename yalnız aynı kaydın farklı harf biçimidir; başka hedefe
        // sessiz merge/overwrite hâlâ yukarıdaki org-kapsamlı kontrollerle reddedilir.
        if (sameRoot && sourceFolded === destinationFolded && input.operationType !== 'rename_case_workspace') {
          return { kind: 'destination_conflict' }
        }

        const operationId = uuidv7()
        const strategy = sameRoot ? 'atomic_rename' : 'staged_copy'
        const inserted = await client.query(
          `INSERT INTO case_file_operations
           (id,organization_id,case_id,operation_type,source_storage_root_key,source_relative_path,
            destination_storage_root_key,destination_relative_path,expected_location_id,expected_location_version,
            status,strategy,idempotency_key_hash,request_hash,created_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,$12,$13,$14,$15)
           RETURNING ${OPERATION_FIELDS}`,
          [
            operationId,
            actor.organizationId,
            caseId,
            input.operationType,
            location.storage_root_key,
            location.relative_path,
            input.destinationStorageRootKey,
            input.destinationRelativePath,
            location.id,
            location.version,
            strategy,
            idempotencyKeyHash(idempotency.key),
            idempotency.requestHash,
            actor.actorUserId,
            actor.requestId,
          ],
        )
        const operation = toDto(inserted.rows[0] as FileOperationRow)
        const response = fileOperationResponseSchema.parse({ operation })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'file_operation.planned',
          entityType: 'case_file_operation',
          entityId: operation.id,
          details: {
            caseId,
            operationType: operation.operationType,
            source: operation.source,
            destination: operation.destination,
            strategy: operation.strategy,
            expectedLocationVersion: operation.expectedLocationVersion,
            manifestPending: true,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: FILE_OPERATION_PLAN_SCOPE,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody: response,
          caseId,
        })
        return { kind: 'ok', operation }
      })
    },

    async approve(
      actor: ActorContext,
      caseId: string,
      operationId: string,
      idempotency: IdempotencyInput,
    ): Promise<FileOperationCommandOutcome> {
      return withTransaction(pool, async (client): Promise<FileOperationCommandOutcome> => {
        const selected = await client.query(
          `SELECT ${OPERATION_FIELDS} FROM case_file_operations
           WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
          [actor.organizationId, caseId, operationId],
        )
        const row = selected.rows[0] as FileOperationRow | undefined
        if (row === undefined) return { kind: 'not_found' }
        if (TERMINAL_STATUSES.has(row.status)) return { kind: 'stale' }
        if (row.status !== 'planned') return { kind: 'conflict' }

        const locationResult = await client.query(
          `SELECT id,storage_root_key,relative_path,verification_status,version FROM case_locations
           WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const location = locationResult.rows[0] as {
          id: string; storage_root_key: string; relative_path: string; verification_status: string; version: number
        } | undefined
        if (location === undefined
          || location.id !== row.expected_location_id
          || location.version !== row.expected_location_version
          || location.storage_root_key !== row.source_storage_root_key
          || location.relative_path !== row.source_relative_path
          || location.verification_status !== 'verified') {
          await client.query(
            "UPDATE case_file_operations SET status='stale',failure_reason_code='location_changed',version=version+1,updated_at=now() WHERE id=$1",
            [operationId],
          )
          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: 'file_operation.failed',
            entityType: 'case_file_operation',
            entityId: operationId,
            details: { caseId, errorCode: 'location_changed', state: 'stale' },
          })
          return { kind: 'stale' }
        }

        const destinationRoot = await client.query(
          'SELECT 1 FROM storage_roots WHERE organization_id=$1 AND root_key=$2 AND is_active=true',
          [actor.organizationId, row.destination_storage_root_key],
        )
        if (destinationRoot.rowCount === 0) {
          await client.query(
            "UPDATE case_file_operations SET status='stale',failure_reason_code='destination_root_inactive',version=version+1,updated_at=now() WHERE id=$1",
            [operationId],
          )
          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: 'file_operation.failed',
            entityType: 'case_file_operation',
            entityId: operationId,
            details: { caseId, errorCode: 'destination_root_inactive', state: 'stale' },
          })
          return { kind: 'stale' }
        }

        const destinationConflict = await client.query(
          `SELECT 1 FROM case_locations WHERE organization_id=$1 AND storage_root_key=$2
           AND lower(relative_path)=lower($3) AND id<>$4`,
          [actor.organizationId, row.destination_storage_root_key, row.destination_relative_path, location.id],
        )
        if (destinationConflict.rowCount !== 0) return { kind: 'conflict' }

        const jobId = uuidv7()
        const nextVersion = row.version + 1
        await client.query(
          `INSERT INTO jobs
           (id,organization_id,type,status,target_type,target_id,target_version,payload,max_attempts)
           VALUES ($1,$2,$3,'pending','file_operation',$4,$5,$6::jsonb,5)`,
          [
            jobId,
            actor.organizationId,
            row.operation_type,
            operationId,
            nextVersion,
            JSON.stringify({
              kind: 'file_operation',
              operationId,
              operationVersion: nextVersion,
              operationType: row.operation_type,
              source: { storageRootKey: row.source_storage_root_key, relativePath: row.source_relative_path },
              destination: { storageRootKey: row.destination_storage_root_key, relativePath: row.destination_relative_path },
              strategy: row.strategy,
              plannedAt: row.created_at.toISOString(),
              stagingRelativePath: `.hasarbotu-staging/${operationId}`,
              temporaryRelativePath: operationTempPath(row.destination_relative_path, operationId),
            }),
          ],
        )
        await client.query(
          `UPDATE case_file_operations SET status='approved',approved_by_user_id=$2,approved_at=now(),
           active_job_id=$3,failure_reason_code=NULL,version=$4,updated_at=now() WHERE id=$1`,
          [operationId, actor.actorUserId, jobId, nextVersion],
        )
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'file_operation.approved',
          entityType: 'case_file_operation',
          entityId: operationId,
          details: { caseId, jobId, operationType: row.operation_type, source: {
            storageRootKey: row.source_storage_root_key, relativePath: row.source_relative_path,
          }, destination: {
            storageRootKey: row.destination_storage_root_key, relativePath: row.destination_relative_path,
          }, strategy: row.strategy },
        })
        await client.query("UPDATE case_file_operations SET status='queued',updated_at=now() WHERE id=$1", [operationId])
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'file_operation.queued',
          entityType: 'case_file_operation',
          entityId: operationId,
          details: { caseId, jobId },
        })

        const final = await client.query(`SELECT ${OPERATION_FIELDS} FROM case_file_operations WHERE id=$1`, [operationId])
        const operation = toDto(final.rows[0] as FileOperationRow)
        const response = fileOperationResponseSchema.parse({ operation })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: FILE_OPERATION_APPROVE_SCOPE,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 202,
          responseBody: response,
          caseId,
        })
        return { kind: 'ok', operation }
      })
    },

    async cancel(
      actor: ActorContext,
      caseId: string,
      operationId: string,
      idempotency: IdempotencyInput,
    ): Promise<FileOperationCommandOutcome> {
      return withTransaction(pool, async (client): Promise<FileOperationCommandOutcome> => {
        const selected = await client.query(
          `SELECT ${OPERATION_FIELDS} FROM case_file_operations
           WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
          [actor.organizationId, caseId, operationId],
        )
        const row = selected.rows[0] as FileOperationRow | undefined
        if (row === undefined) return { kind: 'not_found' }
        if (row.status === 'cancelled') return { kind: 'stale' }
        if (row.status !== 'planned' && row.status !== 'queued') return { kind: 'conflict' }
        if (row.status === 'queued') {
          const cancelledJob = await client.query(
            `UPDATE jobs SET status='cancelled',last_error_code='cancelled_by_user',updated_at=now()
             WHERE id=$1 AND status='pending' AND attempt_count=0 RETURNING id`,
            [row.active_job_id],
          )
          if (cancelledJob.rowCount === 0) return { kind: 'conflict' }
        }
        const cancelled = await client.query(
          `UPDATE case_file_operations SET status='cancelled',cancelled_by_user_id=$2,
           failure_reason_code=NULL,version=version+1,updated_at=now()
           WHERE id=$1 RETURNING ${OPERATION_FIELDS}`,
          [operationId, actor.actorUserId],
        )
        const operation = toDto(cancelled.rows[0] as FileOperationRow)
        const response = fileOperationResponseSchema.parse({ operation })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'file_operation.cancelled',
          entityType: 'case_file_operation',
          entityId: operationId,
          details: { caseId, jobId: row.active_job_id, statusBefore: row.status },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: FILE_OPERATION_CANCEL_SCOPE,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 200,
          responseBody: response,
          caseId,
        })
        return { kind: 'ok', operation }
      })
    },
  }
}

export type FileOperationStore = ReturnType<typeof createFileOperationStore>
