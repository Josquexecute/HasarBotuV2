import type pg from 'pg'
import {
  expertsReferenceResponseSchema,
  insurersReferenceResponseSchema,
  servicesReferenceResponseSchema,
  usersReferenceResponseSchema,
  type ExpertsReferenceResponse,
  type InsurersReferenceResponse,
  type ServicesReferenceResponse,
  type ServicesReferenceQuery,
  type UsersReferenceResponse,
} from '@hasarbotu/contracts'
import { loadServiceProfiles } from '../service-agreements/service.js'

/** Organization-kapsamli, yalniz aktif katalog sorgulari. */
export function createReferenceStore(pool: pg.Pool) {
  return {
    async insurers(organizationId: string): Promise<InsurersReferenceResponse> {
      const result = await pool.query(
        'SELECT id, name FROM insurers WHERE organization_id = $1 AND is_active = true ORDER BY name, id',
        [organizationId],
      )
      return insurersReferenceResponseSchema.parse({ items: result.rows })
    },

    async services(organizationId: string, query: ServicesReferenceQuery): Promise<ServicesReferenceResponse | undefined> {
      if (query.insurerId !== undefined) {
        const insurer = await pool.query(
          'SELECT 1 FROM insurers WHERE organization_id=$1 AND id::text=$2',
          [organizationId, query.insurerId],
        )
        if (insurer.rowCount === 0) return undefined
      }
      const result = await pool.query(
        `SELECT id,phone FROM service_centers WHERE organization_id = $1 AND is_active = true ORDER BY name, id`,
        [organizationId],
      )
      const contexts = (result.rows as Array<{ id: string }>).map((row) => ({
        key: row.id,
        serviceId: row.id,
        insurerId: query.insurerId ?? null,
        evaluationDate: query.evaluationDate ?? null,
        dateSource: query.dateSource,
        operation: query.operation,
      }))
      const profiles = await loadServiceProfiles(pool, organizationId, contexts)
      // A case contact is an address source only while it belongs to that service.
      // Conflicting branches/edits remain unresolved instead of borrowing an address.
      const addresses = query.includeAddresses === 'true' ? await pool.query<{ id: string; address: string | null }>(`SELECT sc.service_center_id AS id,
        CASE WHEN count(DISTINCT btrim(sc.address))=1 THEN min(btrim(sc.address)) ELSE NULL END AS address
        FROM case_service_contacts sc JOIN cases c ON c.organization_id=sc.organization_id AND c.id=sc.case_id
          AND c.service_center_id=sc.service_center_id WHERE sc.organization_id=$1 AND sc.service_center_id=ANY($2::uuid[])
          AND NOT c.is_archived AND nullif(btrim(sc.address),'') IS NOT NULL GROUP BY sc.service_center_id`, [organizationId, contexts.map(item => item.serviceId)]) : undefined
      const addressById = new Map(addresses?.rows.map(row => [row.id, row.address]))
      return servicesReferenceResponseSchema.parse({
        items: contexts.flatMap((item) => {
          const profile = profiles.get(item.key)
          return profile === undefined ? [] : [{ ...profile, ...(query.includeContacts === 'true' ? { phone: result.rows.find(row => row.id === item.key)?.phone ?? null } : {}),
            ...(query.includeAddresses === 'true' ? { address: addressById.get(item.key) ?? null } : {}) }]
        }),
      })
    },

    async users(organizationId: string,includeRoles = false): Promise<UsersReferenceResponse> {
      const result = await pool.query(
        `SELECT id, display_name AS "displayName"${includeRoles ? ', ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=users.id ORDER BY r.code) AS roles' : ''}
         FROM users WHERE organization_id = $1 AND status = 'active' ORDER BY display_name, id`,
        [organizationId],
      )
      return usersReferenceResponseSchema.parse({ items: result.rows })
    },

    async experts(organizationId: string): Promise<ExpertsReferenceResponse> {
      const result = await pool.query(
        `SELECT DISTINCT u.id, u.display_name AS "displayName"
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.organization_id = $1 AND u.status = 'active' AND r.code = 'expert'
         ORDER BY "displayName", u.id`,
        [organizationId],
      )
      return expertsReferenceResponseSchema.parse({ items: result.rows })
    },
  }
}

export type ReferenceStore = ReturnType<typeof createReferenceStore>
