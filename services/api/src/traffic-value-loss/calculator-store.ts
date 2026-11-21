import type pg from 'pg'
import { valueLossCalculatorSavedSchema, type ValueLossCalculatorSaved, type ValueLossCalculatorRequest, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'

/** Estimates are saved separately from human-approved assessments and reports. */
export function createValueLossCalculatorStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async load(organizationId: string, caseId: string): Promise<ValueLossCalculatorSaved | null> {
      const row = (await pool.query<{ input: unknown; result: ValueLossCalculatorResponse; breakdown: unknown; updated_at: Date }>(
        `SELECT input,result,updated_at,
         CASE WHEN result_breakdown_updated_at=updated_at THEN result_breakdown END AS breakdown
         FROM case_value_loss_calculations WHERE organization_id=$1 AND case_id=$2`, [organizationId, caseId],
      )).rows[0]
      return row ? valueLossCalculatorSavedSchema.parse({ input: row.input, result: row.breakdown === null ? row.result : { ...row.result, breakdown: row.breakdown }, savedAt: row.updated_at.toISOString() }) : null
    },
    async save(actor: { organizationId: string; actorUserId: string; requestId: string }, caseId: string, input: ValueLossCalculatorRequest, result: ValueLossCalculatorResponse) {
      if (result.amountMinor === null || result.issues.length > 0) throw new Error('Cannot save an incomplete estimate')
      const { breakdown, ...legacyResult } = result
      await withTransaction(pool, async client => {
        await client.query(
          `WITH saved AS (SELECT clock_timestamp() AS at)
           INSERT INTO case_value_loss_calculations (organization_id,case_id,input,result,updated_by_user_id,result_breakdown,updated_at,result_breakdown_updated_at)
           SELECT $1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,at,at FROM saved
           ON CONFLICT (organization_id,case_id) DO UPDATE
           SET input=excluded.input,result=excluded.result,updated_by_user_id=excluded.updated_by_user_id,
           result_breakdown=excluded.result_breakdown,updated_at=excluded.updated_at,result_breakdown_updated_at=excluded.result_breakdown_updated_at`,
          [actor.organizationId, caseId, JSON.stringify(input), JSON.stringify(legacyResult), actor.actorUserId, breakdown === undefined ? null : JSON.stringify(breakdown)],
        )
        await audit.record(client, { ...actor, action: 'case.value_loss_calculated', entityType: 'case', entityId: caseId, details: { amountMinor: result.amountMinor, ruleVersion: result.ruleVersion } })
      })
    },
  }
}
