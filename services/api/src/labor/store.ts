import type pg from 'pg'
import {
  laborSheetResponseSchema,
  laborSheetSchema,
  laborSheetWorkspaceResponseSchema,
  type LaborSheet,
  type LaborSheetCreateRequest,
  type LaborSheetReviseRequest,
  type LaborSheetWorkspaceResponse,
} from '@hasarbotu/contracts'
import {
  LABOR_SHEET_CURRENCY,
  LABOR_SHEET_SCHEMA_VERSION,
  computeLaborSheetTotals,
  validateLaborSheetItems,
  type LaborSheetInvalidReason,
  type NormalizedLaborItem,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import type { Queryable } from '../db/executor.js'
import {
  findIdempotent,
  insertIdempotent,
  isIdempotencyRace,
  type IdempotentRecord,
} from '../db/idempotency.js'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface IdempotencyContext {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

interface CaseContextRow {
  readonly lifecycle_status: 'open' | 'closed'
  readonly version: number
}

interface SheetRow {
  readonly id: string
  readonly case_id: string
  readonly current_version_id: string
  readonly version: number
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
  readonly updated_at: Date
}

interface VersionRow {
  readonly id: string
  readonly sheet_id: string
  readonly sheet_version: number
  readonly previous_version_id: string | null
  readonly source_type: 'user_entered' | 'ai_assisted' | 'manual_revision'
  readonly currency: string
  readonly labor_ai_suggestion_run_id: string | null
  readonly revision_reason: string | null
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
}

interface ItemRow {
  readonly sheet_version_id: string
  readonly ordinal: number
  readonly description: string
  readonly action: string
  readonly part_amount_minor: string
  readonly labor_amount_minor: string
}

export type LaborCommandOutcome<T> =
  | { readonly kind: 'ok'; readonly response: T }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'case_closed' }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'sheet_exists' }
  | { readonly kind: 'sheet_missing' }
  | { readonly kind: 'invalid_items'; readonly reasonCode: LaborSheetInvalidReason; readonly itemOrdinal: number | null }
  | { readonly kind: 'invalid_ai_suggestion' }
  | { readonly kind: 'idempotency_race' }

function safeMinor(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('labor_amount_out_of_range')
  return parsed
}

