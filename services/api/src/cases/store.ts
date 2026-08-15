import type pg from 'pg'
import {
  caseLegacyReferencesSchema,
  caseDetailSchema,
  caseListItemSchema,
  type CaseLegacyReferences,
  type CaseDetail,
  type CaseListItem,
  type CasesQuery,
  type ServiceReference,
} from '@hasarbotu/contracts'
import { normalizeV1ResolutionName } from '@hasarbotu/domain'
import { loadServiceProfiles } from '../service-agreements/service.js'

/**
 * Salt okunur Cases sorgu katmani. Yalniz parametreli SELECT calistirir;
 * hicbir yazma yapmaz. Satirlar gonderilmeden once contracts semasiyla
 * dogrulanir (sozlesme kaymasi calisma zamaninda yakalanir).
 */

export interface CaseRow {
  id: string
  case_type: 'traffic' | 'casco'
  office_number: string
  notification_form_number: string | null
  insurer_claim_number: string | null
  plate: string
  lifecycle_status: 'open' | 'closed'
  workflow_stage: string
  responsible_user_id: string | null
  expert_user_id: string | null
  service_center_id: string | null
  insurer_id: string | null
  follow_up_date: Date | null
  loss_date: Date | null
  notification_date: Date | null
  last_intervention_at: Date | null
  created_at: Date
  updated_at: Date
  version: number
}

/** `date` kolonunu timezone kaydirmasi olmadan YYYY-MM-DD yazar. */
export function toLocalDateString(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function rowToDto(row: CaseRow, serviceProfile: ServiceReference | null = null): CaseListItem {
  return caseListItemSchema.parse({
    id: row.id,
    caseType: row.case_type,
    officeCaseNumber: row.office_number,
    notificationFormNumber: row.notification_form_number,
    insurerClaimNumber: row.insurer_claim_number,
    plate: row.plate,
    status: row.lifecycle_status,
    stage: row.workflow_stage,
    responsibleUserId: row.responsible_user_id,
    expertUserId: row.expert_user_id,
    serviceId: row.service_center_id,
    serviceProfile,
    insurerId: row.insurer_id,
    followUpDate: row.follow_up_date === null ? null : toLocalDateString(row.follow_up_date),
    lossDate: row.loss_date === null ? null : toLocalDateString(row.loss_date),
    notificationDate: row.notification_date === null ? null : toLocalDateString(row.notification_date),
    lastInterventionAt:
      row.last_intervention_at === null ? null : row.last_intervention_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  })
}

const SORT_COLUMNS: Record<CasesQuery['sortBy'], string> = {
  updatedAt: 'updated_at',
  followUpDate: 'follow_up_date',
  officeCaseNumber: 'office_year, office_sequence',
  plate: 'plate_normalized',
}

export const SELECT_FIELDS = `
  id, case_type, office_number, notification_form_number, insurer_claim_number,
  plate, lifecycle_status, workflow_stage, responsible_user_id, expert_user_id, service_center_id,
  insurer_id, follow_up_date, loss_date, notification_date, last_intervention_at, created_at, updated_at, version
`

interface LegacyReferenceRow {
  responsible_name: string | null
  expert_name: string | null
  service_name: string | null
}

interface CurrentReferenceRow {
  responsible_display_name: string | null
  responsible_email: string | null
  expert_display_name: string | null
  expert_email: string | null
  service_name: string | null
}

function compactIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR').replace(/ı/gu, 'i').normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]/gu, '')
}

function safeLegacyNames(values: readonly (string | null)[]): string[] {
  const byNormalized = new Map<string, string>()
  for (const value of values) {
    const trimmed = value?.trim() ?? ''
    const hasControl = [...trimmed].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || (code >= 127 && code <= 159)
    })
    if (trimmed.length === 0 || trimmed.length > 160 || hasControl
      || trimmed.startsWith('{') || trimmed.startsWith('[')) continue
    if (compactIdentity(trimmed) === 'atanmadi') continue
    const normalized = normalizeV1ResolutionName(trimmed)
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, trimmed)
  }
  return [...byNormalized.values()].sort((left, right) => left.localeCompare(right, 'tr-TR'))
}

