import type pg from 'pg'
import {
  laborDictionaryResponseSchema,
  type LaborDictionaryQuery,
  type LaborDictionaryResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_DICTIONARY_SCHEMA_VERSION,
  MAX_LABOR_DICTIONARY_ENTRIES,
  normalizeLaborDictionaryEntry,
  searchLaborDictionary,
  type LaborDictionaryEntry,
} from '@hasarbotu/domain'

interface DictionaryRow {
  readonly description: string
  readonly action: string
  readonly usage_count: string
  readonly last_part_amount_minor: string
  readonly last_labor_amount_minor: string
  readonly last_used_at: Date
}

function safeCount(value: string): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * Sözlük yeni bir gerçek kaynağı değildir: yalnız organization içindeki
 * güncel (current) föy sürümlerinin satır kalemlerinden türetilir. Salt
 * okunurdur ve audit yazmaz.
 */
export function createLaborDictionaryStore(pool: pg.Pool) {
  return {
    async list(
      organizationId: string,
      input: LaborDictionaryQuery,
    ): Promise<LaborDictionaryResponse> {
      const result = await pool.query(
        `SELECT i.description,
                i.action,
                count(*)::text AS usage_count,
                (array_agg(i.part_amount_minor ORDER BY v.created_at DESC, i.id DESC))[1]::text
                  AS last_part_amount_minor,
                (array_agg(i.labor_amount_minor ORDER BY v.created_at DESC, i.id DESC))[1]::text
                  AS last_labor_amount_minor,
                max(v.created_at) AS last_used_at
           FROM labor_sheet_items i
           JOIN labor_sheet_versions v
             ON v.organization_id=i.organization_id AND v.id=i.sheet_version_id
           JOIN labor_sheets s
             ON s.organization_id=v.organization_id AND s.id=v.sheet_id
            AND s.current_version_id=v.id
          WHERE i.organization_id=$1
          GROUP BY i.description,i.action
          ORDER BY count(*) DESC, max(v.created_at) DESC
          LIMIT $2`,
        [organizationId, MAX_LABOR_DICTIONARY_ENTRIES],
      )
      const entries: LaborDictionaryEntry[] = []
      for (const row of result.rows as DictionaryRow[]) {
        const normalized = normalizeLaborDictionaryEntry({
          description: row.description,
          action: row.action,
          usageCount: safeCount(row.usage_count),
          lastPartAmountMinor: safeCount(row.last_part_amount_minor),
          lastLaborAmountMinor: safeCount(row.last_labor_amount_minor),
          lastUsedAt: row.last_used_at.toISOString(),
        })
        if (normalized !== null) entries.push(normalized)
      }
      return laborDictionaryResponseSchema.parse({
        schemaVersion: LABOR_DICTIONARY_SCHEMA_VERSION,
        items: searchLaborDictionary(entries, input.query, input.limit).map((entry) => ({
          description: entry.description,
          action: entry.action,
          usageCount: entry.usageCount,
          lastPartAmountMinor: entry.lastPartAmountMinor,
          lastLaborAmountMinor: entry.lastLaborAmountMinor,
          lastUsedAt: entry.lastUsedAt,
        })),
      })
    },
  }
}

export type LaborDictionaryStore = ReturnType<typeof createLaborDictionaryStore>
