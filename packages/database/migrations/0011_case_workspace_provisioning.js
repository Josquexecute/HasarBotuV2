/**
 * Paket 19 — onaylı ve File Agent üzerinden yürüyen vaka çalışma klasörü
 * provisioning akışı. Mutlak yol kolonu yoktur; yalnız root_key + güvenli göreli
 * yol rezervasyonu saklanır.
 */
export const shorthands = undefined

const SAFE_RELATIVE_PATH_CHECK = `
  relative_path <> ''
  AND left(relative_path, 1) <> '/'
  AND relative_path !~ '^[A-Za-z]:'
  AND relative_path !~ '(^|/)[.][.](/|$)'
  AND relative_path !~ '[<>:"|?*]'
  AND relative_path !~ '[[:cntrl:]]'
  AND strpos(relative_path, chr(92)) = 0
`

export function up(pgm) {
  pgm.createTable('case_workspace_provisionings', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'planned' },
    expected_location_id: { type: 'uuid' },
    expected_location_version: { type: 'integer' },
    active_job_id: { type: 'uuid' },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    approved_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    approved_at: { type: 'timestamptz' },
    ready_at: { type: 'timestamptz' },
    last_error_code: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_case_unique', {
    unique: ['organization_id', 'case_id'],
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_path_unique', {
    unique: ['organization_id', 'storage_root_key', 'relative_path'],
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_status_valid', {
    check: "status IN ('planned','approved','queued','applying','verifying','ready','failed','cancelled','stale')",
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_snapshot_consistent', {
    check: '(expected_location_id IS NULL) = (expected_location_version IS NULL)',
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_relative_path_safe', {
    check: SAFE_RELATIVE_PATH_CHECK,
  })
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_root_fk', {
    foreignKeys: {
      columns: ['organization_id', 'storage_root_key'],
      references: 'storage_roots (organization_id, root_key)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.createIndex('case_workspace_provisionings', ['organization_id', 'status', 'updated_at'])

  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace')",
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: "target_type IN ('document_version','photo','case_location','workspace_provisioning')",
  })
  pgm.sql(`CREATE UNIQUE INDEX jobs_one_active_workspace_job
    ON jobs (organization_id, target_type, target_id)
    WHERE target_type = 'workspace_provisioning' AND status IN ('pending','leased')`)
  pgm.addConstraint('case_workspace_provisionings', 'case_workspace_provisionings_active_job_fk', {
    foreignKeys: {
      columns: 'active_job_id',
      references: 'jobs(id)',
      onDelete: 'SET NULL',
    },
  })
}

export function down(pgm) {
  // Yalnız geliştirme/test ortamı içindir.
  pgm.dropConstraint('case_workspace_provisionings', 'case_workspace_provisionings_active_job_fk')
  pgm.sql('DROP INDEX jobs_one_active_workspace_job')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: "type IN ('verify_document','verify_photo','verify_case_location')",
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: "target_type IN ('document_version','photo','case_location')",
  })
  pgm.dropTable('case_workspace_provisionings')
}
