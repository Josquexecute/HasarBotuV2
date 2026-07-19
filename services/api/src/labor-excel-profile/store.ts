import type pg from 'pg'
import {
  laborExcelProfileResponseSchema,
  laborExcelProfilesResponseSchema,
  laborExcelProjectionResponseSchema,
  type LaborExcelProfileFields,
  type LaborExcelProfileResponse,
  type LaborExcelProfilesResponse,
  type LaborExcelProjectionResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  projectLaborAllocationToExcel,
  validateLaborExcelProfileInput,
  type LaborAllocationAmount,
  type LaborExcelColumn,
  type LaborExcelMapping,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'

/**
 * Paket 60 — Excel şablon profili store'u.
 *
 * Profiller organizasyon düzeyinde, sürümlü ve immutable'dır. Projeksiyon
 * SALT OKUNURDUR: hiçbir dosyaya yazmaz, yalnız uygulanmış dağıtımın seçilen
 * profilin sütunlarına nasıl düşeceğini gösterir.
 */
export type LaborExcelProfileErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_VERSION_CONFLICT'
  | 'PROFILE_FIELDS_INVALID'
  | 'PROFILE_REASON_REQUIRED'
  | 'INSURER_NOT_FOUND'
  | 'APPLICATION_NOT_FOUND'

export class LaborExcelProfileError extends Error {
  constructor(
    readonly code: LaborExcelProfileErrorCode,
    readonly status: number,
    readonly detail: string | null = null,
  ) {
    super(code)
    this.name = 'LaborExcelProfileError'
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

const VERSION_COLUMNS = `v.id::text AS version_id,v.profile_version,v.name,
  v.insurer_id::text AS insurer_id,v.columns,v.mapping,v.revision_reason,v.created_at`

function versionDto(row: Record<string, unknown>) {
  return {
    id: String(row.version_id),
    profileVersion: safeNumber(row.profile_version),
    name: String(row.name),
    insurerId: row.insurer_id === null ? null : String(row.insurer_id),
    columns: row.columns as LaborExcelColumn[],
    mapping: row.mapping as LaborExcelMapping,
    revisionReason: row.revision_reason === null ? null : String(row.revision_reason),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

async function readProfile(
  pool: pg.Pool,
  organizationId: string,
  profileId: string,
): Promise<LaborExcelProfileResponse> {
  const header = await pool.query(
    `SELECT p.id::text,p.version,p.created_at,p.updated_at,u.display_name
       FROM labor_excel_profiles p
       JOIN users u ON u.id=p.created_by_user_id
      WHERE p.organization_id=$1 AND p.id=$2`,
    [organizationId, profileId],
  )
  const profile = header.rows[0] as Record<string, unknown> | undefined
  if (profile === undefined) throw new LaborExcelProfileError('PROFILE_NOT_FOUND', 404)
  const versions = await pool.query(
    `SELECT ${VERSION_COLUMNS} FROM labor_excel_profile_versions v
      WHERE v.organization_id=$1 AND v.profile_id=$2
      ORDER BY v.profile_version DESC`,
    [organizationId, profileId],
  )
  const history = (versions.rows as Record<string, unknown>[]).map(versionDto)
  const current = history[0]
  if (current === undefined) throw new LaborExcelProfileError('PROFILE_NOT_FOUND', 404)
  return laborExcelProfileResponseSchema.parse({
    profile: {
      id: String(profile.id),
      schemaVersion: LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
      version: safeNumber(profile.version),
      current,
      history,
      createdByDisplayName: String(profile.display_name),
      createdAt: (profile.created_at as Date).toISOString(),
      updatedAt: (profile.updated_at as Date).toISOString(),
    },
  })
}

export function createLaborExcelProfileStore(pool: pg.Pool) {
  return {
    async list(actor: Actor, canWrite: boolean): Promise<LaborExcelProfilesResponse> {
      const rows = await pool.query(
        `SELECT p.id::text FROM labor_excel_profiles p
          WHERE p.organization_id=$1 ORDER BY p.created_at DESC LIMIT 200`,
        [actor.organizationId],
      )
      const profiles = []
      for (const row of rows.rows as Record<string, unknown>[]) {
        const detail = await readProfile(pool, actor.organizationId, String(row.id))
        profiles.push(detail.profile)
      }
      return laborExcelProfilesResponseSchema.parse({ profiles, permissions: { canWrite } })
    },

    /**
     * Profil oluşturur veya yeni sürüm yazar. Sürüm zinciri immutable'dır;
     * ilk kayıt gerekçe istemez, sonraki her sürüm ister.
     */
    async save(
      actor: Actor,
      profileId: string | null,
      input: {
        fields: LaborExcelProfileFields
        expectedVersion: number | null
        reason: string | null
      },
    ): Promise<LaborExcelProfileResponse> {
      const validation = validateLaborExcelProfileInput({
        name: input.fields.name,
        columns: input.fields.columns,
        mapping: input.fields.mapping,
      })
      if (!validation.valid) {
        throw new LaborExcelProfileError('PROFILE_FIELDS_INVALID', 400, validation.reason)
      }
      // Sigorta şirketi AYNI organizasyondan olmalı; istemciden gelen kimliğe
      // güvenilmez.
      if (input.fields.insurerId !== null) {
        const insurer = await pool.query(
          'SELECT 1 FROM insurers WHERE organization_id=$1 AND id=$2',
          [actor.organizationId, input.fields.insurerId],
        )
        if (insurer.rowCount === 0) throw new LaborExcelProfileError('INSURER_NOT_FOUND', 404)
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        let targetProfileId = profileId
        let previousVersionId: string | null = null
        let nextVersion = 1

        if (targetProfileId === null) {
          if (input.expectedVersion !== null) {
            throw new LaborExcelProfileError('PROFILE_VERSION_CONFLICT', 409)
          }
          targetProfileId = uuidv7()
          await client.query(
            `INSERT INTO labor_excel_profiles (id,organization_id,created_by_user_id)
             VALUES ($1,$2,$3)`,
            [targetProfileId, actor.organizationId, actor.userId],
          )
        } else {
          const existing = await client.query(
            `SELECT version,current_version_id::text FROM labor_excel_profiles
              WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
            [actor.organizationId, targetProfileId],
          )
          const row = existing.rows[0] as Record<string, unknown> | undefined
          if (row === undefined) throw new LaborExcelProfileError('PROFILE_NOT_FOUND', 404)
          if (safeNumber(row.version) !== input.expectedVersion) {
            throw new LaborExcelProfileError('PROFILE_VERSION_CONFLICT', 409)
          }
          if (input.reason === null || input.reason.trim().length === 0) {
            throw new LaborExcelProfileError('PROFILE_REASON_REQUIRED', 400)
          }
          previousVersionId = String(row.current_version_id)
          nextVersion = safeNumber(row.version) + 1
        }

        const versionId = uuidv7()
        await client.query(
          `INSERT INTO labor_excel_profile_versions
             (id,organization_id,profile_id,profile_version,previous_version_id,schema_version,
              name,insurer_id,columns,mapping,revision_reason,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
          [
            versionId, actor.organizationId, targetProfileId, nextVersion, previousVersionId,
            LABOR_EXCEL_PROFILE_SCHEMA_VERSION, validation.name, input.fields.insurerId,
            JSON.stringify(validation.columns), JSON.stringify(validation.mapping),
            nextVersion === 1 ? null : (input.reason as string).trim(), actor.userId,
          ],
        )
        await client.query(
          `UPDATE labor_excel_profiles SET current_version_id=$1,version=$2,updated_at=now()
            WHERE id=$3`,
          [versionId, nextVersion, targetProfileId],
        )
        await client.query('COMMIT')
        return readProfile(pool, actor.organizationId, targetProfileId)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    /**
     * Uygulanmış dağıtımı profil sütunlarına projekte eder. Hiçbir dosyaya
     * yazmaz; yanıt `written: false` literalini taşır.
     *
     * Kaynak yalnız TAMAMLANMIŞ uygulama provenance'ıdır (Paket 58): ham AI
     * önerisi veya önizleme projekte edilmez.
     */
    async project(
      actor: Actor,
      caseId: string,
      applicationId: string,
      profileId: string,
    ): Promise<LaborExcelProjectionResponse> {
      const profileResponse = await readProfile(pool, actor.organizationId, profileId)
      const current = profileResponse.profile.current

      const application = await pool.query(
        `SELECT id::text FROM labor_allocation_applications
          WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND status='completed'`,
        [actor.organizationId, caseId, applicationId],
      )
      if (application.rowCount === 0) {
        throw new LaborExcelProfileError('APPLICATION_NOT_FOUND', 404)
      }

      // Tür bazlı dağılım öneri satırından okunur; uygulanan tutar ve
      // `modified` bayrağı provenance'tan gelir.
      const lines = await pool.query(
        `SELECT l.line_ordinal,l.applied_description,
                l.applied_part_amount_minor::text AS applied_part,
                l.applied_labor_amount_minor::text AS applied_labor,
                l.modified,l.control_required,s.allocations
           FROM labor_allocation_applied_lines l
           JOIN labor_allocation_applications a
             ON a.id=l.application_id AND a.organization_id=l.organization_id
           LEFT JOIN labor_allocation_line_suggestions s
             ON s.organization_id=a.organization_id AND s.run_id=a.run_id
            AND s.line_ordinal=l.suggestion_line_ordinal
          WHERE l.organization_id=$1 AND l.application_id=$2
          ORDER BY l.line_ordinal`,
        [actor.organizationId, applicationId],
      )

      const projection = projectLaborAllocationToExcel(
        { columns: current.columns as LaborExcelColumn[], mapping: current.mapping as LaborExcelMapping },
        (lines.rows as Record<string, unknown>[]).map((row) => ({
          lineOrdinal: safeNumber(row.line_ordinal),
          description: String(row.applied_description),
          appliedPartAmountMinor: safeNumber(row.applied_part),
          appliedLaborAmountMinor: safeNumber(row.applied_labor),
          modified: Boolean(row.modified),
          controlRequired: Boolean(row.control_required),
          allocations: (row.allocations ?? []) as LaborAllocationAmount[],
        })),
      )

      return laborExcelProjectionResponseSchema.parse({
        caseId,
        applicationId,
        profileId,
        profileVersion: profileResponse.profile.version,
        schemaVersion: LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
        columns: current.columns,
        lines: projection.lines,
        columnTotals: projection.columnTotals,
        projectedLineCount: projection.projectedLineCount,
        manualEntryLineCount: projection.manualEntryLineCount,
        reviewRequiredLineCount: projection.reviewRequiredLineCount,
        unmappedTotalMinor: projection.unmappedTotalMinor,
        written: false,
      })
    },
  }
}

export type LaborExcelProfileStore = ReturnType<typeof createLaborExcelProfileStore>
