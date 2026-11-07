export const shorthands = undefined

export function up(pgm) {
  // Additive table: old case DTOs, writes and recourse_status remain unchanged.
  pgm.createTable('case_fault_ratios', {
    organization_id: { type: 'uuid', notNull: true },
    case_id: { type: 'uuid', notNull: true },
    insured_percent: { type: 'smallint' },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_fault_ratios', 'case_fault_ratios_pk', { primaryKey: ['organization_id', 'case_id'] })
  pgm.addConstraint('case_fault_ratios', 'case_fault_ratios_case_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('case_fault_ratios', 'case_fault_ratios_percentage_valid', { check: 'insured_percent IS NULL OR insured_percent IN (0,25,50,75,100)' })
  pgm.addConstraint('case_fault_ratios', 'case_fault_ratios_version_positive', { check: 'version >= 1' })
}

export function down(pgm) {
  pgm.dropTable('case_fault_ratios')
}
