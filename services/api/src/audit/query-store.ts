import type pg from 'pg'
import { auditEventSchema, type AuditEvent, type AuditEventsQuery } from '@hasarbotu/contracts'

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
}

function rowToDto(row: AuditRow): AuditEvent {
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

      const whereSql = where.join(' AND ')
      const countResult = await pool.query(
        `SELECT count(*)::int AS total FROM audit_events WHERE ${whereSql}`,
        params,
      )
      const totalItems = (countResult.rows[0] as { total: number }).total

      const offset = (query.page - 1) * query.pageSize
      const listResult = await pool.query(
        `SELECT ${SELECT_FIELDS} FROM audit_events WHERE ${whereSql}
         ORDER BY occurred_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, offset],
      )

      return { items: (listResult.rows as AuditRow[]).map(rowToDto), totalItems }
    },
  }
}

export type AuditQueryStore = ReturnType<typeof createAuditQueryStore>
