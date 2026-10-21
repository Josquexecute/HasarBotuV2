export const shorthands = undefined

export function up(pgm) {
  pgm.addColumns('case_notice_sheets', { service_context: { type: 'jsonb' } })
  // Bind existing handwritten contacts to their current case service, without
  // rewriting any overrides. A later service change must not reuse them.
  pgm.sql(`UPDATE case_notice_sheets n SET service_context=jsonb_build_object(
    'id',c.service_center_id,'name',coalesce(s.name,e.reviewed_fields#>>'{automatic,serviceName}',e.extracted_fields->>'service',''))
    FROM cases c
    LEFT JOIN service_centers s ON s.organization_id=c.organization_id AND s.id=c.service_center_id
    LEFT JOIN LATERAL (SELECT reviewed_fields,extracted_fields FROM eksist_sources
      WHERE organization_id=c.organization_id AND case_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
    WHERE n.organization_id=c.organization_id AND n.case_id=c.id`)
  // Also invalidate an editor opened before a service replacement. Keeping
  // the sheet version unchanged would let that editor rebind old contacts.
  pgm.sql(`CREATE FUNCTION invalidate_notice_sheet_service() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE case_notice_sheets SET version=version+1,updated_at=now()
        WHERE organization_id=NEW.organization_id AND case_id=NEW.id;
      RETURN NEW;
    END $$;
    CREATE TRIGGER notice_sheet_case_service_changed AFTER UPDATE OF service_center_id ON cases
      FOR EACH ROW WHEN (OLD.service_center_id IS DISTINCT FROM NEW.service_center_id)
      EXECUTE FUNCTION invalidate_notice_sheet_service();
    CREATE FUNCTION invalidate_notice_sheet_source() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE case_notice_sheets SET version=version+1,updated_at=now()
        WHERE organization_id=NEW.organization_id AND case_id=NEW.case_id;
      RETURN NEW;
    END $$;
    CREATE TRIGGER notice_sheet_source_changed AFTER INSERT OR UPDATE OF raw_text,reviewed_fields ON eksist_sources
      FOR EACH ROW EXECUTE FUNCTION invalidate_notice_sheet_source();`)
}

export function down(pgm) {
  pgm.sql(`DROP TRIGGER notice_sheet_source_changed ON eksist_sources;
    DROP FUNCTION invalidate_notice_sheet_source();
    DROP TRIGGER notice_sheet_case_service_changed ON cases;
    DROP FUNCTION invalidate_notice_sheet_service();`)
  pgm.dropColumns('case_notice_sheets', ['service_context'])
}
