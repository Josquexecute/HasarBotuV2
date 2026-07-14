import type pg from 'pg'
import {
  evaluateServiceEligibility,
  type InsurerServiceAgreementFact,
  type ServiceSupportedOperation,
  type ServiceType,
} from '@hasarbotu/domain'
import { serviceReferenceSchema, type ServiceReference } from '@hasarbotu/contracts'

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>

interface ServiceContext {
  readonly key: string
  readonly serviceId: string
  readonly insurerId: string | null
  readonly evaluationDate: string | null
  readonly dateSource: 'loss_date' | 'policy_date'
  readonly operation: ServiceSupportedOperation
}

interface ServiceRow {
  id: string
  name: string
  service_type: ServiceType
  is_active: boolean
}

interface AgreementRow {
  id: string
  service_center_id: string
  insurer_id: string
  agreement_status: InsurerServiceAgreementFact['status']
  effective_from: Date | string
  effective_to: Date | string | null
  supported_operations: ServiceSupportedOperation[]
  human_approved: boolean
}

function localDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Bir sorgu grubundaki servis profillerini ve sigortaciya/tarihe ozel sonucunu tenant kapsaminda yukler. */
export async function loadServiceProfiles(
  exec: Queryable,
  organizationId: string,
  contexts: readonly ServiceContext[],
): Promise<ReadonlyMap<string, ServiceReference>> {
  if (contexts.length === 0) return new Map()
  const serviceIds = [...new Set(contexts.map((item) => item.serviceId))].sort()
  const [services, agreements] = await Promise.all([
    exec.query(
      `SELECT id,name,service_type,is_active FROM service_centers
       WHERE organization_id=$1 AND id = ANY($2::uuid[])`,
      [organizationId, serviceIds],
    ),
    exec.query(
      `SELECT id,service_center_id,insurer_id,agreement_status,effective_from,effective_to,
              supported_operations,human_approved
       FROM insurer_service_agreements
       WHERE organization_id=$1 AND service_center_id = ANY($2::uuid[])
       ORDER BY id`,
      [organizationId, serviceIds],
    ),
  ])
  const serviceById = new Map((services.rows as ServiceRow[]).map((row) => [row.id, row]))
  const agreementsByService = new Map<string, InsurerServiceAgreementFact[]>()
  for (const row of agreements.rows as AgreementRow[]) {
    const items = agreementsByService.get(row.service_center_id) ?? []
    items.push({
      id: row.id,
      insurerId: row.insurer_id,
      status: row.agreement_status,
      effectiveFrom: localDate(row.effective_from),
      effectiveTo: row.effective_to === null ? null : localDate(row.effective_to),
      supportedOperations: row.supported_operations,
      humanApproved: row.human_approved,
    })
    agreementsByService.set(row.service_center_id, items)
  }

  const result = new Map<string, ServiceReference>()
  for (const context of contexts) {
    const service = serviceById.get(context.serviceId)
    if (service === undefined) continue
    const agreement = evaluateServiceEligibility({
      serviceType: service.service_type,
      insurerId: context.insurerId,
      evaluationDate: context.evaluationDate,
      dateSource: context.dateSource,
      operation: context.operation,
      agreements: agreementsByService.get(service.id) ?? [],
    })
    result.set(context.key, serviceReferenceSchema.parse({
      id: service.id,
      name: service.name,
      serviceType: service.service_type,
      isActive: service.is_active,
      agreement,
    }))
  }
  return result
}

export async function loadServiceProfile(
  exec: Queryable,
  organizationId: string,
  input: Omit<ServiceContext, 'key'>,
): Promise<ServiceReference | null> {
  const profiles = await loadServiceProfiles(exec, organizationId, [{ key: input.serviceId, ...input }])
  return profiles.get(input.serviceId) ?? null
}
