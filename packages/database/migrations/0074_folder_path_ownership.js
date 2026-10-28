export const shorthands = undefined

export function up(pgm) {
  // Prospective guard: legacy collisions remain untouched for operator review.
  pgm.sql(`
    CREATE FUNCTION hb_folder_path_key(path text) RETURNS text
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT normalize(upper(normalize(path, NFC)), NFC) $$;
    CREATE FUNCTION hb_guard_folder_path_owner() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE root_key text; folder_path text;
    BEGIN
      IF TG_TABLE_NAME='case_file_operations' THEN
        IF NEW.status IN ('ready','stale','cancelled') THEN RETURN NEW; END IF;
        root_key:=NEW.destination_storage_root_key; folder_path:=NEW.destination_relative_path;
      ELSE root_key:=NEW.storage_root_key; folder_path:=NEW.relative_path; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('folder-path:' || NEW.organization_id || ':' || root_key || ':' || hb_folder_path_key(folder_path),0));
      IF EXISTS(SELECT 1 FROM case_locations l WHERE l.organization_id=NEW.organization_id
          AND l.storage_root_key=root_key AND l.case_id<>NEW.case_id
          AND hb_folder_path_key(l.relative_path)=hb_folder_path_key(folder_path))
        OR EXISTS(SELECT 1 FROM case_workspace_provisionings w WHERE w.organization_id=NEW.organization_id
          AND w.storage_root_key=root_key AND w.case_id<>NEW.case_id
          AND hb_folder_path_key(w.relative_path)=hb_folder_path_key(folder_path))
        OR EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=NEW.organization_id
          AND o.destination_storage_root_key=root_key AND o.case_id<>NEW.case_id AND o.status NOT IN ('ready','stale','cancelled')
          AND hb_folder_path_key(o.destination_relative_path)=hb_folder_path_key(folder_path)) THEN
        RAISE EXCEPTION 'folder_path_owned_by_another_case' USING ERRCODE='23505', CONSTRAINT='folder_path_owner_unique';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER case_location_path_owner BEFORE INSERT OR UPDATE OF organization_id,case_id,storage_root_key,relative_path
      ON case_locations FOR EACH ROW EXECUTE FUNCTION hb_guard_folder_path_owner();
    CREATE TRIGGER workspace_path_owner BEFORE INSERT OR UPDATE OF organization_id,case_id,storage_root_key,relative_path
      ON case_workspace_provisionings FOR EACH ROW EXECUTE FUNCTION hb_guard_folder_path_owner();
    CREATE TRIGGER file_operation_path_owner BEFORE INSERT OR UPDATE OF organization_id,case_id,destination_storage_root_key,destination_relative_path,status
      ON case_file_operations FOR EACH ROW EXECUTE FUNCTION hb_guard_folder_path_owner();
    ALTER TABLE case_folder_registrations ADD CONSTRAINT folder_registration_tenant_case_fk
      FOREIGN KEY(organization_id,case_id) REFERENCES cases(organization_id,id) NOT VALID;
    ALTER TABLE case_folder_registrations ADD CONSTRAINT folder_registration_root_fk
      FOREIGN KEY(organization_id,storage_root_key) REFERENCES storage_roots(organization_id,root_key) NOT VALID;
    CREATE FUNCTION hb_guard_folder_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.source_folder_id !~ '^[1-9][0-9]*$' OR EXISTS(SELECT 1 FROM case_folder_registrations r
        WHERE r.organization_id=NEW.organization_id AND r.storage_root_key=NEW.storage_root_key AND r.id<>NEW.id
          AND ltrim(r.source_folder_id,'0')=NEW.source_folder_id) THEN
        RAISE EXCEPTION 'folder_identity_not_canonical_or_in_use' USING ERRCODE='23505', CONSTRAINT='folder_identity_canonical_unique';
      END IF;
      IF EXISTS(SELECT 1 FROM case_locations l WHERE l.organization_id=NEW.organization_id
          AND l.storage_root_key=NEW.storage_root_key AND l.case_id<>NEW.case_id
          AND hb_folder_path_key(l.relative_path)=hb_folder_path_key(NEW.source_relative_path)) THEN
        RAISE EXCEPTION 'folder_identity_path_owner_conflict' USING ERRCODE='23505', CONSTRAINT='folder_identity_path_owner';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER folder_identity_owner BEFORE INSERT OR UPDATE OF organization_id,case_id,storage_root_key,source_folder_id,source_relative_path
      ON case_folder_registrations FOR EACH ROW EXECUTE FUNCTION hb_guard_folder_identity();
  `)
}

export function down(pgm) {
  pgm.sql(`DROP TRIGGER folder_identity_owner ON case_folder_registrations;
    DROP FUNCTION hb_guard_folder_identity();
    ALTER TABLE case_folder_registrations DROP CONSTRAINT folder_registration_tenant_case_fk;
    ALTER TABLE case_folder_registrations DROP CONSTRAINT folder_registration_root_fk;
    DROP TRIGGER file_operation_path_owner ON case_file_operations;
    DROP TRIGGER workspace_path_owner ON case_workspace_provisionings;
    DROP TRIGGER case_location_path_owner ON case_locations;
    DROP FUNCTION hb_guard_folder_path_owner(); DROP FUNCTION hb_folder_path_key(text);`)
}
