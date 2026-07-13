import type pg from 'pg'
import {
  caseLocationHistoryItemSchema,
  caseLocationSchema,
  storageRootSchema,
  type CaseLocation,
  type CaseLocationAssignRequest,
  type CaseLocationHistoryItem,
  type CaseLocationHistoryQuery,
  type StorageRoot,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'

/**
 * Depolama referansi / vaka konumu veri katmani (Paket 12).
 *
 * Yalniz MANTIKSAL rootKey + POSIX göreli yol saklanir/dönülür; mutlak yol
 * (P:\, sürücü harfi, UNC) ne DB'ye ne yanita ne de audit'e girer. Atama tek
 * transaction icinde: güncel konum + append-only geçmiş + merkezi audit
 * (Paket 11) atomik yazilir. Optimistic locking `version` ile; kiracı kapsami
 * her sorguda `organization_id = $1`.
 */
interface RootRow {
  root_key: string
  label: string
  is_active: boolean
}

interface LocationRow {
  case_id: string
  storage_root_key: string
  relative_path: string
  verification_status: string
  source: string
  version: number
  created_at: Date
  updated_at: Date
}

interface HistoryRow {
  id: string
  storage_root_key: string
  relative_path: string
  previous_relative_path: string | null
  verification_status: string
  source: string
  changed_by_user_id: string | null
  occurred_at: Date
}

const LOCATION_FIELDS =
  'case_id, storage_root_key, relative_path, verification_status, source, version, created_at, updated_at'

function rootToDto(row: RootRow): StorageRoot {
  return storageRootSchema.parse({ rootKey: row.root_key, label: row.label, isActive: row.is_active })
}

function locationToDto(row: LocationRow): CaseLocation {
  return caseLocationSchema.parse({
    caseId: row.case_id,
    storageRootKey: row.storage_root_key,
    relativePath: row.relative_path,
    verificationStatus: row.verification_status,
    source: row.source,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

function historyToDto(row: HistoryRow): CaseLocationHistoryItem {
  return caseLocationHistoryItemSchema.parse({
    id: row.id,
    storageRootKey: row.storage_root_key,
    relativePath: row.relative_path,
    previousRelativePath: row.previous_relative_path,
    verificationStatus: row.verification_status,
    source: row.source,
    changedByUserId: row.changed_by_user_id,
    occurredAt: row.occurred_at.toISOString(),
  })
}

export type AssignOutcome =
  | { readonly kind: 'ok'; readonly location: CaseLocation }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_reference' }
  | { readonly kind: 'version_conflict' }

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface HistoryResult {
  readonly items: readonly CaseLocationHistoryItem[]
  readonly totalItems: number
}

export function createStorageStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async listRoots(organizationId: string): Promise<StorageRoot[]> {
      const result = await pool.query(
        'SELECT root_key, label, is_active FROM storage_roots WHERE organization_id = $1 ORDER BY root_key',
        [organizationId],
      )
      return (result.rows as RootRow[]).map(rootToDto)
    },

    async findCurrentLocation(organizationId: string, caseId: string): Promise<CaseLocation | undefined> {
      const result = await pool.query(
        `SELECT ${LOCATION_FIELDS} FROM case_locations WHERE organization_id = $1 AND case_id::text = $2`,
        [organizationId, caseId],
      )
      const row = result.rows[0] as LocationRow | undefined
      return row === undefined ? undefined : locationToDto(row)
    },

    /**
     * Konum atama/değiştirme (PUT). İlk atama version 1; değiştirme
     * `expectedVersion` ile optimistic locking (uyuşmazlık 409). Güncel konum,
     * append-only geçmiş ve merkezi audit AYNI transaction'da atomik yazilir.
     */
    async assignLocation(
      actor: ActorContext,
      caseId: string,
      input: CaseLocationAssignRequest,
    ): Promise<AssignOutcome> {
      return withTransaction(pool, async (client) => {
        const caseRes = await client.query(
          'SELECT 1 FROM cases WHERE id::text = $1 AND organization_id = $2',
          [caseId, actor.organizationId],
        )
        if (caseRes.rowCount === 0) return { kind: 'not_found' }

        const rootRes = await client.query(
          'SELECT 1 FROM storage_roots WHERE organization_id = $1 AND root_key = $2 AND is_active = true',
          [actor.organizationId, input.storageRootKey],
        )
        if (rootRes.rowCount === 0) return { kind: 'unknown_reference' }

        const current = await client.query(
          'SELECT relative_path, version FROM case_locations WHERE organization_id = $1 AND case_id::text = $2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const existing = current.rows[0] as { relative_path: string; version: number } | undefined

        let row: LocationRow
        let previousPath: string | null
        let action: string
        let fromVersion: number | null

        if (existing === undefined) {
          if (input.expectedVersion !== undefined) return { kind: 'version_conflict' }
          const inserted = await client.query(
            `INSERT INTO case_locations
               (id, organization_id, case_id, storage_root_key, relative_path, verification_status, source)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6)
             RETURNING ${LOCATION_FIELDS}`,
            [uuidv7(), actor.organizationId, caseId, input.storageRootKey, input.relativePath, input.source],
          )
          row = inserted.rows[0] as LocationRow
          previousPath = null
          action = 'case.location_assigned'
          fromVersion = null
        } else {
          if (input.expectedVersion !== existing.version) return { kind: 'version_conflict' }
          const updated = await client.query(
            `UPDATE case_locations
             SET storage_root_key = $1, relative_path = $2, source = $3,
                 verification_status = 'pending', version = version + 1, updated_at = now()
             WHERE organization_id = $4 AND case_id::text = $5
             RETURNING ${LOCATION_FIELDS}`,
            [input.storageRootKey, input.relativePath, input.source, actor.organizationId, caseId],
          )
          row = updated.rows[0] as LocationRow
          previousPath = existing.relative_path
          action = 'case.location_updated'
          fromVersion = existing.version
        }

        await client.query(
          `INSERT INTO case_location_history
             (id, organization_id, case_id, storage_root_key, relative_path, previous_relative_path,
              verification_status, source, changed_by_user_id, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            actor.organizationId,
            caseId,
            row.storage_root_key,
            row.relative_path,
            previousPath,
            row.verification_status,
            row.source,
            actor.actorUserId,
            actor.requestId,
          ],
        )

        // Audit details yalniz güvenli göreli yol + rootKey taşır; mutlak yol YOK.
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action,
          entityType: 'case',
          entityId: caseId,
          details: {
            storageRootKey: row.storage_root_key,
            relativePath: row.relative_path,
            source: row.source,
            verificationStatus: row.verification_status,
            ...(fromVersion !== null ? { fromVersion } : {}),
            toVersion: row.version,
          },
        })

        return { kind: 'ok', location: locationToDto(row) }
      })
    },

    async listHistory(
      organizationId: string,
      caseId: string,
      query: CaseLocationHistoryQuery,
    ): Promise<HistoryResult> {
      const countRes = await pool.query(
        'SELECT count(*)::int AS total FROM case_location_history WHERE organization_id = $1 AND case_id::text = $2',
        [organizationId, caseId],
      )
      const totalItems = (countRes.rows[0] as { total: number }).total

      const offset = (query.page - 1) * query.pageSize
      const result = await pool.query(
        `SELECT id, storage_root_key, relative_path, previous_relative_path, verification_status,
                source, changed_by_user_id, occurred_at
         FROM case_location_history WHERE organization_id = $1 AND case_id::text = $2
         ORDER BY occurred_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [organizationId, caseId, query.pageSize, offset],
      )
      return { items: (result.rows as HistoryRow[]).map(historyToDto), totalItems }
    },
  }
}

export type StorageStore = ReturnType<typeof createStorageStore>