function sameUserReference(legacyName: string, displayName: string | null, email: string | null): boolean {
  if (displayName !== null && normalizeV1ResolutionName(legacyName) === normalizeV1ResolutionName(displayName)) return true
  const localIdentity = email?.split('@', 1)[0] ?? ''
  return localIdentity.length > 0 && compactIdentity(legacyName) === compactIdentity(localIdentity)
}

async function loadLegacyReferences(pool: pg.Pool, organizationId: string, caseId: string): Promise<CaseLegacyReferences> {
  const [legacyResult, currentResult] = await Promise.all([
    pool.query<LegacyReferenceRow>(
      `WITH case_sources AS (
         SELECT DISTINCT stable_source_identity
           FROM v1_import_records
          WHERE organization_id=$1 AND case_id=$2 AND stable_source_identity IS NOT NULL
       ), latest_revisions AS (
         SELECT DISTINCT ON (revision.stable_source_identity) revision.raw_snapshot
           FROM v1_import_source_revisions revision
           JOIN case_sources source ON source.stable_source_identity=revision.stable_source_identity
          WHERE revision.organization_id=$1
          ORDER BY revision.stable_source_identity,COALESCE(revision.source_revision,0) DESC,
                   revision.recorded_at DESC,revision.id DESC
       )
       SELECT NULLIF(BTRIM(raw_snapshot #>> '{assignment,sorumlu}'),'') AS responsible_name,
              NULLIF(BTRIM(raw_snapshot #>> '{assignment,eksper}'),'') AS expert_name,
              NULLIF(BTRIM(raw_snapshot #>> '{service,name}'),'') AS service_name
         FROM latest_revisions`,
      [organizationId, caseId],
    ),
    pool.query<CurrentReferenceRow>(
      `SELECT responsible.display_name AS responsible_display_name,responsible.email AS responsible_email,
              expert.display_name AS expert_display_name,expert.email AS expert_email,
              service.name AS service_name
         FROM cases current_case
         LEFT JOIN users responsible ON responsible.organization_id=current_case.organization_id
          AND responsible.id=current_case.responsible_user_id
         LEFT JOIN users expert ON expert.organization_id=current_case.organization_id
          AND expert.id=current_case.expert_user_id
         LEFT JOIN service_centers service ON service.organization_id=current_case.organization_id
          AND service.id=current_case.service_center_id
        WHERE current_case.organization_id=$1 AND current_case.id=$2`,
      [organizationId, caseId],
    ),
  ])
  const current = currentResult.rows[0] ?? {
    responsible_display_name: null, responsible_email: null,
    expert_display_name: null, expert_email: null, service_name: null,
  }
  const responsibleNames = safeLegacyNames(legacyResult.rows.map((row) => row.responsible_name))
    .filter((name) => !sameUserReference(name, current.responsible_display_name, current.responsible_email))
  const expertNames = safeLegacyNames(legacyResult.rows.map((row) => row.expert_name))
    .filter((name) => !sameUserReference(name, current.expert_display_name, current.expert_email))
  const serviceNames = safeLegacyNames(legacyResult.rows.map((row) => row.service_name))
    .filter((name) => current.service_name === null
      || normalizeV1ResolutionName(name) !== normalizeV1ResolutionName(current.service_name))
  return caseLegacyReferencesSchema.parse({ responsibleNames, expertNames, serviceNames })
}

export interface CaseListResult {
  readonly items: readonly CaseListItem[]
  readonly totalItems: number
}

