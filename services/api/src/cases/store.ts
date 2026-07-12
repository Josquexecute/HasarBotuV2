import type pg from 'pg'
import {
  caseDetailSchema,
  caseListItemSchema,
  type CaseDetail,
  type CaseListItem,
  type CasesQuery,
} from '@hasarbotu/contracts'

/**
 * Salt okunur Cases sorgu katmani. Yalniz parametreli SELECT calistirir;
 * hicbir yazma yapmaz. Satirlar gonderilmeden once contracts semasiyla
 * dogrulanir (sozlesme kaymasi calisma zamaninda yakalanir).
 */

interface CaseRow {
  id: string
  case_type: 'traffic' | 'casco'
  office_number: string
  notification_form_number: string | null
  insurer_claim_number: string | null
  plate: string
  lifecycle_status: 'open' | 'closed'
  workflow_stage: string
  responsible_user_id: string | null
  service_center_id: string | null
  insurer_id: string | null
  follow_up_date: Date | null
  last_intervention_at: Date | null
  created_at: Date
  updated_at: Date
  version: number
}

/** `date` kolonunu timezone kaydirmasi olmadan YYYY-MM-DD yazar. */
function toLocalDateString(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function rowToDto(row: CaseRow): CaseListItem {
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
    serviceId: row.service_center_id,
    insurerId: row.insurer_id,
    followUpDate: row.follow_up_date === null ? null : toLocalDateString(row.follow_up_date),
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

const SELECT_FIELDS = `
  id, case_type, office_number, notification_form_number, insurer_claim_number,
  plate, lifecycle_status, workflow_stage, responsible_user_id, service_center_id,
  insurer_id, follow_up_date, last_intervention_at, created_at, updated_at, version
`

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

      return { items: (listResult.rows as CaseRow[]).map(rowToDto), totalItems }
    },

    async findById(organizationId: string, caseId: string): Promise<CaseDetail | undefined> {
      const result = await pool.query(
        `SELECT ${SELECT_FIELDS} FROM cases WHERE organization_id = $1 AND id::text = $2`,
        [organizationId, caseId],
      )
      const row = result.rows[0] as CaseRow | undefined
      return row === undefined ? undefined : caseDetailSchema.parse(rowToDto(row))
    },
  }
}

export type CasesStore = ReturnType<typeof createCasesStore>
