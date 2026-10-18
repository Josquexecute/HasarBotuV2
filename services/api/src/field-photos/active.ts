import type { Queryable } from '../db/executor.js'

export async function hasActiveFieldPhoto(db: Queryable, organizationId: string, caseId: string) {
  return Boolean((await db.query("SELECT 1 FROM field_photo_uploads WHERE organization_id=$1 AND case_id=$2 AND status='processing' AND lease_expires_at>now() LIMIT 1", [organizationId, caseId])).rowCount)
}