async function readCaseContext(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  forUpdate = false,
): Promise<CaseContextRow | undefined> {
  const result = await exec.query(
    `SELECT lifecycle_status,version
       FROM cases WHERE organization_id=$1 AND id::text=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId],
  )
  return result.rows[0] as CaseContextRow | undefined
}

async function loadSheet(
  exec: Queryable,
  organizationId: string,
  caseId: string,
): Promise<LaborSheet | undefined> {
  const sheetResult = await exec.query(
    `SELECT s.id,s.case_id::text AS case_id,s.current_version_id,s.version,
            s.created_by_user_id,creator.display_name AS created_by_display_name,
            s.created_at,s.updated_at
       FROM labor_sheets s
       JOIN users creator ON creator.organization_id=s.organization_id AND creator.id=s.created_by_user_id
      WHERE s.organization_id=$1 AND s.case_id::text=$2`,
    [organizationId, caseId],
  )
  const sheet = sheetResult.rows[0] as SheetRow | undefined
  if (sheet === undefined) return undefined
  const versionsResult = await exec.query(
    `SELECT v.id,v.sheet_id,v.sheet_version,v.previous_version_id,v.source_type,v.currency,
            v.labor_ai_suggestion_run_id,v.revision_reason,
            v.created_by_user_id,creator.display_name AS created_by_display_name,
            v.created_at
       FROM labor_sheet_versions v
       JOIN users creator ON creator.organization_id=v.organization_id AND creator.id=v.created_by_user_id
      WHERE v.organization_id=$1 AND v.sheet_id=$2
      ORDER BY v.sheet_version DESC`,
    [organizationId, sheet.id],
  )
  const itemsResult = await exec.query(
    `SELECT sheet_version_id,ordinal,description,action,
            part_amount_minor::text AS part_amount_minor,labor_amount_minor::text AS labor_amount_minor
       FROM labor_sheet_items
      WHERE organization_id=$1 AND sheet_id=$2
      ORDER BY sheet_version_id,ordinal`,
    [organizationId, sheet.id],
  )
  const versions = versionsResult.rows as VersionRow[]
  const items = itemsResult.rows as ItemRow[]
  const mappedVersions = versions.map((version) => {
    const versionItems = items
      .filter((item) => item.sheet_version_id === version.id)
      .map((item) => ({
        ordinal: item.ordinal,
        description: item.description,
        action: item.action,
        partAmountMinor: safeMinor(item.part_amount_minor),
        laborAmountMinor: safeMinor(item.labor_amount_minor),
      }))
    const totals = computeLaborSheetTotals(versionItems)
    return {
      id: version.id,
      sheetVersion: version.sheet_version,
      previousVersionId: version.previous_version_id,
      items: versionItems,
      totals,
      schemaVersion: LABOR_SHEET_SCHEMA_VERSION,
      currency: version.currency,
      sourceType: version.source_type,
      laborAiSuggestionRunId: version.labor_ai_suggestion_run_id,
      revisionReason: version.revision_reason,
      createdByUserId: version.created_by_user_id,
      createdByDisplayName: version.created_by_display_name,
      createdAt: version.created_at.toISOString(),
    }
  })
  const currentVersion = mappedVersions.find((version) => version.id === sheet.current_version_id)
  if (currentVersion === undefined) throw new Error('labor_sheet_current_version_missing')
  return laborSheetSchema.parse({
    id: sheet.id,
    caseId: sheet.case_id,
    version: sheet.version,
    currentVersion,
    versions: mappedVersions,
    createdByUserId: sheet.created_by_user_id,
    createdByDisplayName: sheet.created_by_display_name,
    createdAt: sheet.created_at.toISOString(),
    updatedAt: sheet.updated_at.toISOString(),
  })
}

async function validLaborAiSuggestion(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  runId: string,
): Promise<boolean> {
  const result = await exec.query(
    `SELECT 1 FROM labor_ai_suggestion_runs
      WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND status='review_required'`,
    [organizationId, caseId, runId],
  )
  return result.rowCount === 1
}

async function insertItems(
  client: pg.PoolClient,
  actor: ActorContext,
  caseId: string,
  sheetId: string,
  versionId: string,
  items: readonly NormalizedLaborItem[],
): Promise<void> {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as NormalizedLaborItem
    await client.query(
      `INSERT INTO labor_sheet_items
         (id,organization_id,case_id,sheet_id,sheet_version_id,ordinal,description,action,
          part_amount_minor,labor_amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuidv7(),
        actor.organizationId,
        caseId,
        sheetId,
        versionId,
        index + 1,
        item.description,
        item.action,
        item.partAmountMinor,
        item.laborAmountMinor,
      ],
    )
  }
}

