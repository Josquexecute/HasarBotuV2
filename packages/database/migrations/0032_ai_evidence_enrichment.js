/*
 * Paket 56: AI kanıt zenginleştirme.
 *
 * Üç eksik kanal birlikte kapatılır:
 *  1. Dosya düzeyinde sürümlü araç profili (kullanıcı kontrollü, immutable sürümler).
 *  2. İşçilik satırında parça kodu (nullable; eski sürümler null kalır).
 *  3. İşçilik satırında normalize hasar bölgesi (nullable).
 *
 * Tam şasi numarası ve plaka bu modelde TUTULMAZ; yalnız şasi prefix'i saklanır.
 */
const VEHICLE_CLASSES =
  "'passenger_car','light_commercial','heavy_commercial','motorcycle','trailer','other'"
const EVIDENCE_SOURCES =
  "'registration_document','policy_document','insurer_record','user_statement','other'"

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE case_vehicle_profiles (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      current_version_id uuid,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_vehicle_profiles_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_profiles_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_profiles_case_unique UNIQUE (organization_id,case_id),
      CONSTRAINT case_vehicle_profiles_org_case_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT case_vehicle_profiles_version_valid CHECK (version>=1)
    );

    CREATE TABLE case_vehicle_profile_versions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      profile_version integer NOT NULL,
      previous_version_id uuid,
      schema_version text NOT NULL,
      brand text NOT NULL,
      model text NOT NULL,
      model_year integer NOT NULL,
      variant text,
      vehicle_class text NOT NULL,
      chassis_prefix text,
      engine_code text,
      evidence_source text NOT NULL,
      evidence_reference text,
      revision_reason text,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_vehicle_profile_versions_profile_fk
        FOREIGN KEY (organization_id,case_id,profile_id)
        REFERENCES case_vehicle_profiles(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_profile_versions_previous_fk
        FOREIGN KEY (previous_version_id)
        REFERENCES case_vehicle_profile_versions(id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_profile_versions_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_profile_versions_sequence_unique
        UNIQUE (organization_id,profile_id,profile_version),
      CONSTRAINT case_vehicle_profile_versions_valid CHECK (
        schema_version='case-vehicle-profile/1.0.0'
        AND profile_version>=1
        AND char_length(brand) BETWEEN 1 AND 60
        AND brand !~ '[[:cntrl:]]'
        AND char_length(model) BETWEEN 1 AND 60
        AND model !~ '[[:cntrl:]]'
        AND model_year BETWEEN 1950 AND 2100
        AND (variant IS NULL OR (char_length(variant) BETWEEN 1 AND 60 AND variant !~ '[[:cntrl:]]'))
        AND vehicle_class IN (${VEHICLE_CLASSES})
        -- Şasi PREFIX'i: tam VIN (17) kabul edilmez, VIN alfabesi zorunludur.
        AND (chassis_prefix IS NULL OR (
          char_length(chassis_prefix) BETWEEN 3 AND 11
          AND chassis_prefix ~ '^[A-HJ-NPR-Z0-9]+$'
        ))
        AND (engine_code IS NULL OR (
          char_length(engine_code) BETWEEN 2 AND 24 AND engine_code ~ '^[A-Z0-9./-]+$'
        ))
        AND evidence_source IN (${EVIDENCE_SOURCES})
        AND (evidence_reference IS NULL OR (
          char_length(evidence_reference) BETWEEN 1 AND 120 AND evidence_reference !~ '[[:cntrl:]]'
        ))
        AND (
          (profile_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL)
          OR
          (profile_version>1 AND previous_version_id IS NOT NULL
            AND char_length(revision_reason) BETWEEN 1 AND 500
            AND revision_reason ~ '[^[:space:]]' AND revision_reason !~ '[[:cntrl:]]')
        )
      )
    );
    CREATE INDEX case_vehicle_profile_versions_profile_idx
      ON case_vehicle_profile_versions (organization_id,profile_id,profile_version DESC);

    ALTER TABLE case_vehicle_profiles
      ADD CONSTRAINT case_vehicle_profiles_current_version_fk
        FOREIGN KEY (current_version_id)
        REFERENCES case_vehicle_profile_versions(id) ON DELETE RESTRICT;

    -- Sürümler append-only'dir; aggregate silinemez.
    CREATE FUNCTION case_vehicle_profile_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'case vehicle profile version is immutable' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER case_vehicle_profile_version_guard
      BEFORE UPDATE OR DELETE ON case_vehicle_profile_versions
      FOR EACH ROW EXECUTE FUNCTION case_vehicle_profile_version_guard();

    CREATE FUNCTION case_vehicle_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'case vehicle profile cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'case vehicle profile identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER case_vehicle_profile_guard
      BEFORE UPDATE OR DELETE ON case_vehicle_profiles
      FOR EACH ROW EXECUTE FUNCTION case_vehicle_profile_guard();

    -- İşçilik satırı kanıt alanları. Nullable: eski sürümler değişmeden okunur.
    ALTER TABLE labor_sheet_items
      ADD COLUMN part_code text,
      ADD COLUMN part_code_source text,
      ADD COLUMN damage_region text;
    ALTER TABLE labor_sheet_items
      ADD CONSTRAINT labor_sheet_items_evidence_valid CHECK (
        (part_code IS NULL OR (
          char_length(part_code) BETWEEN 1 AND 40 AND part_code ~ '^[A-Z0-9._/-]+$'
        ))
        -- Kaynak yalnız kod varken anlamlıdır; kullanıcı girdisi ile sözlük
        -- önerisi birbirinden ayrılır.
        AND ((part_code IS NULL) = (part_code_source IS NULL))
        AND (part_code_source IS NULL OR part_code_source IN ('user_entered','dictionary_suggested'))
        AND (damage_region IS NULL OR (
          char_length(damage_region) BETWEEN 1 AND 80
          AND damage_region ~ '[^[:space:]]' AND damage_region !~ '[[:cntrl:]]'
        ))
      );
  `)
}

export function down(pgm) {
  pgm.sql(`
    ALTER TABLE labor_sheet_items
      DROP CONSTRAINT labor_sheet_items_evidence_valid,
      DROP COLUMN damage_region,
      DROP COLUMN part_code_source,
      DROP COLUMN part_code;

    DROP TRIGGER case_vehicle_profile_guard ON case_vehicle_profiles;
    DROP FUNCTION case_vehicle_profile_guard();
    DROP TRIGGER case_vehicle_profile_version_guard ON case_vehicle_profile_versions;
    DROP FUNCTION case_vehicle_profile_version_guard();
    ALTER TABLE case_vehicle_profiles DROP CONSTRAINT case_vehicle_profiles_current_version_fk;
    DROP TABLE case_vehicle_profile_versions;
    DROP TABLE case_vehicle_profiles;
  `)
}
