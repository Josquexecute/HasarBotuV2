/**
 * Paket 07 — cases cekirdegi ve referans tablolari (salt okunur API icin).
 *
 * - lifecycle_status yalniz open|closed; workflow_stage ayri alan (HB-2026-010).
 * - Ofis numarasi firma+yil bazinda benzersizdir; iptal edilen numara yeniden
 *   dagitilmaz ve yeniden acilan dosya numarasini korur (uygulama kurali).
 * - follow_up_date yalniz gun tasir (HB-2026-005); saat/timezone yoktur.
 * - plate_normalized ayracsiz arama anahtaridir (domain plateSearchKey ile ayni kural).
 */
export const shorthands = undefined

const WORKFLOW_STAGES =
  "('new_notification','vehicle_or_service_pending','inspection_pending','damage_assessment'," +
  "'parts_and_labor','repair_approval_pending','under_repair','reporting','closing_documents','ready_to_close')"

export function up(pgm) {
  pgm.createTable('service_centers', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    name: { type: 'text', notNull: true },
    center_type: { type: 'text', notNull: true },
    phone: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('service_centers', 'service_centers_type_valid', {
    check: "center_type IN ('yetkili','ozel')",
  })
  pgm.addConstraint('service_centers', 'service_centers_org_name_unique', {
    unique: ['organization_id', 'name'],
  })

  pgm.createTable('insurers', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('insurers', 'insurers_org_name_unique', { unique: ['organization_id', 'name'] })

  pgm.createTable('cases', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    office_year: { type: 'integer', notNull: true },
    office_sequence: { type: 'integer', notNull: true },
    office_number: { type: 'text', notNull: true },
    case_type: { type: 'text', notNull: true },
    lifecycle_status: { type: 'text', notNull: true, default: 'open' },
    workflow_stage: { type: 'text', notNull: true },
    notification_form_number: { type: 'text' },
    insurer_claim_number: { type: 'text' },
    plate: { type: 'text', notNull: true },
    plate_normalized: { type: 'text', notNull: true },
    responsible_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    insurer_id: { type: 'uuid', references: 'insurers', onDelete: 'SET NULL' },
    service_center_id: { type: 'uuid', references: 'service_centers', onDelete: 'SET NULL' },
    follow_up_date: { type: 'date' },
    last_intervention_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('cases', 'cases_type_valid', { check: "case_type IN ('traffic','casco')" })
  pgm.addConstraint('cases', 'cases_lifecycle_valid', {
    check: "lifecycle_status IN ('open','closed')",
  })
  pgm.addConstraint('cases', 'cases_stage_valid', { check: `workflow_stage IN ${WORKFLOW_STAGES}` })
  pgm.addConstraint('cases', 'cases_office_year_range', {
    check: 'office_year BETWEEN 2000 AND 9999',
  })
  pgm.addConstraint('cases', 'cases_office_sequence_positive', { check: 'office_sequence >= 1' })
  pgm.addConstraint('cases', 'cases_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('cases', 'cases_office_seq_unique', {
    unique: ['organization_id', 'office_year', 'office_sequence'],
  })
  pgm.addConstraint('cases', 'cases_office_number_unique', {
    unique: ['organization_id', 'office_number'],
  })

  pgm.createIndex('cases', ['organization_id', 'updated_at'])
  pgm.createIndex('cases', 'plate_normalized')
  pgm.createIndex('cases', 'follow_up_date')
  pgm.createIndex('cases', 'workflow_stage')
  pgm.createIndex('cases', 'lifecycle_status')
  pgm.createIndex('cases', 'responsible_user_id')
  pgm.createIndex('cases', 'service_center_id')
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTable('cases')
  pgm.dropTable('insurers')
  pgm.dropTable('service_centers')
}
