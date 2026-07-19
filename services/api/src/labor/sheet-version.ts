import type pg from 'pg'
import { LABOR_SHEET_CURRENCY, type NormalizedLaborItem } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'

/**
 * Föy sürümü oluşturmanın TEK uygulaması.
 *
 * Hem kullanıcı revizyonu (`labor` store) hem AI dağıtımının uygulanması
 * (Paket 58) bu yardımcıyı kullanır. İkinci bir kopya bırakılsaydı sürüm
 * zinciri, kanıt alanları veya kaynak türü kuralları zamanla ayrışabilirdi.
 *
 * Fonksiyon KENDİ transaction'ını açmaz; çağıran, sürümü aynı transaction
 * içinde başka kayıtlarla birlikte kesinleştirebilsin diye client alır.
 */
export type LaborSheetVersionSourceType =
  | 'user_entered'
  | 'manual_revision'
  | 'ai_assisted'
  | 'ai_allocation_applied'

export interface CreateLaborSheetVersionInput {
  readonly organizationId: string
  readonly actorUserId: string
  readonly caseId: string
  readonly sheetId: string
  readonly sheetVersion: number
  readonly previousVersionId: string | null
  readonly sourceType: LaborSheetVersionSourceType
  /** Yalnız Paket 44 `labor_ai_suggestion_runs` kaydına bağlanır. */
  readonly laborAiSuggestionRunId: string | null
  readonly revisionReason: string | null
  readonly items: readonly NormalizedLaborItem[]
}

export async function createLaborSheetVersion(
  client: pg.PoolClient,
  input: CreateLaborSheetVersionInput,
): Promise<string> {
  const versionId = uuidv7()
  await client.query(
    `INSERT INTO labor_sheet_versions
       (id,organization_id,case_id,sheet_id,sheet_version,previous_version_id,source_type,
        currency,labor_ai_suggestion_run_id,revision_reason,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      versionId,
      input.organizationId,
      input.caseId,
      input.sheetId,
      input.sheetVersion,
      input.previousVersionId,
      input.sourceType,
      LABOR_SHEET_CURRENCY,
      input.laborAiSuggestionRunId,
      input.revisionReason,
      input.actorUserId,
    ],
  )
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index] as NormalizedLaborItem
    await client.query(
      `INSERT INTO labor_sheet_items
         (id,organization_id,case_id,sheet_id,sheet_version_id,ordinal,description,action,
          part_amount_minor,labor_amount_minor,part_code,part_code_source,damage_region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        uuidv7(),
        input.organizationId,
        input.caseId,
        input.sheetId,
        versionId,
        index + 1,
        item.description,
        item.action,
        item.partAmountMinor,
        item.laborAmountMinor,
        // Paket 56 kanıt alanları; verilmezse null kalır.
        item.partCode ?? null,
        item.partCodeSource ?? null,
        item.damageRegion ?? null,
      ],
    )
  }
  return versionId
}
