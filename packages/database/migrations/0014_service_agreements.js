/**
 * Paket 22 - servis profili ile sigortaciya ozel, tarihsel anlasma kaydini ayirir.
 * Eski `center_type` expand/migrate uyumlulugu icin korunur; kaynak dogruluk
 * `service_type` alanidir. Mevcut servisler icin anlasma satiri uretilmez.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.addColumns('service_centers', {
    service_type: { type: 'text' },
  })
  pgm.sql(`UPDATE service_centers
    SET service_type = CASE center_type WHEN 'yetkili' THEN 'authorized' ELSE 'private' END
    WHERE service_type IS NULL`)
  pgm.alterColumn('service_centers', 'service_type', { notNull: true })
  pgm.addConstraint('service_centers', 'service_centers_service_type_valid', {
    check: "service_type IN ('authorized','private','glass','mobile','other')",
  })
  pgm.addConstraint('service_centers', 'service_centers_legacy_type_consistent', {
    check: "(service_type='authorized' AND center_type='yetkili') OR (service_type<>'authorized' AND center_type='ozel')",
  })
  pgm.addConstraint('service_centers', 'service_centers_org_id_unique', {
    unique: ['organization_id', 'id'],
  })
  pgm.addConstraint('insurers', 'insurers_org_id_unique', {
    unique: ['organization_id', 'id'],
  })
  pgm.addConstraint('users', 'users_org_id_unique', {
    unique: ['organization_id', 'id'],
  })

  pgm.createTable('insurer_service_agreements', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    insurer_id: { type: 'uuid', notNull: true },
    service_center_id: { type: 'uuid', notNull: true },
    agreement_status: { type: 'text', notNull: true },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    supported_operations: { type: 'text[]', notNull: true },
    source_reference: { type: 'text', notNull: true },
    human_approved: { type: 'boolean', notNull: true, default: false },
    approved_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    approved_at: { type: 'timestamptz' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_insurer_tenant_fk', {
    foreignKeys: {
      columns: ['organization_id', 'insurer_id'],
      references: 'insurers (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_service_tenant_fk', {
    foreignKeys: {
      columns: ['organization_id', 'service_center_id'],
      references: 'service_centers (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_approver_tenant_fk', {
    foreignKeys: {
      columns: ['organization_id', 'approved_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_status_valid', {
    check: "agreement_status IN ('active','inactive','pending','terminated')",
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_dates_valid', {
    check: 'effective_to IS NULL OR effective_to >= effective_from',
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_operations_valid', {
    check: `cardinality(supported_operations) >= 1 AND supported_operations <@ ARRAY[
      'closure_documents','deductible_assessment','policy_assessment','repair_authorization'
    ]::text[]`,
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_source_safe', {
    check: "length(source_reference) BETWEEN 1 AND 300 AND source_reference ~ '[^[:space:]]' AND source_reference !~ '[[:cntrl:]]'",
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_approval_consistent', {
    check: `(human_approved = false AND approved_by_user_id IS NULL AND approved_at IS NULL)
      OR (human_approved = true AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)`,
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_version_positive', {
    check: 'version >= 1',
  })
  pgm.addConstraint('insurer_service_agreements', 'insurer_service_agreements_period_unique', {
    unique: ['organization_id', 'insurer_id', 'service_center_id', 'effective_from', 'source_reference'],
  })
  pgm.createIndex('insurer_service_agreements', ['organization_id', 'insurer_id', 'service_center_id'])
  pgm.createIndex('insurer_service_agreements', ['organization_id', 'effective_from', 'effective_to'])
  pgm.createIndex('insurer_service_agreements', ['organization_id', 'agreement_status'])
  pgm.sql(`UPDATE case_lifecycle_operations
    SET requirement_snapshot = requirement_snapshot || '{"serviceEligibility":null}'::jsonb
    WHERE NOT (requirement_snapshot ? 'serviceEligibility')`)
  pgm.sql(`UPDATE case_lifecycle_history
    SET requirement_snapshot = requirement_snapshot || '{"serviceEligibility":null}'::jsonb
    WHERE NOT (requirement_snapshot ? 'serviceEligibility')`)
}

export function down(pgm) {
  pgm.sql("UPDATE case_lifecycle_history SET requirement_snapshot = requirement_snapshot - 'serviceEligibility'")
  pgm.sql("UPDATE case_lifecycle_operations SET requirement_snapshot = requirement_snapshot - 'serviceEligibility'")
  pgm.dropTable('insurer_service_agreements')
  pgm.dropConstraint('users', 'users_org_id_unique')
  pgm.dropConstraint('insurers', 'insurers_org_id_unique')
  pgm.dropConstraint('service_centers', 'service_centers_org_id_unique')
  pgm.dropConstraint('service_centers', 'service_centers_legacy_type_consistent')
  pgm.dropConstraint('service_centers', 'service_centers_service_type_valid')
  pgm.dropColumns('service_centers', ['service_type'])
}
