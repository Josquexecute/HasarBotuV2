/**
 * Paket 39 — kullanıcı kontrollü kapanma ücreti sürümleri ve raporlama read modeli.
 *
 * Aday/onay/düzeltme sürümleri append-only'dir. Yalnız doğrulanmış nihai
 * ekspertiz raporu API tarafından kaynak olarak kabul edilir. Tablolarda belge
 * içeriği, mutlak yol veya para için floating point alanı bulunmaz.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('fee_records', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    current_version_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('fee_records', 'fee_records_case_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id'],
      references: 'cases (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_records', 'fee_records_case_unique', {
    unique: ['organization_id', 'case_id'],
  })
  pgm.addConstraint('fee_records', 'fee_records_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('fee_records', 'fee_records_version_positive', {
    check: 'version >= 1',
  })

  pgm.createTable('fee_record_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    fee_record_id: { type: 'uuid', notNull: true },
    fee_version: { type: 'integer', notNull: true },
    previous_version_id: { type: 'uuid' },
    status: { type: 'text', notNull: true },
    candidate_amount_minor: { type: 'bigint', notNull: true },
    approved_amount_minor: { type: 'bigint' },
    currency: { type: 'text', notNull: true, default: 'TRY' },
    source_document_version_id: { type: 'uuid', notNull: true },
    source_page: { type: 'integer', notNull: true },
    source_type: { type: 'text', notNull: true, default: 'manual' },
    rule_version: { type: 'text', notNull: true },
    correction_reason: { type: 'text' },
    created_by_user_id: { type: 'uuid', notNull: true },
    approved_by_user_id: { type: 'uuid' },
    approved_at: { type: 'timestamptz' },
    request_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_record_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'fee_record_id'],
      references: 'fee_records (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_source_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'source_document_version_id'],
      references: 'document_versions (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_approver_fk', {
    foreignKeys: {
      columns: ['organization_id', 'approved_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_number_unique', {
    unique: ['fee_record_id', 'fee_version'],
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_previous_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'previous_version_id'],
      references: 'fee_record_versions (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_status_valid', {
    check: "status IN ('control_required','approved','corrected')",
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_amount_valid', {
    check: `candidate_amount_minor BETWEEN 1 AND 10000000000
      AND (approved_amount_minor IS NULL OR approved_amount_minor BETWEEN 1 AND 10000000000)`,
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_shape_valid', {
    check: `(status='control_required'
        AND approved_amount_minor IS NULL AND approved_by_user_id IS NULL
        AND approved_at IS NULL AND correction_reason IS NULL)
      OR (status='approved'
        AND approved_amount_minor IS NOT NULL AND approved_by_user_id IS NOT NULL
        AND approved_at IS NOT NULL AND correction_reason IS NULL)
      OR (status='corrected'
        AND approved_amount_minor IS NOT NULL AND approved_by_user_id IS NOT NULL
        AND approved_at IS NOT NULL AND correction_reason IS NOT NULL)`,
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_static_values', {
    check: "currency='TRY' AND source_type='manual' AND rule_version='closure-fee/1.0.0'",
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_page_version_valid', {
    check: 'source_page BETWEEN 1 AND 10000 AND fee_version >= 1',
  })
  pgm.addConstraint('fee_record_versions', 'fee_record_versions_reason_safe', {
    check: `correction_reason IS NULL OR (
      length(correction_reason) BETWEEN 3 AND 500
      AND correction_reason ~ '[^[:space:]]'
      AND correction_reason !~ '(^|[^A-Za-z])[A-Za-z]:[\\\\/]'
      AND correction_reason !~ '\\\\\\\\'
      AND correction_reason !~ '[[:cntrl:]]'
    )`,
  })
  pgm.createIndex('fee_record_versions', ['organization_id', 'case_id', 'created_at'])
  pgm.createIndex('fee_record_versions', ['organization_id', 'status', 'created_at'])

  pgm.addConstraint('fee_records', 'fee_records_current_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'current_version_id'],
      references: 'fee_record_versions (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })

  for (const suffix of ['no_update', 'no_delete']) {
    pgm.createTrigger('fee_record_versions', `fee_record_versions_${suffix}`, {
      when: 'BEFORE',
      operation: suffix === 'no_update' ? 'UPDATE' : 'DELETE',
      level: 'ROW',
      function: 'append_only_guard',
    })
  }
}

export function down(pgm) {
  pgm.dropConstraint('fee_records', 'fee_records_current_version_fk')
  pgm.dropTable('fee_record_versions')
  pgm.dropTable('fee_records')
}
