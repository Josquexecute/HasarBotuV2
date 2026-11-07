import type pg from 'pg'
import { caseFaultResponseSchema, type CaseFaultResponse, type CaseFaultSaveRequest } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'

interface Actor { organizationId: string; userId: string; requestId: string }
interface FaultRow {
  case_type: 'traffic' | 'casco' | null
  lifecycle_status: 'open' | 'closed'
  insured_percent: number | null
  version: number
  updated_at: Date | null
}
export class CaseFaultError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'version_conflict', readonly status: number) {
    super(code)
  }
}

function toDto(caseId: string, row: FaultRow, canEdit: boolean): CaseFaultResponse {
  return caseFaultResponseSchema.parse({
    caseId, caseType: row.case_type, insuredPercent: row.insured_percent,
    version: row.version, updatedAt: row.updated_at?.toISOString() ?? null,
    permissions: { canEdit: canEdit && row.lifecycle_status === 'open' && row.case_type !== null },
  })
}

export function createCaseFaultStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async read(organizationId: string, caseId: string, canEdit: boolean): Promise<CaseFaultResponse> {
      const result = await pool.query<FaultRow>(
        `SELECT c.case_type,c.lifecycle_status,f.insured_percent,coalesce(f.version,0) AS version,f.updated_at
         FROM cases c LEFT JOIN case_fault_ratios f ON f.organization_id=c.organization_id AND f.case_id=c.id
         WHERE c.organization_id=$1 AND c.id=$2`, [organizationId, caseId],
      )
      if (!result.rows[0]) throw new CaseFaultError('not_found', 404)
      return toDto(caseId, result.rows[0], canEdit)
    },
    async save(actor: Actor, caseId: string, input: CaseFaultSaveRequest): Promise<CaseFaultResponse> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Share the case lock with classification/closure; also serialize first writes.
        const result = await client.query<Pick<FaultRow, 'case_type' | 'lifecycle_status'>>(
          'SELECT case_type,lifecycle_status FROM cases WHERE organization_id=$1 AND id=$2 FOR UPDATE', [actor.organizationId, caseId],
        )
        const row = result.rows[0]
        if (!row) throw new CaseFaultError('not_found', 404)
        if (row.lifecycle_status !== 'open' || row.case_type === null) throw new CaseFaultError('conflict', 409)
        const previous = (await client.query<{ insured_percent: number | null; version: number }>(
          'SELECT insured_percent,version FROM case_fault_ratios WHERE organization_id=$1 AND case_id=$2', [actor.organizationId, caseId],
        )).rows[0]
        if ((previous?.version ?? 0) !== input.expectedVersion) throw new CaseFaultError('version_conflict', 409)
        const saved = (await client.query<Pick<FaultRow, 'insured_percent' | 'version' | 'updated_at'>>(
          `INSERT INTO case_fault_ratios (organization_id,case_id,insured_percent,version,updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,case_id) DO UPDATE
           SET insured_percent=excluded.insured_percent,version=excluded.version,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()
           RETURNING insured_percent,version,updated_at`,
          [actor.organizationId, caseId, input.insuredPercent, input.expectedVersion + 1, actor.userId],
        )).rows[0]!
        await audit.record(client, {
          organizationId: actor.organizationId, actorUserId: actor.userId, requestId: actor.requestId,
          action: 'case.fault_updated', entityType: 'case', entityId: caseId,
          details: { previousInsuredPercent: previous?.insured_percent ?? null, insuredPercent: input.insuredPercent, version: saved.version },
        })
        const dto = toDto(caseId, { ...row, ...saved }, true)
        await client.query('COMMIT')
        return dto
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}
