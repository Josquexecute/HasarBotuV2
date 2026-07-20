import type pg from 'pg'
import {
  laborExcelProfileCandidatesResponseSchema,
  laborExcelProfileResponseSchema,
  laborExcelProfilesResponseSchema,
  laborExcelProjectionResponseSchema,
  type LaborExcelProfileCandidatesResponse,
  type LaborExcelProfileFields,
  type LaborExcelProfileResponse,
  type LaborExcelProfilesResponse,
  type LaborExcelProjectionResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_ALLOCATION_CATEGORIES,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  isProfileWritable,
  type LaborCategoryAmount,
  projectLaborAllocationToExcel,
  selectLaborExcelProfileCandidates,
  validateLaborExcelProfileInput,
  type LaborExcelColumn,
  type LaborExcelIdentityChecks,
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
  | 'CASE_NOT_FOUND'
  /** P63: pasif profil YENİ projeksiyonda seçilemez. */
  | 'PROFILE_INACTIVE'
  /** P63: profil dosyanın sigorta şirketine ait değil. */
  | 'PROFILE_INSURER_MISMATCH'

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
  v.schema_version,v.insurer_id::text AS insurer_id,v.target_sheet,v.identity_checks,
  v.columns,v.mapping,v.revision_reason,v.created_at`

function versionDto(row: Record<string, unknown>) {
  return {
    id: String(row.version_id),
    profileVersion: safeNumber(row.profile_version),
    name: String(row.name),
    insurerId: row.insurer_id === null ? null : String(row.insurer_id),
    targetSheet: row.target_sheet === null ? null : String(row.target_sheet),
    identityChecks: row.identity_checks as LaborExcelIdentityChecks,
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
    `SELECT p.id::text,p.version,p.status,p.deactivated_at,p.status_reason,
            p.created_at,p.updated_at,u.display_name
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
  // P64: şema sürümü SATIRDAN gelir; eski profiller okunabilir kalır ve
  // yazılabilirlik tek noktadan türetilir.
  const currentSchemaVersion = String(
    (versions.rows[0] as Record<string, unknown>).schema_version,
  )
  return laborExcelProfileResponseSchema.parse({
    profile: {
      id: String(profile.id),
      schemaVersion: currentSchemaVersion,
      writable: isProfileWritable(currentSchemaVersion),
      version: safeNumber(profile.version),
      status: String(profile.status),
      deactivatedAt: profile.deactivated_at === null
        ? null
        : (profile.deactivated_at as Date).toISOString(),
      statusReason: profile.status_reason === null ? null : String(profile.status_reason),
      current,
      history,
      createdByDisplayName: String(profile.display_name),
      createdAt: (profile.created_at as Date).toISOString(),
      updatedAt: (profile.updated_at as Date).toISOString(),
    },
  })
}

/**
 * jsonb kategori dağılımını okur. Eksik/bozuk kayıt `null` döner ve
 * ASLA sıfır dağılıma çevrilmez: provenance yokluğu bir dağılım değildir.
 */
