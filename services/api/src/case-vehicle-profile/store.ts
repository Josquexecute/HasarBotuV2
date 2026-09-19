import type pg from 'pg'
import {
  caseVehicleProfileResponseSchema,
  type CaseVehicleProfileFields,
  type CaseVehicleProfileResponse,
} from '@hasarbotu/contracts'
import {
  CASE_VEHICLE_PROFILE_SCHEMA_VERSION,
  validateCaseVehicleProfile,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'

/**
 * Paket 56 — dosya düzeyinde araç profili store'u.
 *
 * Sürümler immutable'dır ve yalnız açık kullanıcı onayıyla (`confirmed`)
 * yazılır. Kapalı dosyada yazma yapılamaz. Otomatik belge çıkarımı YOKTUR.
 */
export type CaseVehicleProfileErrorCode =
  | 'CASE_NOT_FOUND'
  | 'CASE_CLOSED'
  | 'PROFILE_VERSION_CONFLICT'
  | 'PROFILE_FIELDS_INVALID'
  | 'PROFILE_REASON_REQUIRED'

export class CaseVehicleProfileError extends Error {
  constructor(
    readonly code: CaseVehicleProfileErrorCode,
    readonly status: number,
    readonly detail: string | null = null,
  ) {
    super(code)
    this.name = 'CaseVehicleProfileError'
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

const VERSION_COLUMNS = `id::text,profile_version,previous_version_id::text,schema_version,
  brand,model,model_year,variant,vehicle_class,chassis_prefix,engine_code,
  evidence_source,evidence_reference,revision_reason,created_by_user_id::text,created_at`

function mapVersion(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    profileVersion: safeNumber(row.profile_version),
    previousVersionId: row.previous_version_id === null ? null : String(row.previous_version_id),
    schemaVersion: CASE_VEHICLE_PROFILE_SCHEMA_VERSION,
    brand: String(row.brand),
    model: String(row.model),
    modelYear: safeNumber(row.model_year),
    variant: row.variant === null ? null : String(row.variant),
    vehicleClass: String(row.vehicle_class),
    chassisPrefix: row.chassis_prefix === null ? null : String(row.chassis_prefix),
    engineCode: row.engine_code === null ? null : String(row.engine_code),
    evidenceSource: String(row.evidence_source),
    evidenceReference: row.evidence_reference === null ? null : String(row.evidence_reference),
    revisionReason: row.revision_reason === null ? null : String(row.revision_reason),
    createdByUserId: String(row.created_by_user_id),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

async function loadCase(
  pool: pg.Pool | pg.PoolClient,
  organizationId: string,
  caseId: string,
): Promise<{ closed: boolean }> {
  const result = await pool.query(
    'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id=$2',
    [organizationId, caseId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) throw new CaseVehicleProfileError('CASE_NOT_FOUND', 404)
  return { closed: row.lifecycle_status === 'closed' }
}

export function createCaseVehicleProfileStore(pool: pg.Pool) {
  async function read(
    organizationId: string,
    caseId: string,
    canEdit: boolean,
    executor: pg.Pool | pg.PoolClient = pool,
  ): Promise<CaseVehicleProfileResponse> {
    const profile = await executor.query(
      'SELECT id::text,current_version_id::text,version FROM case_vehicle_profiles WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    const profileRow = profile.rows[0] as Record<string, unknown> | undefined
    if (profileRow === undefined) {
      return caseVehicleProfileResponseSchema.parse({
        caseId, profileId: null, version: null, current: null, history: [],
        permissions: { canEdit },
      })
    }
    const versions = await executor.query(
      `SELECT ${VERSION_COLUMNS} FROM case_vehicle_profile_versions
        WHERE organization_id=$1 AND profile_id=$2
        ORDER BY profile_version DESC LIMIT 200`,
      [organizationId, String(profileRow.id)],
    )
    const history = (versions.rows as Record<string, unknown>[]).map(mapVersion)
    const current = history.find((version) => version.id === String(profileRow.current_version_id)) ?? null
    return caseVehicleProfileResponseSchema.parse({
      caseId,
      profileId: String(profileRow.id),
      version: safeNumber(profileRow.version),
      current,
      history,
      permissions: { canEdit },
    })
  }

  return {
    async read(actor: Actor, caseId: string, canEdit: boolean): Promise<CaseVehicleProfileResponse> {
      await loadCase(pool, actor.organizationId, caseId)
      return read(actor.organizationId, caseId, canEdit)
    },

    /** Yeni sürüm yazar. İlk sürümde `expectedVersion` null, sonrasında zorunludur. */
    async save(
      actor: Actor,
      caseId: string,
      input: {
        fields: CaseVehicleProfileFields
        expectedVersion: number | null
        reason: string | null
      },
      transaction?: pg.PoolClient,
    ): Promise<CaseVehicleProfileResponse> {
      const caseRow = await loadCase(transaction ?? pool, actor.organizationId, caseId)
      if (caseRow.closed) throw new CaseVehicleProfileError('CASE_CLOSED', 409)
      const validation = validateCaseVehicleProfile({
        brand: input.fields.brand,
        model: input.fields.model,
        modelYear: input.fields.modelYear,
        variant: input.fields.variant,
        vehicleClass: input.fields.vehicleClass,
        chassisPrefix: input.fields.chassisPrefix,
        engineCode: input.fields.engineCode,
        evidenceSource: input.fields.evidenceSource,
        evidenceReference: input.fields.evidenceReference,
      })
      if (!validation.valid) {
        throw new CaseVehicleProfileError('PROFILE_FIELDS_INVALID', 400, validation.reasonCode)
      }
      const profile = validation.profile

      const client = transaction ?? await pool.connect()
      try {
        if (transaction === undefined) await client.query('BEGIN')
        const existing = await client.query(
          `SELECT id::text,current_version_id::text,version FROM case_vehicle_profiles
            WHERE organization_id=$1 AND case_id=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const existingRow = existing.rows[0] as Record<string, unknown> | undefined

        let profileId: string
        let nextVersion: number
        let previousVersionId: string | null = null
        if (existingRow === undefined) {
          if (input.expectedVersion !== null) {
            throw new CaseVehicleProfileError('PROFILE_VERSION_CONFLICT', 409)
          }
          profileId = uuidv7()
          nextVersion = 1
          await client.query(
            'INSERT INTO case_vehicle_profiles (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
            [profileId, actor.organizationId, caseId, actor.userId],
          )
        } else {
          profileId = String(existingRow.id)
          const currentVersion = safeNumber(existingRow.version)
          if (input.expectedVersion !== currentVersion) {
            throw new CaseVehicleProfileError('PROFILE_VERSION_CONFLICT', 409)
          }
          if (input.reason === null) {
            throw new CaseVehicleProfileError('PROFILE_REASON_REQUIRED', 400)
          }
          nextVersion = currentVersion + 1
          previousVersionId = String(existingRow.current_version_id)
        }

        const versionId = uuidv7()
        await client.query(
          `INSERT INTO case_vehicle_profile_versions
             (id,organization_id,case_id,profile_id,profile_version,previous_version_id,schema_version,
              brand,model,model_year,variant,vehicle_class,chassis_prefix,engine_code,
              evidence_source,evidence_reference,revision_reason,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            versionId, actor.organizationId, caseId, profileId, nextVersion, previousVersionId,
            CASE_VEHICLE_PROFILE_SCHEMA_VERSION, profile.brand, profile.model, profile.modelYear,
            profile.variant, profile.vehicleClass, profile.chassisPrefix, profile.engineCode,
            profile.evidenceSource, profile.evidenceReference,
            nextVersion === 1 ? null : input.reason, actor.userId,
          ],
        )
        await client.query(
          'UPDATE case_vehicle_profiles SET current_version_id=$2,version=$3,updated_at=now() WHERE id=$1',
          [profileId, versionId, nextVersion],
        )
        if (transaction === undefined) await client.query('COMMIT')
      } catch (error) {
        if (transaction === undefined) await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        if (transaction === undefined) client.release()
      }
      return read(actor.organizationId, caseId, true, transaction ?? pool)
    },
  }
}

export type CaseVehicleProfileStore = ReturnType<typeof createCaseVehicleProfileStore>
