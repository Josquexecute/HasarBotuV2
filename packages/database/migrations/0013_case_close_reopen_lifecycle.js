/**
 * Paket 21 — case close/reopen saga ve append-only yaşam döngüsü geçmişi.
 * Fiziksel işlem mevcut case_file_operations + jobs altyapısına bağlanır.
 * Mutlak yol kolonu yoktur; yalnız storage root anahtarı ve güvenli göreli yol.
 */
export const shorthands = undefined

const SAFE_PATH = (column) => `${column} <> ''
  AND left(${column},1) <> '/'
  AND ${column} !~ '^[A-Za-z]:'
  AND ${column} !~ '(^|/)[.][.](/|$)'
  AND ${column} !~ '[<>:"|?*]'
  AND ${column} !~ '[[:cntrl:]]'
  AND strpos(${column}, chr(92)) = 0`

export function up(pgm) {
  pgm.dropConstraint('cases', 'cases_stage_valid')
  pgm.addConstraint('cases', 'cases_stage_valid', {
    check: "workflow_stage IN ('new_notification','vehicle_or_service_pending','inspection_pending','damage_assessment','parts_and_labor','repair_approval_pending','under_repair','reporting','closing_documents','ready_to_close','closed')",
  })
  pgm.addConstraint('cases', 'cases_lifecycle_stage_consistent', {
    check: "(lifecycle_status='closed' AND workflow_stage='closed') OR (lifecycle_status='open' AND workflow_stage<>'closed')",
  })

  pgm.createTable('case_lifecycle_operations', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'RESTRICT' },
    operation_type: { type: 'text', notNull: true },
    expected_case_version: { type: 'integer', notNull: true },
    expected_location_id: { type: 'uuid', notNull: true, references: 'case_locations', onDelete: 'RESTRICT' },
    expected_location_version: { type: 'integer', notNull: true },
    source_storage_root_key: { type: 'text', notNull: true },
    source_relative_path: { type: 'text', notNull: true },
    destination_storage_root_key: { type: 'text', notNull: true },
    destination_relative_path: { type: 'text', notNull: true },
    linked_file_operation_id: { type: 'uuid', references: 'case_file_operations', onDelete: 'RESTRICT' },
    closure_mode: { type: 'text' },
    requirement_snapshot: { type: 'jsonb', notNull: true, default: '{}' },
    blockers: { type: 'jsonb', notNull: true, default: '[]' },
    warnings: { type: 'jsonb', notNull: true, default: '[]' },
    user_reason: { type: 'text' },
    previous_lifecycle_status: { type: 'text', notNull: true },
    target_lifecycle_status: { type: 'text', notNull: true },
    previous_workflow_stage: { type: 'text', notNull: true },
    target_workflow_stage: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true },
    failure_reason_code: { type: 'text' },
    idempotency_key_hash: { type: 'text', notNull: true },
    request_hash: { type: 'text', notNull: true },
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
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_type_valid', {
    check: "operation_type IN ('close','reopen')",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_status_valid', {
    check: "status IN ('planned','blocked','approval_required','approved','queued','moving','verifying','finalizing','closed','reopened','failed','stale','cancelled','cleanup_pending','manual_recovery_required')",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_mode_valid', {
    check: "closure_mode IS NULL OR closure_mode IN ('normal','with_missing_requirements')",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_shape_valid', {
    check: "(operation_type='close' AND closure_mode IS NOT NULL AND target_lifecycle_status='closed' AND target_workflow_stage='closed') OR (operation_type='reopen' AND closure_mode IS NULL AND target_lifecycle_status='open' AND target_workflow_stage<>'closed')",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_versions_positive', {
    check: 'expected_case_version >= 1 AND expected_location_version >= 1 AND version >= 1',
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_hashes_valid', {
    check: "idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_reason_valid', {
    check: "user_reason IS NULL OR (length(user_reason) BETWEEN 3 AND 500 AND user_reason ~ '[^[:space:]]')",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_failure_code_safe', {
    check: "failure_reason_code IS NULL OR failure_reason_code ~ '^[a-z0-9_]{1,64}$'",
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_source_path_safe', { check: SAFE_PATH('source_relative_path') })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_destination_path_safe', { check: SAFE_PATH('destination_relative_path') })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_source_root_fk', {
    foreignKeys: { columns: ['organization_id', 'source_storage_root_key'], references: 'storage_roots (organization_id, root_key)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_destination_root_fk', {
    foreignKeys: { columns: ['organization_id', 'destination_storage_root_key'], references: 'storage_roots (organization_id, root_key)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('case_lifecycle_operations', 'case_lifecycle_operations_idempotency_unique', {
    unique: ['organization_id', 'idempotency_key_hash'],
  })
  pgm.sql(`CREATE UNIQUE INDEX case_lifecycle_operations_one_active_case
    ON case_lifecycle_operations (organization_id, case_id)
    WHERE status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')`)
  pgm.sql(`CREATE UNIQUE INDEX case_lifecycle_operations_destination_reservation
    ON case_lifecycle_operations (organization_id,destination_storage_root_key,lower(destination_relative_path))
    WHERE status NOT IN ('blocked','closed','reopened','failed','stale','cancelled')`)
  pgm.createIndex('case_lifecycle_operations', ['organization_id', 'case_id', 'created_at'])

  pgm.createTable('case_lifecycle_history', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'RESTRICT' },
    lifecycle_operation_id: { type: 'uuid', notNull: true, references: 'case_lifecycle_operations', onDelete: 'RESTRICT' },
    operation_type: { type: 'text', notNull: true },
    previous_lifecycle_status: { type: 'text', notNull: true },
    lifecycle_status: { type: 'text', notNull: true },
    previous_workflow_stage: { type: 'text', notNull: true },
    workflow_stage: { type: 'text', notNull: true },
    source_storage_root_key: { type: 'text', notNull: true },
    source_relative_path: { type: 'text', notNull: true },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    closure_mode: { type: 'text' },
    requirement_snapshot: { type: 'jsonb', notNull: true, default: '{}' },
    user_reason: { type: 'text' },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_lifecycle_history', 'case_lifecycle_history_operation_unique', { unique: ['lifecycle_operation_id'] })
  pgm.createIndex('case_lifecycle_history', ['organization_id', 'case_id', 'occurred_at'])
  for (const suffix of ['no_update', 'no_delete']) {
    pgm.createTrigger('case_lifecycle_history', `case_lifecycle_history_${suffix}`, {
      when: 'BEFORE',
      operation: suffix === 'no_update' ? 'UPDATE' : 'DELETE',
      level: 'ROW',
      function: 'append_only_guard',
    })
  }

  pgm.addColumns('cases', {
    closed_at: { type: 'timestamptz' },
    closed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    reopened_at: { type: 'timestamptz' },
    reopened_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    latest_lifecycle_operation_id: { type: 'uuid' },
  })
  pgm.addConstraint('cases', 'cases_latest_lifecycle_operation_fk', {
    foreignKeys: { columns: 'latest_lifecycle_operation_id', references: 'case_lifecycle_operations', onDelete: 'SET NULL' },
  })
}

export function down(pgm) {
  pgm.dropConstraint('cases', 'cases_latest_lifecycle_operation_fk')
  pgm.dropColumns('cases', ['closed_at', 'closed_by_user_id', 'reopened_at', 'reopened_by_user_id', 'latest_lifecycle_operation_id'])
  pgm.dropTable('case_lifecycle_history')
  pgm.dropTable('case_lifecycle_operations')
  pgm.dropConstraint('cases', 'cases_lifecycle_stage_consistent')
  pgm.dropConstraint('cases', 'cases_stage_valid')
  pgm.addConstraint('cases', 'cases_stage_valid', {
    check: "workflow_stage IN ('new_notification','vehicle_or_service_pending','inspection_pending','damage_assessment','parts_and_labor','repair_approval_pending','under_repair','reporting','closing_documents','ready_to_close')",
  })
}
