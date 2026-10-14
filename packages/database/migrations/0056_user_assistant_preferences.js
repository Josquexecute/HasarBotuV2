export const shorthands = undefined
export function up(pgm) {
  pgm.createTable('user_assistant_preferences', {
    user_id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true },
    appearance: { type: 'jsonb', notNull: true }, version: { type: 'integer', notNull: true, default: 1 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('user_assistant_preferences', 'user_assistant_preferences_tenant', {
    foreignKeys: { columns: ['organization_id', 'user_id'], references: 'users (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('user_assistant_preferences', 'user_assistant_preferences_version', { check: 'version > 0' })
}
export function down(pgm) {
  pgm.sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM user_assistant_preferences) THEN RAISE EXCEPTION 'assistant_preferences_downgrade_would_lose_data'; END IF; END $$")
  pgm.dropTable('user_assistant_preferences')
}
