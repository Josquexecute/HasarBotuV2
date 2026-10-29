import type pg from 'pg'
import { AUDIT_ACTION_CODES, AUDIT_ACTION_LABELS, auditCategory, auditResult, auditEventSchema, type AuditEvent, type AuditEventsQuery } from '@hasarbotu/contracts'

/**
 * Salt okunur audit sorgu katmani (Paket 11). Yalniz parametreli SELECT;
 * hicbir yazma yapmaz. Kiracı kapsami zorunlu `organization_id = $1` filtresidir
 * (cross-tenant sizinti engellenir). Satirlar contracts semasiyla dogrulanir.
 */
interface AuditRow {
  id: string
  organization_id: string | null
  actor_user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  request_id: string | null
  occurred_at: Date
  details: unknown
  actor_name?: string | null
  target_label?: string | null
  case_id?: string | null
}

function rowToDto(row: AuditRow, readable: boolean): AuditEvent {
  return auditEventSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.resource_type,
    entityId: row.resource_id,
    requestId: row.request_id,
    occurredAt: row.occurred_at.toISOString(),
    details: row.details ?? {},
    ...(readable ? { actorName: row.actor_name ?? null, targetLabel: row.target_label ?? null, caseId: row.case_id ?? null } : {}),
  })
}

const SELECT_FIELDS =
  'id, organization_id, actor_user_id, action, resource_type, resource_id, request_id, occurred_at, details'

export interface AuditListResult {
  readonly items: readonly AuditEvent[]
  readonly totalItems: number
}

export function createAuditQueryStore(pool: pg.Pool) {
  return {
    async list(organizationId: string, query: AuditEventsQuery): Promise<AuditListResult> {
      const where: string[] = ['organization_id = $1']
      const params: unknown[] = [organizationId]
      const add = (clause: string, value: unknown): void => {
        params.push(value)
        where.push(clause.replace('?', `$${params.length}`))
      }

      if (query.action !== undefined) add('action = ?', query.action)
      if (query.actorUserId !== undefined) add('actor_user_id::text = ?', query.actorUserId)
      if (query.entityType !== undefined) add('resource_type = ?', query.entityType)
      if (query.entityId !== undefined) add('resource_id = ?', query.entityId)
      if (query.occurredFrom !== undefined) add('occurred_at >= ?', query.occurredFrom)
      if (query.occurredTo !== undefined) add('occurred_at <= ?', query.occurredTo)
      if (query.category !== undefined) {
        const other = query.category === 'other'
        const prefixes = [...new Set(AUDIT_ACTION_CODES.filter(code => other ? auditCategory(code) !== 'other' : auditCategory(code) === query.category).map(code => code.split('.')[0]))]
        add(`${other ? 'NOT ' : ''}(split_part(action, '.', 1) = ANY(?::text[]))`, prefixes)
      }
      if (query.result !== undefined) {
        // Status codes take precedence over the action's business outcome, as in the UI.
        const status = "CASE WHEN details->>'statusCode' ~ '^[5-9][0-9]{2}$' THEN 'failed' WHEN details->>'statusCode' ~ '^4[0-9]{2}$' THEN 'rejected' ELSE NULL END"
        const recorded = query.result === 'recorded'
        const codes = AUDIT_ACTION_CODES.filter(code => recorded ? auditResult(code) !== 'recorded' : auditResult(code) === query.result)
        params.push(codes, query.result)
        where.push(`((${status}) = $${params.length} OR ((${status}) IS NULL AND ${recorded ? 'NOT ' : ''}(action = ANY($${params.length - 1}::text[]))))`)
      }
      if (query.search !== undefined) {
        const text = query.search.toLocaleLowerCase('tr-TR')
        const codes = Object.entries(AUDIT_ACTION_LABELS).filter(([code, label]) => code.includes(text) || label.toLocaleLowerCase('tr-TR').includes(text)).map(([code]) => code)
        params.push('%' + query.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%', codes)
        const pattern = `$${params.length - 1}`
        where.push(`(action ILIKE ${pattern} OR action = ANY($${params.length}::text[]) OR resource_id ILIKE ${pattern}
          OR actor_user_id IN (SELECT id FROM users WHERE organization_id=$1 AND display_name ILIKE ${pattern})
          OR COALESCE(CASE WHEN resource_type='case' THEN resource_id END, details->>'caseId') IN
            (SELECT id::text FROM cases WHERE organization_id=$1 AND (plate ILIKE ${pattern} OR office_number ILIKE ${pattern})))`)
      }

      const whereSql = where.join(' AND ')
      const countResult = await pool.query(
        `SELECT count(*)::int AS total FROM audit_events WHERE ${whereSql}`,
        params,
      )
      const totalItems = (countResult.rows[0] as { total: number }).total

      const offset = (query.page - 1) * query.pageSize
      const direction = query.sort === 'asc' ? 'ASC' : 'DESC'
      const listResult = await pool.query(
        `WITH page AS (SELECT ${SELECT_FIELDS} FROM audit_events WHERE ${whereSql}
         ORDER BY occurred_at ${direction}, id ${direction}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2})
         SELECT p.*, u.display_name AS actor_name,
           CASE WHEN c.id IS NOT NULL THEN c.office_number || ' · ' || c.plate ELSE target.display_name END AS target_label,
           c.id AS case_id FROM page p
         LEFT JOIN users u ON u.id=p.actor_user_id AND u.organization_id=p.organization_id
         LEFT JOIN users target ON p.resource_type='user' AND target.id::text=p.resource_id AND target.organization_id=p.organization_id
         LEFT JOIN cases c ON c.organization_id=p.organization_id AND c.id = CASE
           WHEN COALESCE(CASE WHEN p.resource_type='case' THEN p.resource_id END,p.details->>'caseId') ~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
           THEN COALESCE(CASE WHEN p.resource_type='case' THEN p.resource_id END,p.details->>'caseId')::uuid END
         ORDER BY p.occurred_at ${direction}, p.id ${direction}`,
        [...params, query.pageSize, offset],
      )

      return { items: (listResult.rows as AuditRow[]).map(row => rowToDto(row, query.presentation === 'readable')), totalItems }
    },
  }
}

export type AuditQueryStore = ReturnType<typeof createAuditQueryStore>
