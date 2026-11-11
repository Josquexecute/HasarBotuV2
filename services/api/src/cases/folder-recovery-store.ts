import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import { parsePlateNumber, plateSearchKey } from '@hasarbotu/domain'
import { folderCheckSchema, folderRecoveryResponseSchema } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'

const requestedAction = 'cases.folder_check_requested'
const completedAction = 'cases.folder_check_completed'
const audit = createAuditService()

async function latestCheck(pool: pg.Pool, organizationId: string) {
  const row = (await pool.query(`SELECT r.details->>'checkId' id,r.occurred_at AS "requestedAt",c.occurred_at AS "completedAt",
    (c.details->>'repaired')::int repaired,(c.details->>'remaining')::int remaining
    FROM audit_events r LEFT JOIN LATERAL (SELECT details,occurred_at FROM audit_events
      WHERE organization_id=r.organization_id AND action=$3 AND details->>'checkId'=r.details->>'checkId'
      ORDER BY occurred_at DESC,id DESC LIMIT 1) c ON true
    WHERE r.organization_id=$1 AND r.action=$2 ORDER BY r.occurred_at DESC,r.id DESC LIMIT 1`,
  [organizationId, requestedAction, completedAction])).rows[0]
  return row ? folderCheckSchema.parse(JSON.parse(JSON.stringify(row))) : null
}

export async function listFolderRecovery(pool: pg.Pool, organizationId: string, search: string) {
  const plate = parsePlateNumber(search)
  const normalized = plate.ok ? plateSearchKey(plate.value) : ''
  if (!normalized) return folderRecoveryResponseSchema.parse({ items: [], latestCheck: await latestCheck(pool, organizationId) })
  const items = (await pool.query(`SELECT c.id AS "caseId",c.plate,c.office_number AS "officeNumber",l.relative_path AS "relativePath",
    CASE WHEN c.is_archived AND coalesce(i.details->>'managedArchive','false')<>'true' THEN 'manually_archived'
      WHEN c.is_archived OR l.id IS NULL OR l.verification_status<>'verified'
        OR d.occurred_at>l.updated_at THEN 'needs_check' ELSE 'verified' END status
    FROM cases c LEFT JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id
    LEFT JOIN LATERAL (SELECT details FROM audit_events WHERE organization_id=c.organization_id AND resource_id=c.id::text
      AND action='case.office_inventory_reconciled' ORDER BY occurred_at DESC,id DESC LIMIT 1) i ON true
    LEFT JOIN LATERAL (SELECT occurred_at FROM audit_events WHERE organization_id=c.organization_id AND resource_id=c.id::text
      AND action='case.office_inventory_deferred' ORDER BY occurred_at DESC,id DESC LIMIT 1) d ON true
    WHERE c.organization_id=$1 AND strpos(c.plate_normalized,$2)>0 ORDER BY c.updated_at DESC,c.id LIMIT 50`, [organizationId, normalized])).rows
  return folderRecoveryResponseSchema.parse({ items, latestCheck: await latestCheck(pool, organizationId) })
}

export async function requestFolderCheck(pool: pg.Pool, actor: { organizationId: string; actorUserId: string; requestId: string }) {
  return withTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-check:${actor.organizationId}`])
    const existing = (await db.query(`SELECT details->>'checkId' id,occurred_at AS "requestedAt" FROM audit_events r
      WHERE organization_id=$1 AND action=$2 AND occurred_at>now()-interval '90 seconds'
      AND NOT EXISTS(SELECT 1 FROM audit_events c WHERE c.organization_id=r.organization_id AND c.action=$3
        AND c.details->>'checkId'=r.details->>'checkId') ORDER BY occurred_at DESC,id DESC LIMIT 1`,
    [actor.organizationId, requestedAction, completedAction])).rows[0]
    if (existing) return folderCheckSchema.parse(JSON.parse(JSON.stringify({ ...existing, completedAt: null, repaired: null, remaining: null })))
    const id = uuidv7()
    await audit.record(db, { ...actor, action: requestedAction, entityType: 'organization', entityId: actor.organizationId, details: { checkId: id } })
    const row = (await db.query(`SELECT occurred_at FROM audit_events WHERE organization_id=$1 AND action=$2 AND details->>'checkId'=$3`, [actor.organizationId, requestedAction, id])).rows[0]
    return folderCheckSchema.parse({ id, requestedAt: row.occurred_at.toISOString(), completedAt: null, repaired: null, remaining: null })
  })
}

/** A request completes only after a later, successful scan; a stopped worker never reports success. */
export async function completeFolderChecks(pool: pg.Pool, actor: { organizationId: string; actorUserId: string }, scanStartedAt: string,
  result: { repaired: number; remaining: number }) {
  await withTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`folder-check:${actor.organizationId}`])
    const requests = (await db.query(`SELECT details->>'checkId' id FROM audit_events r WHERE organization_id=$1 AND action=$2
      AND occurred_at<=$4::timestamptz AND NOT EXISTS(SELECT 1 FROM audit_events c WHERE c.organization_id=r.organization_id
        AND c.action=$3 AND c.details->>'checkId'=r.details->>'checkId') ORDER BY occurred_at,id LIMIT 20`,
    [actor.organizationId, requestedAction, completedAction, scanStartedAt])).rows
    for (const request of requests) await audit.record(db, { ...actor, action: completedAction, entityType: 'organization', entityId: actor.organizationId,
      details: { checkId: request.id, ...result }, requestId: 'folder-check-' + request.id })
  })
}
