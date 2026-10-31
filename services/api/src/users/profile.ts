import type pg from 'pg'
import { accountProfileSchema } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { summarizeChange } from '../audit/redact.js'
import { withTransaction } from '../db/executor.js'

export async function updateAccountProfile(pool: pg.Pool, actor: { organizationId: string; actorUserId: string; requestId: string },
  targetUserId: string, input: { expectedVersion: number; displayName: string }) {
  return withTransaction(pool, async db => {
    const current = (await db.query('SELECT display_name,version,status FROM users WHERE organization_id=$1 AND id=$2 FOR UPDATE',
      [actor.organizationId, targetUserId])).rows[0]
    if (!current || targetUserId === actor.actorUserId && current.status !== 'active') return { kind: 'not_found' as const }
    if (current.version !== input.expectedVersion) return { kind: 'conflict' as const }
    if (current.display_name === input.displayName) return { kind: 'ok' as const, profile: accountProfileSchema.parse({ userId: targetUserId, displayName: current.display_name, version: current.version }) }
    const row = (await db.query('UPDATE users SET display_name=$1,version=version+1,updated_at=now() WHERE organization_id=$2 AND id=$3 RETURNING display_name,version',
      [input.displayName, actor.organizationId, targetUserId])).rows[0]
    await createAuditService().record(db, { ...actor, action: 'user.profile_updated', entityType: 'user', entityId: targetUserId,
      details: { ...summarizeChange({ displayName: current.display_name }, { displayName: row.display_name }), fromVersion: current.version, toVersion: row.version } })
    return { kind: 'ok' as const, profile: accountProfileSchema.parse({ userId: targetUserId, displayName: row.display_name, version: row.version }) }
  })
}