export function createLaborStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    findIdempotent(organizationId: string, scope: string, key: string): Promise<IdempotentRecord | undefined> {
      return findIdempotent(pool, organizationId, scope, key)
    },

    async readWorkspace(
      organizationId: string,
      caseId: string,
      canWrite: boolean,
    ): Promise<LaborSheetWorkspaceResponse | undefined> {
      const context = await readCaseContext(pool, organizationId, caseId)
      if (context === undefined) return undefined
      return laborSheetWorkspaceResponseSchema.parse({
        caseId,
        caseVersion: context.version,
        lifecycleStatus: context.lifecycle_status,
        sheet: await loadSheet(pool, organizationId, caseId) ?? null,
        permissions: {
          canWrite: canWrite && context.lifecycle_status === 'open',
        },
      })
    },

    async createSheet(
      actor: ActorContext,
      caseId: string,
      input: LaborSheetCreateRequest,
      idempotency: IdempotencyContext,
    ): Promise<LaborCommandOutcome<ReturnType<typeof laborSheetResponseSchema.parse>>> {
      const validation = validateLaborSheetItems(input.items)
      if (!validation.valid) {
        return { kind: 'invalid_items', reasonCode: validation.reasonCode, itemOrdinal: validation.itemOrdinal }
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const context = await readCaseContext(client, actor.organizationId, caseId, true)
        if (context === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (context.lifecycle_status !== 'open') {
          await client.query('ROLLBACK')
          return { kind: 'case_closed' }
        }
        if (context.version !== input.expectedCaseVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const existing = await client.query(
          'SELECT 1 FROM labor_sheets WHERE organization_id=$1 AND case_id::text=$2',
          [actor.organizationId, caseId],
        )
        if (existing.rowCount !== null && existing.rowCount > 0) {
          await client.query('ROLLBACK')
          return { kind: 'sheet_exists' }
        }
        const aiRunId = input.laborAiSuggestionRunId
        if (aiRunId !== null && !await validLaborAiSuggestion(client, actor.organizationId, caseId, aiRunId)) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_ai_suggestion' }
        }
        const sourceType = aiRunId === null ? 'user_entered' : 'ai_assisted'
        const sheetId = uuidv7()
        const versionId = uuidv7()
        await client.query(
          'INSERT INTO labor_sheets (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
          [sheetId, actor.organizationId, caseId, actor.actorUserId],
        )
        await client.query(
          `INSERT INTO labor_sheet_versions
             (id,organization_id,case_id,sheet_id,sheet_version,source_type,currency,
              labor_ai_suggestion_run_id,created_by_user_id)
           VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
          [versionId, actor.organizationId, caseId, sheetId, sourceType, LABOR_SHEET_CURRENCY, aiRunId, actor.actorUserId],
        )
        await insertItems(client, actor, caseId, sheetId, versionId, validation.items)
        await client.query(
          'UPDATE labor_sheets SET current_version_id=$1,updated_at=now() WHERE id=$2',
          [versionId, sheetId],
        )
        const created = await loadSheet(client, actor.organizationId, caseId)
        if (created === undefined) throw new Error('labor_sheet_create_readback_failed')
        const response = laborSheetResponseSchema.parse({ sheet: created })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'labor_sheet.created',
          entityType: 'labor_sheet',
          entityId: sheetId,
          details: {
            caseId,
            sheetVersion: 1,
            itemCount: validation.items.length,
            partTotalMinor: validation.totals.partTotalMinor,
            laborTotalMinor: validation.totals.laborTotalMinor,
            grandTotalMinor: validation.totals.grandTotalMinor,
            sourceType,
            laborAiSuggestionRunId: aiRunId,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody: response,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', response }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },

    async reviseSheet(
      actor: ActorContext,
      caseId: string,
      input: LaborSheetReviseRequest,
      idempotency: IdempotencyContext,
    ): Promise<LaborCommandOutcome<ReturnType<typeof laborSheetResponseSchema.parse>>> {
      const validation = validateLaborSheetItems(input.items)
      if (!validation.valid) {
        return { kind: 'invalid_items', reasonCode: validation.reasonCode, itemOrdinal: validation.itemOrdinal }
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const context = await readCaseContext(client, actor.organizationId, caseId, true)
        if (context === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (context.lifecycle_status !== 'open') {
          await client.query('ROLLBACK')
          return { kind: 'case_closed' }
        }
        const sheetResult = await client.query(
          `SELECT id,version,current_version_id
             FROM labor_sheets
            WHERE organization_id=$1 AND case_id::text=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const sheet = sheetResult.rows[0] as { id: string; version: number; current_version_id: string } | undefined
        if (sheet === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'sheet_missing' }
        }
        if (sheet.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const aiRunId = input.laborAiSuggestionRunId
        if (aiRunId !== null && !await validLaborAiSuggestion(client, actor.organizationId, caseId, aiRunId)) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_ai_suggestion' }
        }
        const sourceType = aiRunId === null ? 'manual_revision' : 'ai_assisted'
        const nextVersion = sheet.version + 1
        const versionId = uuidv7()
        await client.query(
          `INSERT INTO labor_sheet_versions
             (id,organization_id,case_id,sheet_id,sheet_version,previous_version_id,source_type,
              currency,labor_ai_suggestion_run_id,revision_reason,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            versionId,
            actor.organizationId,
            caseId,
            sheet.id,
            nextVersion,
            sheet.current_version_id,
            sourceType,
            LABOR_SHEET_CURRENCY,
            aiRunId,
            input.reason,
            actor.actorUserId,
          ],
        )
        await insertItems(client, actor, caseId, sheet.id, versionId, validation.items)
        await client.query(
          'UPDATE labor_sheets SET current_version_id=$1,version=$2,updated_at=now() WHERE id=$3',
          [versionId, nextVersion, sheet.id],
        )
        const revised = await loadSheet(client, actor.organizationId, caseId)
        if (revised === undefined) throw new Error('labor_sheet_revise_readback_failed')
        const response = laborSheetResponseSchema.parse({ sheet: revised })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'labor_sheet.revised',
          entityType: 'labor_sheet',
          entityId: sheet.id,
          details: {
            caseId,
            sheetVersion: nextVersion,
            itemCount: validation.items.length,
            partTotalMinor: validation.totals.partTotalMinor,
            laborTotalMinor: validation.totals.laborTotalMinor,
            grandTotalMinor: validation.totals.grandTotalMinor,
            sourceType,
            laborAiSuggestionRunId: aiRunId,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 200,
          responseBody: response,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', response }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },
  }
}
