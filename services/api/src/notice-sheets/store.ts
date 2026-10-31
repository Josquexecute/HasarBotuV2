import type pg from 'pg'
import { buildNoticeSheetDefaults, eksistKey, NOTICE_SHEET_HEADER_LIMITS, NOTICE_SHEET_V3_FIELDS } from '@hasarbotu/domain'
import { noticeSheetResponseSchema, noticeSheetOverridesSchema, type NoticeSheetResponse, type NoticeSheetSaveRequest } from '@hasarbotu/contracts'
import { withTransaction, type Queryable } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'

interface Actor { organizationId: string; userId: string; requestId: string }
export class NoticeSheetError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'version_conflict', readonly status: number) {
    super(code)
    this.name = 'NoticeSheetError'
  }
}

async function loadCase(exec: Queryable, organizationId: string, caseId: string, lock = false) {
  const result = await exec.query<{
    case_type: 'traffic' | 'casco' | null; lifecycle_status: string; plate: string
    office_number: string; insurer_claim_number: string | null; notification_form_number: string | null
    notification_date: string | null; loss_date: string | null; closure_date: string | null
    organization_name: string; insurer_name: string | null; expert_name: string | null
    service_center_id: string | null; service_name: string | null; service_phone: string | null
    contact_name: string | null; contact_phone: string | null; contact_address: string | null
  }>(`SELECT c.case_type,c.lifecycle_status,c.plate,c.office_number,c.insurer_claim_number,c.notification_form_number,
      c.notification_date::text,c.loss_date::text,(c.closed_at AT TIME ZONE 'Europe/Istanbul')::date::text AS closure_date,
      o.name AS organization_name,i.name AS insurer_name,u.display_name AS expert_name,
      c.service_center_id,s.name AS service_name,s.phone AS service_phone,
      sc.name AS contact_name,sc.phone AS contact_phone,sc.address AS contact_address
    FROM cases c JOIN organizations o ON o.id=c.organization_id
    LEFT JOIN insurers i ON i.id=c.insurer_id AND i.organization_id=c.organization_id
    LEFT JOIN users u ON u.id=c.expert_user_id AND u.organization_id=c.organization_id
    LEFT JOIN service_centers s ON s.id=c.service_center_id AND s.organization_id=c.organization_id
    LEFT JOIN case_service_contacts sc ON sc.organization_id=c.organization_id AND sc.case_id=c.id
      AND sc.service_center_id IS NOT DISTINCT FROM c.service_center_id
    WHERE c.organization_id=$1 AND c.id=$2 AND NOT c.is_archived${lock ? ' FOR UPDATE OF c' : ''}`,
  [organizationId, caseId])
  const row = result.rows[0]
  if (!row) throw new NoticeSheetError('not_found', 404)
  return row
}

