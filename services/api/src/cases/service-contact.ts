import type pg from 'pg'
import type { CaseListItem, CaseServiceContact, CaseServiceContactInput } from '@hasarbotu/contracts'
import { matchEksistReference, resolveServiceContact } from '@hasarbotu/domain'
import { ReferenceCheckError } from './write-store.js'
import { uuidv7 } from '@hasarbotu/database'

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>
type Source = { text: string; name: string; revised: boolean }

export async function selectServiceContact(exec: Queryable, organizationId: string, details: CaseServiceContactInput, serviceId?: string | null, currentServiceId?: string | null) {
  // Serialize directory creation within the surrounding case-write transaction.
  await exec.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`service-directory:${organizationId}`])
  const services = await exec.query<{ id: string; name: string }>('SELECT id,name FROM service_centers WHERE organization_id=$1 AND (is_active OR id=$2)', [organizationId, currentServiceId ?? null])
  if (serviceId) {
    const selected = services.rows.find(row => row.id === serviceId)
    if (!selected || !matchEksistReference(details.name, [selected])) throw new ReferenceCheckError('serviceDetails.name', 'service_identity_mismatch')
    return serviceId
  }
  const matches = services.rows.filter(row => matchEksistReference(details.name, [row]))
  if (matches.length > 1) throw new ReferenceCheckError('serviceDetails.name', 'service_identity_ambiguous')
  if (matches.length === 1) return matches[0]!.id
  // An inactive/ambiguous identity needs an explicit selection, never a duplicate.
  const inactive = await exec.query<{ id: string; name: string }>('SELECT id,name FROM service_centers WHERE organization_id=$1 AND NOT is_active', [organizationId])
  if (inactive.rows.some(row => matchEksistReference(details.name, [row]))) throw new ReferenceCheckError('serviceDetails.name', 'service_identity_inactive')
  // Older directory clients cap names at 200; longer case contacts use the name filter.
  if (details.name.trim().length > 200) return null
  const id = uuidv7()
  await exec.query(`INSERT INTO service_centers(id,organization_id,name,center_type,service_type,phone) VALUES($1,$2,$3,'ozel','other',$4)`,
    [id, organizationId, details.name.trim(), details.phone?.trim() || null])
  return id
}

/** Contacts belong to a case/service identity, never to an unrelated previous selection. */
export async function saveServiceContact(exec: Queryable, organizationId: string, caseId: string, userId: string, details?: CaseServiceContactInput | null, source?: Source): Promise<void> {
  const result = await exec.query<{
    service_center_id: string | null; directory_name: string | null; directory_phone: string | null
    name: string | null; phone: string | null; address: string | null; contact_service_id: string | null
    raw_text: string | null; automatic: { serviceName: string; serviceRevised: boolean } | null
  }>(`SELECT c.service_center_id,s.name AS directory_name,s.phone AS directory_phone,
      sc.name,sc.phone,sc.address,sc.service_center_id AS contact_service_id,e.raw_text,e.reviewed_fields->'automatic' AS automatic
    FROM cases c LEFT JOIN service_centers s ON s.organization_id=c.organization_id AND s.id=c.service_center_id
    LEFT JOIN case_service_contacts sc ON sc.organization_id=c.organization_id AND sc.case_id=c.id
    LEFT JOIN LATERAL (SELECT raw_text,reviewed_fields FROM eksist_sources WHERE organization_id=c.organization_id
      AND case_id=c.id AND reviewed_fields ? 'automatic' ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
    WHERE c.organization_id=$1 AND c.id=$2`, [organizationId, caseId])
  const row = result.rows[0]!
  const name = details === null ? '' : details?.name ?? source?.name ?? row.directory_name ?? row.automatic?.serviceName ?? ''
  if (!name) {
    await exec.query('DELETE FROM case_service_contacts WHERE organization_id=$1 AND case_id=$2', [organizationId, caseId])
    return
  }
  const fallback = resolveServiceContact({ serviceName: name, servicePhone: row.directory_phone, eksistText: source?.text ?? row.raw_text, eksistServiceRevised: source?.revised ?? row.automatic?.serviceRevised ?? false })
  const sameName = row.name !== null && matchEksistReference(name, [{ id: 'same', name: row.name }]) !== null
  const same = sameName && (row.contact_service_id === row.service_center_id
    || row.contact_service_id === null && row.directory_name !== null && matchEksistReference(name, [{ id: 'same', name: row.directory_name }]) !== null)
  const phone = details?.phone !== undefined ? details.phone?.trim() || null : same ? row.phone : fallback.servicePhone || null
  const address = details?.address !== undefined ? details.address?.trim() || null : same ? row.address : fallback.serviceAddress || null
  await exec.query(`INSERT INTO case_service_contacts(organization_id,case_id,service_center_id,name,phone,address,updated_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,case_id) DO UPDATE SET
    service_center_id=EXCLUDED.service_center_id,name=EXCLUDED.name,phone=EXCLUDED.phone,address=EXCLUDED.address,
    updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
    WHERE (case_service_contacts.service_center_id,case_service_contacts.name,case_service_contacts.phone,case_service_contacts.address)
      IS DISTINCT FROM (EXCLUDED.service_center_id,EXCLUDED.name,EXCLUDED.phone,EXCLUDED.address)`,
  [organizationId, caseId, row.service_center_id, name, phone, address, userId])
}

/** Opt-in enrichment preserves the response shape consumed by older office clients. */
export async function withServiceContacts(exec: Queryable, organizationId: string, items: readonly CaseListItem[]): Promise<CaseListItem[]> {
  if (!items.length) return []
  const result = await exec.query<{
    id: string; service_center_id: string | null; directory_name: string | null; directory_phone: string | null
    name: string | null; phone: string | null; address: string | null; contact_service_id: string | null
    raw_text: string | null; automatic: { serviceName: string; serviceRevised: boolean } | null
  }>(`SELECT c.id,c.service_center_id,s.name AS directory_name,s.phone AS directory_phone,
      sc.name,sc.phone,sc.address,sc.service_center_id AS contact_service_id,e.raw_text,e.reviewed_fields->'automatic' AS automatic
    FROM cases c LEFT JOIN service_centers s ON s.organization_id=c.organization_id AND s.id=c.service_center_id
    LEFT JOIN case_service_contacts sc ON sc.organization_id=c.organization_id AND sc.case_id=c.id
    LEFT JOIN LATERAL (SELECT raw_text,reviewed_fields FROM eksist_sources WHERE organization_id=c.organization_id
      AND case_id=c.id AND reviewed_fields ? 'automatic' ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
    WHERE c.organization_id=$1 AND c.id=ANY($2::uuid[])`, [organizationId, items.map(item => item.id)])
  const contacts = new Map<string, CaseServiceContact | null>(result.rows.map(row => {
    if (row.name && row.contact_service_id === row.service_center_id) return [row.id, { name: row.name, phone: row.phone, address: row.address }]
    const fields = resolveServiceContact({ serviceName: row.directory_name ?? row.automatic?.serviceName ?? null, servicePhone: row.directory_phone, eksistText: row.raw_text, eksistServiceRevised: row.automatic?.serviceRevised ?? false })
    return [row.id, fields.serviceName ? { name: fields.serviceName, phone: fields.servicePhone || null, address: fields.serviceAddress || null } : null]
  }))
  return items.map(item => ({ ...item, serviceDetails: contacts.get(item.id) ?? null }))
}
