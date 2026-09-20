import type pg from 'pg'
import { eksistCaseDataSchema, type CaseListItem, type EksistCaseData } from '@hasarbotu/contracts'
import { eksistKey, matchEksistReference, parseEksist } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { ReferenceCheckError } from '../cases/write-store.js'

/** Reparse the stored original, never trust browser-supplied names or vehicle fields. */
export async function applyEksistSource(client: pg.PoolClient, organizationId: string, caseId: string, sourceId: string, text: string, serviceRevision?: { name: string }, review?: { method: string; expertReview?: { name: string; confirmed: true } }): Promise<EksistCaseData> {
  const data = parseEksist(text)
  // Turkish I/İ cannot be inferred from OCR text. Keep the original as evidence
  // and require a source-checked name; never silently replace identity letters.
  if (review?.method === 'ocr') {
    if (!review.expertReview?.confirmed) throw new ReferenceCheckError('expertUserId', 'eksist_expert_review_required')
    data.expert = review.expertReview.name
  } else if (review?.expertReview) throw new ReferenceCheckError('expertUserId', 'eksist_expert_review_not_allowed')
  for (const [field, value] of Object.entries({ insurerId: data.insurer, expertUserId: data.expert, notificationFormNumber: data.assignmentDate })) {
    if (!value) throw new ReferenceCheckError(field, 'eksist_source_required')
  }
  const requiredVehicle = ['Plaka', 'Marka', 'Araç Tipi', 'Model Yılı', 'Araç Tarife Grubu', 'Motor No', 'Şasi No']
  if (requiredVehicle.some(label => !data.vehicleFields[label])) throw new ReferenceCheckError('vehicle', 'eksist_vehicle_incomplete')
  if (data.conflicts.some(field => ['sigortasirketi', 'eksperadsoyad', 'eksperatamatarihi', 'levhano', 'tuzeleksperlevhano', ...requiredVehicle.map(eksistKey)].includes(field))) {
    throw new ReferenceCheckError('source.id', 'eksist_source_conflict')
  }
  if (!serviceRevision && data.conflicts.some(field => ['tamirhaneadunvan', 'tamirhanesoyad'].includes(field))) throw new ReferenceCheckError('serviceId', 'use_service_revision')
  const parsed = eksistCaseDataSchema.safeParse({ sourceId, assignmentDate: data.assignmentDate, assignmentDateText: data.assignmentDateText, insurerName: data.insurer, expertName: data.expert, expertLicenseNumber: data.expertLicenseNumber, corporateExpertLicenseNumber: data.corporateExpertLicenseNumber, serviceName: serviceRevision?.name ?? data.service, serviceRevised: serviceRevision !== undefined, vehicleFields: data.vehicleFields })
  if (!parsed.success) throw new ReferenceCheckError('source.id', 'eksist_source_invalid')
  const snapshot = parsed.data
  // Name lookup/creation and the case/source commit share one transaction.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`eksist-insurer:${organizationId}`])
  const insurers = await client.query<{ id: string; name: string }>('SELECT id,name FROM insurers WHERE organization_id=$1 AND is_active', [organizationId])
  let insurerId = matchEksistReference(data.insurer, insurers.rows, true)
  if (!insurerId) {
    const result = await client.query<{ id: string; is_active: boolean }>(`INSERT INTO insurers(id,organization_id,name) VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id,is_active`, [uuidv7(), organizationId, data.insurer])
    if (!result.rows[0]!.is_active) throw new ReferenceCheckError('insurerId', 'inactive_or_ineligible_reference')
    insurerId = result.rows[0]!.id
  }
  const experts = await client.query<{ id: string; name: string }>(`SELECT u.id,u.display_name AS name FROM users u WHERE u.organization_id=$1 AND u.status='active' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='expert')`, [organizationId])
  const services = await client.query<{ id: string; name: string }>('SELECT id,name FROM service_centers WHERE organization_id=$1 AND is_active', [organizationId])
  const nameKey = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
  const matchedExperts = experts.rows.filter(expert => nameKey(expert.name) === nameKey(data.expert))
  await client.query('UPDATE cases SET notification_form_number=$3,insurer_id=$4,expert_user_id=$5,service_center_id=$6 WHERE organization_id=$1 AND id=$2', [organizationId, caseId, snapshot.assignmentDateText, insurerId, matchedExperts.length === 1 ? matchedExperts[0]!.id : null, matchEksistReference(snapshot.serviceName, services.rows)])
  return snapshot
}

/** Batched opt-in enrichment keeps existing strict read clients compatible. */
export async function withEksistData(pool: pg.Pool, organizationId: string, items: readonly CaseListItem[]): Promise<CaseListItem[]> {
  if (!items.length) return []
  const rows = await pool.query<{ case_id: string; automatic: unknown }>(`SELECT case_id,reviewed_fields->'automatic' AS automatic FROM eksist_sources WHERE organization_id=$1 AND case_id=ANY($2::uuid[]) AND reviewed_fields ? 'automatic'`, [organizationId, items.map(item => item.id)])
  const byCase = new Map(rows.rows.map(row => [row.case_id, eksistCaseDataSchema.parse(row.automatic)]))
  return items.map(item => { const eksist = byCase.get(item.id); return eksist ? { ...item, eksist } : item })
}
