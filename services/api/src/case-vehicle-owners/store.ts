import type pg from 'pg'
import {
  caseVehicleOwnersResponseSchema,
  type CaseVehicleOwnerDto,
  type CaseVehicleOwnersResponse,
} from '@hasarbotu/contracts'
import { validateCaseVehicleOwners, type CaseVehicleOwnerInput } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'

/**
 * Dosya Envanteri — araç sahibi mini-yakalama store'u.
 *
 * Tam sürüm zinciri YOKTUR: liste tek seferde değiştirilir. Eski
 * `set_version` satırları asla silinmez/güncellenmez (append-only); yalnız
 * `case_vehicle_owner_sets.current_set_version` işaretçisi ilerler.
 */
export type CaseVehicleOwnersErrorCode =
  | 'CASE_NOT_FOUND'
  | 'CASE_CLOSED'
  | 'OWNERS_SET_VERSION_CONFLICT'
  | 'OWNERS_INVALID'

export class CaseVehicleOwnersError extends Error {
  constructor(
    readonly code: CaseVehicleOwnersErrorCode,
    readonly status: number,
    readonly detail: string | null = null,
  ) {
    super(code)
    this.name = 'CaseVehicleOwnersError'
  }
}

interface Actor {
  readonly organizationId: string
  readonly userId: string
}

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

async function loadCase(
  pool: pg.Pool,
  organizationId: string,
  caseId: string,
): Promise<{ closed: boolean }> {
  const result = await pool.query(
    'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id=$2',
    [organizationId, caseId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) throw new CaseVehicleOwnersError('CASE_NOT_FOUND', 404)
  return { closed: row.lifecycle_status === 'closed' }
}

export function createCaseVehicleOwnersStore(pool: pg.Pool) {
  async function read(
    organizationId: string,
    caseId: string,
    canEdit: boolean,
  ): Promise<CaseVehicleOwnersResponse> {
    const set = await pool.query(
      'SELECT current_set_version,updated_by_user_id::text,updated_at FROM case_vehicle_owner_sets WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    const setRow = set.rows[0] as Record<string, unknown> | undefined
    const currentSetVersion = setRow === undefined ? 0 : safeNumber(setRow.current_set_version)
    if (currentSetVersion === 0) {
      return caseVehicleOwnersResponseSchema.parse({
        caseId, setVersion: null, owners: [], updatedByUserId: null, updatedAt: null,
        permissions: { canEdit },
      })
    }
    const owners = await pool.query(
      'SELECT name,phone FROM case_vehicle_owners WHERE organization_id=$1 AND case_id=$2 AND set_version=$3 ORDER BY ordinal',
      [organizationId, caseId, currentSetVersion],
    )
    return caseVehicleOwnersResponseSchema.parse({
      caseId,
      setVersion: currentSetVersion,
      owners: (owners.rows as { name: string; phone: string | null }[]).map((row) => ({
        name: row.name,
        phone: row.phone,
      })),
      updatedByUserId: setRow?.updated_by_user_id ?? null,
      updatedAt: (setRow?.updated_at as Date | undefined)?.toISOString() ?? null,
      permissions: { canEdit },
    })
  }

  return {
    async read(actor: Actor, caseId: string, canEdit: boolean): Promise<CaseVehicleOwnersResponse> {
      await loadCase(pool, actor.organizationId, caseId)
      return read(actor.organizationId, caseId, canEdit)
    },

    /** Listeyi tek seferde değiştirir. İlk kayıtta `expectedSetVersion` null'dır. */
    async save(
      actor: Actor,
      caseId: string,
      input: {
        owners: readonly CaseVehicleOwnerDto[]
        expectedSetVersion: number | null
      },
    ): Promise<CaseVehicleOwnersResponse> {
      const caseRow = await loadCase(pool, actor.organizationId, caseId)
      if (caseRow.closed) throw new CaseVehicleOwnersError('CASE_CLOSED', 409)
      const ownerInputs: readonly CaseVehicleOwnerInput[] = input.owners.map((owner) => ({
        name: owner.name,
        phone: owner.phone,
      }))
      const validation = validateCaseVehicleOwners(ownerInputs)
      if (!validation.valid) throw new CaseVehicleOwnersError('OWNERS_INVALID', 400, validation.reasonCode)
      const owners = validation.owners

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          'SELECT current_set_version FROM case_vehicle_owner_sets WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const existingRow = existing.rows[0] as Record<string, unknown> | undefined
        const currentVersion = existingRow === undefined ? 0 : safeNumber(existingRow.current_set_version)
        if (input.expectedSetVersion !== (currentVersion === 0 ? null : currentVersion)) {
          throw new CaseVehicleOwnersError('OWNERS_SET_VERSION_CONFLICT', 409)
        }
        const nextVersion = currentVersion + 1

        for (const [ordinal, owner] of owners.entries()) {
          await client.query(
            `INSERT INTO case_vehicle_owners
               (id,organization_id,case_id,set_version,ordinal,name,phone,created_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [uuidv7(), actor.organizationId, caseId, nextVersion, ordinal, owner.name, owner.phone, actor.userId],
          )
        }
        if (existingRow === undefined) {
          await client.query(
            `INSERT INTO case_vehicle_owner_sets (organization_id,case_id,current_set_version,updated_by_user_id)
             VALUES ($1,$2,$3,$4)`,
            [actor.organizationId, caseId, nextVersion, actor.userId],
          )
        } else {
          await client.query(
            `UPDATE case_vehicle_owner_sets SET current_set_version=$3,updated_by_user_id=$4,updated_at=now()
             WHERE organization_id=$1 AND case_id=$2`,
            [actor.organizationId, caseId, nextVersion, actor.userId],
          )
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
      return read(actor.organizationId, caseId, true)
    },
  }
}

export type CaseVehicleOwnersStore = ReturnType<typeof createCaseVehicleOwnersStore>
