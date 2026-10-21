export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('case_service_contacts', {
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    service_center_id: { type: 'uuid' },
    name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    address: { type: 'text' },
    updated_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { constraints: { primaryKey: ['organization_id', 'case_id'] } })
  pgm.addConstraint('case_service_contacts', 'case_service_contacts_service_fk', {
    foreignKeys: { columns: ['organization_id', 'service_center_id'], references: 'service_centers (organization_id,id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('case_service_contacts', 'case_service_contacts_case_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id,id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('case_service_contacts', 'case_service_contacts_values_valid', {
    check: "length(trim(name)) BETWEEN 1 AND 500 AND (phone IS NULL OR length(phone)<=80) AND (address IS NULL OR length(address)<=500)",
  })
  // A case edit must also invalidate a sheet editor opened before that edit.
  pgm.sql(`CREATE FUNCTION invalidate_notice_sheet_contact() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE case_notice_sheets SET version=version+1,updated_at=now()
        WHERE organization_id=coalesce(NEW.organization_id,OLD.organization_id) AND case_id=coalesce(NEW.case_id,OLD.case_id);
      RETURN coalesce(NEW,OLD);
    END $$;
    CREATE TRIGGER notice_sheet_contact_changed AFTER INSERT OR UPDATE OR DELETE ON case_service_contacts
    FOR EACH ROW EXECUTE FUNCTION invalidate_notice_sheet_contact();`)
}

export function down(pgm) {
  pgm.dropTable('case_service_contacts')
  pgm.sql('DROP FUNCTION invalidate_notice_sheet_contact();')
}
