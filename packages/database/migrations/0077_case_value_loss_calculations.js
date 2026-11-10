export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('case_value_loss_calculations', {
    organization_id: { type: 'uuid', notNull: true },
    case_id: { type: 'uuid', notNull: true },
    input: { type: 'jsonb', notNull: true },
    result: { type: 'jsonb', notNull: true },
    updated_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_value_loss_calculations', 'case_value_loss_calculations_pk', { primaryKey: ['organization_id', 'case_id'] })
  pgm.addConstraint('case_value_loss_calculations', 'case_value_loss_calculations_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('case_value_loss_calculations', 'case_value_loss_calculations_result_valid', {
    check: "jsonb_typeof(input)='object' AND jsonb_typeof(result)='object' AND jsonb_typeof(result->'amountMinor')='number' AND (result->>'amountMinor')::numeric >= 0 AND result->'issues'='[]'::jsonb",
  })
}

export function down(pgm) {
  pgm.dropTable('case_value_loss_calculations')
}