export function createCasesStore(pool: pg.Pool) {
  return {
    async list(organizationId: string, query: CasesQuery): Promise<CaseListResult> {
      const where: string[] = ['organization_id = $1']
      const params: unknown[] = [organizationId]
      const add = (clause: string, value: unknown): void => {
        params.push(value)
        where.push(clause.replace('?', `$${params.length}`))
      }

      if (query.caseType !== undefined) add('case_type = ?', query.caseType)
      if (query.status !== undefined) add('lifecycle_status = ?', query.status)
      if (query.stage !== undefined) add('workflow_stage = ?', query.stage)
      if (query.responsibleUserId !== undefined) add('responsible_user_id = ?', query.responsibleUserId)
      if (query.serviceId !== undefined) add('service_center_id = ?', query.serviceId)
      if (query.followUpFrom !== undefined) add('follow_up_date >= ?', query.followUpFrom)
      if (query.followUpTo !== undefined) add('follow_up_date <= ?', query.followUpTo)

      if (query.search !== undefined) {
        // Cok kelimeli arama: her kelime en az bir kimlik alaninda gecmelidir (AND).
        for (const token of query.search.trim().split(/\s+/)) {
          const plateToken = token.toUpperCase().replace(/[^A-Z0-9]/g, '')
          params.push(`%${token}%`)
          const textParam = `$${params.length}`
          params.push(`%${plateToken.length > 0 ? plateToken : token.toUpperCase()}%`)
          const plateParam = `$${params.length}`
          where.push(
            `(plate_normalized LIKE ${plateParam} OR office_number ILIKE ${textParam}` +
              ` OR notification_form_number ILIKE ${textParam} OR insurer_claim_number ILIKE ${textParam})`,
          )
        }
      }

      const whereSql = where.join(' AND ')
      const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC'
      const orderSql = SORT_COLUMNS[query.sortBy]
        .split(', ')
        .map((column) => `${column} ${direction} NULLS LAST`)
        .join(', ')

      const countResult = await pool.query(
        `SELECT count(*)::int AS total FROM cases WHERE ${whereSql}`,
        params,
      )
      const totalItems = (countResult.rows[0] as { total: number }).total

      const offset = (query.page - 1) * query.pageSize
      const listResult = await pool.query(
        `SELECT ${SELECT_FIELDS} FROM cases WHERE ${whereSql} ORDER BY ${orderSql}, id ${direction} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, offset],
      )

      const rows = listResult.rows as CaseRow[]
      const contexts = rows.flatMap((row) => row.service_center_id === null ? [] : [{
        key: row.id,
        serviceId: row.service_center_id,
        insurerId: row.insurer_id,
        evaluationDate: row.loss_date === null ? null : toLocalDateString(row.loss_date),
        dateSource: 'loss_date' as const,
        operation: 'closure_documents' as const,
      }])
      const profiles = await loadServiceProfiles(pool, organizationId, contexts)
      return { items: rows.map((row) => rowToDto(row, profiles.get(row.id) ?? null)), totalItems }
    },

    async findById(organizationId: string, caseId: string): Promise<CaseDetail | undefined> {
      const result = await pool.query(
        `SELECT ${SELECT_FIELDS} FROM cases WHERE organization_id = $1 AND id::text = $2`,
        [organizationId, caseId],
      )
      const row = result.rows[0] as CaseRow | undefined
      if (row === undefined) return undefined
      const profile = row.service_center_id === null ? null : await loadServiceProfiles(pool, organizationId, [{
        key: row.id,
        serviceId: row.service_center_id,
        insurerId: row.insurer_id,
        evaluationDate: row.loss_date === null ? null : toLocalDateString(row.loss_date),
        dateSource: 'loss_date',
        operation: 'closure_documents',
      }]).then((items) => items.get(row.id) ?? null)
      return caseDetailSchema.parse(rowToDto(row, profile))
    },

    async findLegacyReferences(organizationId: string, caseId: string): Promise<CaseLegacyReferences> {
      return loadLegacyReferences(pool, organizationId, caseId)
    },
  }
}

export type CasesStore = ReturnType<typeof createCasesStore>
