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
          'SELECT 1 FROM insurers WHERE organization_id=$1 AND id::text=$2 AND is_active=true',
          [organizationId, query.insurerId],
        )
        if (insurer.rowCount === 0) return undefined
      }
      const result = await pool.query(
        `SELECT id FROM service_centers WHERE organization_id = $1 AND is_active = true ORDER BY name, id`,
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
      return servicesReferenceResponseSchema.parse({
        items: contexts.flatMap((item) => {
          const profile = profiles.get(item.key)
          return profile === undefined ? [] : [profile]
        }),
      })
    },

    async users(organizationId: string): Promise<UsersReferenceResponse> {
      const result = await pool.query(
        `SELECT id, display_name AS "displayName"
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