function readCategoryAmounts(value: unknown): readonly LaborCategoryAmount[] | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const amounts: LaborCategoryAmount[] = []
  for (const category of LABOR_ALLOCATION_CATEGORIES) {
    const amount = record[category]
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null
    amounts.push({ category, amountMinor: amount })
  }
  return amounts
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
        targetSheet: input.fields.targetSheet,
        identityChecks: input.fields.identityChecks,
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
              name,insurer_id,target_sheet,identity_checks,columns,mapping,
              revision_reason,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,
          [
            versionId, actor.organizationId, targetProfileId, nextVersion, previousVersionId,
            LABOR_EXCEL_PROFILE_SCHEMA_VERSION, validation.name, input.fields.insurerId,
            validation.targetSheet, JSON.stringify(validation.identityChecks),
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
     * Paket 63 — profili pasifleştirir veya yeniden etkinleştirir.
     *
     * Profil SİLİNMEZ: pasif profil yeni projeksiyonda seçilemez ama eski
     * kayıtlarda okunabilir kalır. Gerekçe pasifleştirmede zorunludur.
     */
    async setStatus(
      actor: Actor,
      profileId: string,
      input: { status: 'active' | 'inactive'; expectedVersion: number; reason: string | null },
    ): Promise<LaborExcelProfileResponse> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          `SELECT version,status FROM labor_excel_profiles
            WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
          [actor.organizationId, profileId],
        )
        const row = existing.rows[0] as Record<string, unknown> | undefined
        if (row === undefined) throw new LaborExcelProfileError('PROFILE_NOT_FOUND', 404)
        if (safeNumber(row.version) !== input.expectedVersion) {
          throw new LaborExcelProfileError('PROFILE_VERSION_CONFLICT', 409)
        }
        const reason = input.reason === null ? null : input.reason.trim()
        if (input.status === 'inactive' && (reason === null || reason.length === 0)) {
          throw new LaborExcelProfileError('PROFILE_REASON_REQUIRED', 400)
        }
        // Durum değişikliği profil SÜRÜMÜ üretmez: içerik değişmiyor, yalnız
        // kullanılabilirlik değişiyor. Aggregate sürümü yine de artar ki
        // eşzamanlı düzenleme çakışması yakalansın.
        await client.query(
          `UPDATE labor_excel_profiles
              SET status=$2,
                  deactivated_at=CASE WHEN $2='inactive' THEN now() ELSE NULL END,
                  deactivated_by_user_id=CASE WHEN $2='inactive' THEN $3::uuid ELSE NULL END,
                  status_reason=CASE WHEN $2='inactive' THEN $4 ELSE NULL END,
                  version=version+1,updated_at=now()
            WHERE id=$1`,
          [profileId, input.status, actor.userId, reason],
        )
        await client.query('COMMIT')
        return readProfile(pool, actor.organizationId, profileId)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    /**
     * Paket 63 — dosya için seçilebilir profiller ve öneri.
     *
     * Gerçek Excel dosyası OKUNMAZ; bu yalnız PROFİL ÖNERİSİDİR ve yanıt
     * `templateVerified: false` literalini taşır. Organizasyon sınırı sorguda,
     * sigorta şirketi ve aktiflik kuralı domain fonksiyonunda uygulanır.
     */
    async listCandidates(
      actor: Actor,
      caseId: string,
    ): Promise<LaborExcelProfileCandidatesResponse> {
      const caseRow = await pool.query(
        `SELECT c.insurer_id::text AS insurer_id,i.name AS insurer_name
           FROM cases c
           LEFT JOIN insurers i ON i.id=c.insurer_id AND i.organization_id=c.organization_id
          WHERE c.organization_id=$1 AND c.id=$2`,
        [actor.organizationId, caseId],
      )
      const found = caseRow.rows[0] as Record<string, unknown> | undefined
      if (found === undefined) throw new LaborExcelProfileError('CASE_NOT_FOUND', 404)
      const insurerId = found.insurer_id === null ? null : String(found.insurer_id)

      const rows = await pool.query(
        `SELECT p.id::text AS profile_id,p.version,p.status,
                ${VERSION_COLUMNS},i.name AS insurer_name
           FROM labor_excel_profiles p
           JOIN labor_excel_profile_versions v ON v.id=p.current_version_id
           LEFT JOIN insurers i ON i.id=v.insurer_id AND i.organization_id=p.organization_id
          WHERE p.organization_id=$1
          ORDER BY v.name LIMIT 200`,
        [actor.organizationId],
      )
      const byId = new Map<string, Record<string, unknown>>()
      const inputs = (rows.rows as Record<string, unknown>[]).map((row) => {
        byId.set(String(row.profile_id), row)
        return {
          profileId: String(row.profile_id),
          insurerId: row.insurer_id === null ? null : String(row.insurer_id),
          status: String(row.status) as 'active' | 'inactive',
        }
      })

      const selection = selectLaborExcelProfileCandidates(insurerId, inputs)
      const candidates = selection.candidates.map((candidate) => {
        const row = byId.get(candidate.profileId) as Record<string, unknown>
        const version = versionDto(row)
        const mapping = version.mapping as Record<string, string | null>
        return {
          profileId: candidate.profileId,
          profileVersion: safeNumber(row.version),
          name: version.name,
          scope: candidate.scope,
          insurerId: version.insurerId,
          insurerName: row.insurer_name === null ? null : String(row.insurer_name),
          targetSheet: version.targetSheet,
          identityChecks: version.identityChecks,
          columns: version.columns,
          mapping: version.mapping,
          // Hiçbir sütuna eşlenmemiş türler: tutarları sütuna YAZILAMAZ.
          unmappedCategories: LABOR_ALLOCATION_CATEGORIES.filter(
            (category) => mapping[category] === null,
          ),
          writable: isProfileWritable(String(row.schema_version)),
        }
      })

      return laborExcelProfileCandidatesResponseSchema.parse({
        caseId,
        insurerId,
        insurerName: found.insurer_name === null ? null : String(found.insurer_name),
        candidates,
        suggestedProfileId: selection.suggestedProfileId,
        reason: selection.reason,
        templateVerified: false,
      })
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

      // P63 — seçilebilirlik SUNUCUDA zorlanır; istemcinin gönderdiği
      // profileId'ye güvenilmez.
      if (profileResponse.profile.status !== 'active') {
        throw new LaborExcelProfileError('PROFILE_INACTIVE', 409)
      }
      const caseRow = await pool.query(
        'SELECT insurer_id::text AS insurer_id FROM cases WHERE organization_id=$1 AND id=$2',
        [actor.organizationId, caseId],
      )
      const foundCase = caseRow.rows[0] as Record<string, unknown> | undefined
      if (foundCase === undefined) throw new LaborExcelProfileError('CASE_NOT_FOUND', 404)
      const caseInsurerId = foundCase.insurer_id === null ? null : String(foundCase.insurer_id)
      // Genel profil (insurerId=null) her dosyada kullanılabilir; şirkete bağlı
      // profil YALNIZ o şirketin dosyasında kullanılabilir.
      if (current.insurerId !== null && current.insurerId !== caseInsurerId) {
        throw new LaborExcelProfileError('PROFILE_INSURER_MISMATCH', 409)
      }

      /*
       * P64 — projeksiyon kaynağı YALNIZ tamamlanmış uygulamadır.
       *
       * `status='completed'` filtresi çalışan/başarısız/iptal edilmiş
       * uygulamaları ve apply-preview'i dışarıda bırakır: onlar kullanıcının
       * onayladığı bir sonuç DEĞİLDİR ve Excel'e aday olamazlar.
       */
      const application = await pool.query(
        `SELECT a.id::text,a.target_sheet_version,s.sheet_version AS current_sheet_version
           FROM labor_allocation_applications a
           LEFT JOIN labor_sheets sh
             ON sh.organization_id=a.organization_id AND sh.case_id=a.case_id
           LEFT JOIN labor_sheet_versions s
             ON s.organization_id=sh.organization_id AND s.id=sh.current_version_id
          WHERE a.organization_id=$1 AND a.case_id=$2 AND a.id=$3 AND a.status='completed'`,
        [actor.organizationId, caseId, applicationId],
      )
      const applicationRow = application.rows[0] as Record<string, unknown> | undefined
      if (applicationRow === undefined) {
        throw new LaborExcelProfileError('APPLICATION_NOT_FOUND', 404)
      }

      /*
       * Bayatlık: föy bu uygulamadan sonra tekrar sürümlendiyse projeksiyon
       * artık yürürlükteki föyü anlatmıyordur. Bayat önizleme fiziksel yazıma
       * uygun SAYILMAZ; sessizce güncel gibi sunmak yanlış veriyi Excel'e
       * taşırdı.
       */
      const targetSheetVersion = safeNumber(applicationRow.target_sheet_version)
      const currentSheetVersion = applicationRow.current_sheet_version === null
        ? targetSheetVersion
        : safeNumber(applicationRow.current_sheet_version)
      const stale = currentSheetVersion !== targetSheetVersion

      // Uygulanan kategori dağılımı provenance'tan gelir; öneri satırından
      // veya operasyon türlerinden TÜRETİLMEZ.
      const lines = await pool.query(
        `SELECT l.line_ordinal,l.applied_description,
                l.applied_part_amount_minor::text AS applied_part,
                l.applied_labor_amount_minor::text AS applied_labor,
                l.modified,l.control_required,l.applied_category_amounts
           FROM labor_allocation_applied_lines l
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
          // null = provenance yok. Sıfır dağılım gibi okunmaz.
          categoryAmounts: readCategoryAmounts(row.applied_category_amounts),
        })),
      )

      return laborExcelProjectionResponseSchema.parse({
        caseId,
        applicationId,
        applicationTargetSheetVersion: targetSheetVersion,
        currentSheetVersion,
        stale,
        /*
         * Eski profil sürümleri OKUNABİLİR kalır ama yazılabilir değildir:
         * 1.0.0 sütunları operasyon türü eksenindeydi ve kategori tutarlarını
         * doğru sütuna koyduğu garanti edilemez.
         */
        writable: isProfileWritable(profileResponse.profile.schemaVersion) && !stale,
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
