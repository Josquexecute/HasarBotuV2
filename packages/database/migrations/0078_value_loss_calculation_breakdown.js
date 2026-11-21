export const shorthands = undefined

export function up(pgm) {
  pgm.addColumns('case_value_loss_calculations', {
    result_breakdown: { type: 'jsonb' },
    result_breakdown_updated_at: { type: 'timestamptz' },
  })
  // Keep the persisted result readable by the strict pre-0.1.100 API.
  // Move existing candidate details atomically, without changing inputs, amounts or timestamps.
  pgm.sql(`UPDATE case_value_loss_calculations
    SET result_breakdown=result->'breakdown',result_breakdown_updated_at=updated_at,result=result-'breakdown'
    WHERE result ? 'breakdown'`)
}

export function down() {
  throw new Error('Calculation details must be retained. Roll back API binaries while keeping migration 0078 applied.')
}
