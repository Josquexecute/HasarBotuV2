/**
 * Paket 20 — Case çalışma klasörü taşıma/yeniden adlandırma saga kaydı.
 *
 * Bu tablo ikinci bir kuyruk değildir. Uzun süren DB/filesystem işleminin
 * hedef rezervasyonunu, optimistic snapshot'ını ve recovery/cleanup durumunu
 * tutar; fiziksel yürütme mevcut `jobs` kuyruğu üzerinden yapılır. Mutlak yol
 * kolonu yoktur.
 */
export const shorthands = undefined

const SAFE_RELATIVE_PATH_CHECK = `
  %s <> ''
  AND left(%s, 1) <> '/'
  AND %s !~ '^[A-Za-z]:'
  AND %s !~ '(^|/)[.][.](/|$)'
  AND %s !~ '[<>:"|?*]'
  AND %s !~ '[[:cntrl:]]'
  AND strpos(%s, chr(92)) = 0
`

function safePath(column) {
  return SAFE_RELATIVE_PATH_CHECK.replaceAll('%s', column)
}

export function up(pgm) {
  pgm.addColumn('case_location_history', {
    previous_storage_root_key: { type: 'text' },
  })

  pgm.createTable('case_file_operations', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'RESTRICT' },
    operation_type: { type: 'text', notNull: true },
    source_storage_root_key: { type: 'text', notNull: true },
    source_relative_path: { type: 'text', notNull: true },
    destination_storage_root_key: { type: 'text', notNull: true },
    destination_relative_path: { type: 'text', notNull: true },
    expected_location_id: { type: 'uuid', notNull: true, references: 'case_locations', onDelete: 'RESTRICT' },
    expected_location_version: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true, default: 'planned' },
    strategy: { type: 'text', notNull: true },
    idempotency_key_hash: { type: 'text', notNull: true },
    request_hash: { type: 'text', notNull: true },
    manifest_hash: { type: 'text' },
    file_count: { type: 'integer' },
    directory_count: { type: 'integer' },
    total_bytes: { type: 'bigint' },
    active_job_id: { type: 'uuid' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    recovery_count: { type: 'integer', notNull: true, default: 0 },
    cleanup_state: { type: 'text', notNull: true, default: 'not_required' },
    failure_reason_code: { type: 'text' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    approved_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    cancelled_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    approved_at: { type: 'timestamptz' },
    finalized_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })

  pgm.addConstraint('case_file_operations', 'case_file_operations_type_valid', {
    check: "operation_type IN ('rename_case_workspace','move_case_workspace')",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_status_valid', {
    check: "status IN ('planned','approved','queued','applying','verifying','switching_location','cleanup_pending','ready','failed','stale','cancelled','manual_recovery_required')",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_strategy_valid', {
    check: "strategy IN ('atomic_rename','staged_copy')",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_cleanup_valid', {
    check: "cleanup_state IN ('not_required','pending','completed','blocked')",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_versions_positive', {
    check: 'expected_location_version >= 1 AND version >= 1 AND attempt_count >= 0 AND recovery_count >= 0',
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_hash_format', {
    check: "idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$' AND (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$')",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_failure_code_safe', {
    check: "failure_reason_code IS NULL OR failure_reason_code ~ '^[a-z0-9_]{1,64}$'",
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_manifest_summary_consistent', {
    check: `
      (manifest_hash IS NULL AND file_count IS NULL AND directory_count IS NULL AND total_bytes IS NULL)
      OR
      (manifest_hash IS NOT NULL AND file_count >= 0 AND directory_count >= 0 AND total_bytes >= 0)
    `,
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_source_path_safe', {
    check: safePath('source_relative_path'),
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_destination_path_safe', {
    check: safePath('destination_relative_path'),
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_source_root_fk', {
    foreignKeys: {
      columns: ['organization_id', 'source_storage_root_key'],
      references: 'storage_roots (organization_id, root_key)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_destination_root_fk', {
    foreignKeys: {
      columns: ['organization_id', 'destination_storage_root_key'],
      references: 'storage_roots (organization_id, root_key)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('case_file_operations', 'case_file_operations_idempotency_unique', {
    unique: ['organization_id', 'idempotency_key_hash'],
  })

  pgm.sql(`CREATE UNIQUE INDEX case_locations_path_ci_unique
    ON case_locations (organization_id, storage_root_key, lower(relative_path))`)
  pgm.sql(`CREATE UNIQUE INDEX case_file_operations_one_active_case
    ON case_file_operations (organization_id, case_id)
    WHERE status NOT IN ('ready','stale','cancelled')`)
  pgm.sql(`CREATE UNIQUE INDEX case_file_operations_destination_reservation
    ON case_file_operations (organization_id, destination_storage_root_key, lower(destination_relative_path))
    WHERE status NOT IN ('ready','stale','cancelled')`)
  pgm.createIndex('case_file_operations', ['organization_id', 'status', 'updated_at'])

  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_status_valid')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_payload_no_absolute_path')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace','rename_case_workspace','move_case_workspace','cleanup_moved_workspace')",
  })
  pgm.addConstraint('jobs', 'jobs_status_valid', {
    check: "status IN ('pending','leased','succeeded','failed','dead_letter','cancelled')",
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: "target_type IN ('document_version','photo','case_location','workspace_provisioning','file_operation')",
  })
  pgm.addConstraint('jobs', 'jobs_payload_no_absolute_path', {
    check: `payload::text !~ '[A-Za-z]:'
      AND strpos(payload::text, chr(92)) = 0
      AND COALESCE(payload->>'relativePath','') !~ '(^|/)[.][.](/|$)'
      AND COALESCE(payload#>>'{source,relativePath}','') !~ '(^|/)[.][.](/|$)'
      AND COALESCE(payload#>>'{destination,relativePath}','') !~ '(^|/)[.][.](/|$)'
      AND COALESCE(payload->>'stagingRelativePath','') !~ '(^|/)[.][.](/|$)'
      AND COALESCE(payload->>'temporaryRelativePath','') !~ '(^|/)[.][.](/|$)'
      AND left(COALESCE(payload#>>'{source,relativePath}',''),1) <> '/'
      AND left(COALESCE(payload#>>'{destination,relativePath}',''),1) <> '/'
      AND left(COALESCE(payload->>'stagingRelativePath',''),1) <> '/'
      AND left(COALESCE(payload->>'temporaryRelativePath',''),1) <> '/'`,
  })
  pgm.sql(`CREATE UNIQUE INDEX jobs_one_active_file_operation_job
    ON jobs (organization_id, target_type, target_id)
    WHERE target_type = 'file_operation' AND status IN ('pending','leased')`)
  pgm.addConstraint('case_file_operations', 'case_file_operations_active_job_fk', {
    foreignKeys: { columns: 'active_job_id', references: 'jobs(id)', onDelete: 'SET NULL' },
  })
}

export function down(pgm) {
  // Yalnız geliştirme/test ortamı içindir.
  pgm.dropConstraint('case_file_operations', 'case_file_operations_active_job_fk')
  pgm.sql('DROP INDEX jobs_one_active_file_operation_job')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_status_valid')
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_payload_no_absolute_path')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace')",
  })
  pgm.addConstraint('jobs', 'jobs_status_valid', {
    check: "status IN ('pending','leased','succeeded','failed','dead_letter')",
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: "target_type IN ('document_version','photo','case_location','workspace_provisioning')",
  })
  pgm.addConstraint('jobs', 'jobs_payload_no_absolute_path', {
    check: `payload::text !~ '[A-Za-z]:'
      AND strpos(payload::text, chr(92)) = 0
      AND (payload->>'relativePath') !~ '(^|/)[.][.](/|$)'`,
  })
  pgm.dropTable('case_file_operations')
  pgm.sql('DROP INDEX case_locations_path_ci_unique')
  pgm.dropColumn('case_location_history', 'previous_storage_root_key')
}
