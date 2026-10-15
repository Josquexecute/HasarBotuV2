export const shorthands = undefined
export function up(pgm) {
  pgm.createTable('operational_alert_reads', {
    organization_id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    case_id: { type: 'uuid', notNull: true },
    dedupe_key: { type: 'varchar(300)', notNull: true },
    fingerprint: { type: 'char(64)', notNull: true },
    read_at: { type: 'timestamptz', notNull: true },
  })
  pgm.addConstraint('operational_alert_reads', 'operational_alert_reads_pk', { primaryKey: ['organization_id', 'user_id', 'dedupe_key'] })
  pgm.addConstraint('operational_alert_reads', 'operational_alert_reads_user', {
    foreignKeys: { columns: ['organization_id', 'user_id'], references: 'users (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('operational_alert_reads', 'operational_alert_reads_case', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.createIndex('operational_alert_reads', ['organization_id', 'case_id'])
}
export function down(pgm) {
  pgm.sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM operational_alert_reads) THEN RAISE EXCEPTION 'alert_reads_downgrade_would_lose_data'; END IF; END $$")
  pgm.dropTable('operational_alert_reads')
}
