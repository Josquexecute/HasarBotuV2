export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('case_folder_registrations', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'RESTRICT' },
    storage_root_key: { type: 'text', notNull: true },
    source_folder_id: { type: 'text', notNull: true },
    source_relative_path: { type: 'text', notNull: true },
    evidence: { type: 'jsonb', notNull: true },
    plan_hash: { type: 'text', notNull: true },
    created_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_folder_registrations', 'case_folder_registration_identity_unique', { unique: ['organization_id', 'storage_root_key', 'source_folder_id'] })
  pgm.addConstraint('case_folder_registrations', 'case_folder_registration_case_unique', { unique: ['organization_id', 'case_id'] })
  pgm.addConstraint('case_folder_registrations', 'case_folder_registration_evidence_valid', { check: "jsonb_typeof(evidence)='object' AND plan_hash ~ '^[a-f0-9]{64}$' AND source_folder_id ~ '^[0-9]+$'" })
}

export function down(pgm) {
  // Preserve provenance once a production folder has been registered.
  pgm.sql("DO $$ BEGIN IF EXISTS (SELECT 1 FROM case_folder_registrations) THEN RAISE EXCEPTION 'folder_registration_provenance_not_empty'; END IF; END $$")
  pgm.dropTable('case_folder_registrations')
}
