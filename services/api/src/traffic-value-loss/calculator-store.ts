import type pg from 'pg'
import { valueLossCalculatorSavedSchema, type ValueLossCalculatorSaved, type ValueLossCalculatorRequest, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'

/** Estimates are saved separately from human-approved assessments and reports. */
export function createValueLossCalculatorStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async load(organizationId: string, caseId: string): Promise<ValueLossCalculatorSaved | null> {
      const row = (await pool.query<{ input: unknown; result: unknown; updated_at: Date }>(
        'SELECT input,result,updated_at FROM case_value_loss_calculations WHERE organization_id=$1 AND case_id=$2', [organizationId, caseId],
      )).rows[0]
      return row ? valueLossCalculatorSavedSchema.parse({ input: row.input, result: row.result, savedAt: row.updated_at.toISOString() }) : null
    },
    async save(actor: { organizationId: string; actorUserId: string; requestId: string }, caseId: string, input: ValueLossCalculatorRequest, result: ValueLossCalculatorResponse) {
      if (result.amountMinor === null || result.issues.length > 0) throw new Error('Cannot save an incomplete estimate')
      await withTransaction(pool, async client => {
        await client.query(
          `INSERT INTO case_value_loss_calculations (organization_id,case_id,input,result,updated_by_user_id)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) ON CONFLICT (organization_id,case_id) DO UPDATE
           SET input=excluded.input,result=excluded.result,updated_by_user_id=excluded.updated_by_user_id,updated_at=clock_timestamp()`,
          [actor.organizationId, caseId, JSON.stringify(input), JSON.stringify(result), actor.actorUserId],
        )
        await audit.record(client, { ...actor, action: 'case.value_loss_calculated', entityType: 'case', entityId: caseId, details: { amountMinor: result.amountMinor, ruleVersion: result.ruleVersion } })
      })
    },
  }
}