export function createNoticeSheetStore(pool: pg.Pool) {
  const audit = createAuditService()
  async function read(exec: Queryable, actor: Actor, caseId: string, canEdit: boolean): Promise<NoticeSheetResponse> {
    const row = await loadCase(exec, actor.organizationId, caseId)
    const parameters = [actor.organizationId, caseId]
    // Both callers use one transaction connection; queries cannot overlap.
    const [saved, source, vehicle, owners, policies, documents] = [
      await exec.query('SELECT overrides,service_context,version,updated_at FROM case_notice_sheets WHERE organization_id=$1 AND case_id=$2', parameters),
      await exec.query(`SELECT raw_text,reviewed_fields FROM eksist_sources WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, parameters),
      await exec.query(`SELECT v.brand,v.model,v.model_year FROM case_vehicle_profiles p
        JOIN case_vehicle_profile_versions v ON v.id=p.current_version_id AND v.organization_id=p.organization_id
        WHERE p.organization_id=$1 AND p.case_id=$2`, parameters),
      await exec.query(`SELECT v.name FROM case_vehicle_owner_sets s JOIN case_vehicle_owners v
        ON v.organization_id=s.organization_id AND v.case_id=s.case_id AND v.set_version=s.current_set_version
        WHERE s.organization_id=$1 AND s.case_id=$2 ORDER BY v.ordinal`, parameters),
      await exec.query(`SELECT v.policy_start_date::text,v.policy_end_date::text FROM policy_analyses a
        JOIN policy_analysis_versions v ON v.id=a.current_version_id AND v.organization_id=a.organization_id
        WHERE a.organization_id=$1 AND a.case_id=$2 AND v.analysis_status='approved'
        AND v.human_approval_status='approved' AND v.is_active=true`, parameters),
      await exec.query(`SELECT d.document_type FROM documents d JOIN document_versions v
        ON v.id=d.current_version_id AND v.organization_id=d.organization_id AND v.case_id=d.case_id
        WHERE d.organization_id=$1 AND d.case_id=$2 AND d.status='ready' AND v.status='ready'
        AND v.hash_verified AND v.size_verified AND v.verified_at IS NOT NULL`, parameters),
    ]
    const sourceRow = source.rows[0]
    const profile = vehicle.rows[0]
    const sheet = saved.rows[0]
    const date = (value: string) => value.split('-').reverse().join('.')
    const defaults = buildNoticeSheetDefaults({
      caseFields: {
        organizationName: row.organization_name, officeNumber: row.office_number,
        claimNumber: row.insurer_claim_number ?? '', noticeNumber: row.notification_form_number ?? '',
        insurerName: row.insurer_name ?? sourceRow?.reviewed_fields?.automatic?.insurerName ?? '',
        plate: row.plate, notificationDate: row.notification_date ?? '', lossDate: row.loss_date ?? '',
        closureDate: row.lifecycle_status === 'closed' ? row.closure_date ?? '' : '',
        expertName: row.expert_name ?? sourceRow?.reviewed_fields?.automatic?.expertName ?? '',
      },
      caseType: row.case_type, plate: row.plate,
      serviceName: row.service_name ?? sourceRow?.reviewed_fields?.automatic?.serviceName ?? null, servicePhone: row.service_phone,
      eksistText: sourceRow?.raw_text ?? null,
      eksistServiceRevised: sourceRow?.reviewed_fields?.automatic?.serviceRevised === true,
      vehicleDescription: profile ? [profile.brand, profile.model, profile.model_year].join(' · ') : null,
      ownerNames: owners.rows.map(owner => String(owner.name)),
      approvedPolicyPeriods: policies.rows.flatMap(policy => policy.policy_start_date && policy.policy_end_date
        ? [`${date(policy.policy_start_date)} – ${date(policy.policy_end_date)}`] : []),
      readyDocumentTypes: documents.rows.map(document => String(document.document_type)),
    })
    if (row.contact_name) Object.assign(defaults.fields, { serviceName: row.contact_name, servicePhone: row.contact_phone ?? '', serviceAddress: row.contact_address ?? '' })
    const overrides = noticeSheetOverridesSchema.parse(sheet?.overrides ?? { fields: {}, documents: {} })
    const context = sheet?.service_context as { id: string | null; name: string } | null | undefined
    if (context && (context.id !== row.service_center_id || context.id === null && eksistKey(context.name) !== eksistKey(defaults.fields.serviceName))) {
      for (const key of ['serviceName', 'serviceContact', 'servicePhone', 'serviceAddress'] as const) delete overrides.fields[key]
    }
    return noticeSheetResponseSchema.parse({
      caseId, caseType: row.case_type, organizationName: row.organization_name,
      officeNumber: row.office_number, claimNumber: row.insurer_claim_number, noticeNumber: row.notification_form_number,
      insurerName: row.insurer_name ?? sourceRow?.reviewed_fields?.automatic?.insurerName ?? null,
      plate: row.plate, notificationDate: row.notification_date, lossDate: row.loss_date,
      closureDate: row.lifecycle_status === 'closed' ? row.closure_date : null,
      expertName: row.expert_name ?? sourceRow?.reviewed_fields?.automatic?.expertName ?? null,
      version: sheet?.version ?? null, updatedAt: sheet?.updated_at.toISOString() ?? null,
      defaults,
      overrides,
      permissions: { canEdit: canEdit && row.lifecycle_status === 'open' && row.case_type !== null },
    })
  }
  return {
    read(actor: Actor, caseId: string, canEdit: boolean): Promise<NoticeSheetResponse> {
      return withTransaction(pool, async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return read(client, actor, caseId, canEdit)
      })
    },
    save(actor: Actor, caseId: string, input: NoticeSheetSaveRequest, includeHeaderFields = true, includeVehicleFields = true): Promise<NoticeSheetResponse> {
      return withTransaction(pool, async client => {
        const row = await loadCase(client, actor.organizationId, caseId, true)
        if (row.lifecycle_status === 'closed' || row.case_type === null) throw new NoticeSheetError('conflict', 409)
        const existing = await client.query('SELECT version,overrides FROM case_notice_sheets WHERE organization_id=$1 AND case_id=$2', [actor.organizationId, caseId])
        const version = existing.rows[0]?.version ?? null
        if (version !== input.expectedVersion) throw new NoticeSheetError('version_conflict', 409)
        const overrides = noticeSheetOverridesSchema.parse(input.overrides)
        const previous = noticeSheetOverridesSchema.parse(existing.rows[0]?.overrides ?? { fields: {}, documents: {} })
        // Older clients cannot see new fields; hiding retired notes must not erase them.
        const hiddenFields = Object.keys(previous.fields).filter(key => row.case_type === 'casco' ? key.startsWith('victim') : key === 'insuredDamageHistory') as (keyof typeof previous.fields)[]
        for (const key of ['inspectionNotes', ...hiddenFields, ...(!includeVehicleFields ? NOTICE_SHEET_V3_FIELDS : [])] as const) {
          if (!Object.hasOwn(overrides.fields, key) && Object.hasOwn(previous.fields, key)) overrides.fields[key] = previous.fields[key]!
        }
        if (row.case_type === 'casco') {
          for (const key of ['victimLicense', 'victimRegistration'] as const) {
            if (!Object.hasOwn(overrides.documents, key) && Object.hasOwn(previous.documents, key)) overrides.documents[key] = previous.documents[key]!
          }
        }
        if (!includeHeaderFields) {
          overrides.fields = { ...Object.fromEntries(Object.entries(previous.fields).filter(([key]) => Object.hasOwn(NOTICE_SHEET_HEADER_LIMITS,key))), ...overrides.fields }
        }
        const current = await read(client, actor, caseId, true)
        const serviceContext = { id: row.service_center_id, name: current.defaults.fields.serviceName }
        const nextVersion = (version ?? 0) + 1
        await client.query(`INSERT INTO case_notice_sheets(organization_id,case_id,overrides,version,updated_by_user_id,service_context)
          VALUES($1,$2,$3::jsonb,$4,$5,$6::jsonb) ON CONFLICT(organization_id,case_id) DO UPDATE
          SET overrides=EXCLUDED.overrides,version=EXCLUDED.version,updated_by_user_id=EXCLUDED.updated_by_user_id,
          service_context=EXCLUDED.service_context,updated_at=now()`,
        [actor.organizationId, caseId, JSON.stringify(overrides), nextVersion, actor.userId, JSON.stringify(serviceContext)])
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.userId,
          requestId: actor.requestId, action: 'notice_sheet.saved', entityType: 'case', entityId: caseId,
          details: { version: nextVersion, fieldNames: Object.keys(overrides.fields), documentCodes: Object.keys(overrides.documents) },
        })
        return read(client, actor, caseId, true)
      })
    },
  }
}
