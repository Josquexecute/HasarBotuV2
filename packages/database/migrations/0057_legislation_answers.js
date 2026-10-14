export const shorthands = undefined
export function up(pgm) {
  pgm.createTable('legislation_ai_settings', {
    organization_id: { type: 'uuid', primaryKey: true, references: 'organizations', onDelete: 'RESTRICT' },
    encrypted_api_key: { type: 'text', notNull: true }, model: { type: 'text', notNull: true }, enabled: { type: 'boolean', notNull: true },
    version: { type: 'integer', notNull: true }, updated_by_user_id: { type: 'uuid', notNull: true }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('legislation_ai_settings', 'legislation_ai_settings_user_tenant', { foreignKeys: { columns: ['organization_id', 'updated_by_user_id'], references: 'users (organization_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('legislation_ai_settings', 'legislation_ai_settings_version', { check: 'version > 0' })
  pgm.createTable('legislation_answers', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid' },
    answer: { type: 'jsonb', notNull: true }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('legislation_answers', 'legislation_answers_user_tenant', { foreignKeys: { columns: ['organization_id', 'user_id'], references: 'users (organization_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('legislation_answers', 'legislation_answers_case_tenant', { foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('legislation_answers', 'legislation_answers_object', { check: "jsonb_typeof(answer)='object'" })
  pgm.createIndex('legislation_answers', ['organization_id', 'user_id', 'created_at'])
}
export function down(pgm) {
  pgm.sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM legislation_answers) OR EXISTS(SELECT 1 FROM legislation_ai_settings) THEN RAISE EXCEPTION 'legislation_history_or_settings_not_empty'; END IF; END $$")
  pgm.dropTable('legislation_answers')
  pgm.dropTable('legislation_ai_settings')
}
