/*
 * Paket 60 — Excel şablon profilleri (HB-2026-067).
 *
 * Profil, kanonik operasyon türlerini kullanıcının kendi Excel sütunlarına
 * eşler. Hiçbir sigorta şirketinin kolon seti şemaya GÖMÜLMEZ: sütunlar ve
 * eşleme jsonb içinde kullanıcı verisidir. Şemanın zorladığı tek şey kanonik
 * tür kümesinin TAMAMEN kapsanmasıdır.
 *
 * Sürümleme 0032 (araç profili) kalıbını izler: aggregate + immutable sürüm
 * zinciri. Bu paket hiçbir dosyaya yazmaz; projeksiyon salt okunurdur.
 */
const OPERATION_TYPES = [
  'repair',
  'replace',
  'remove_install',
  'paint',
  'consumable',
  'calibration',
  'related_operation',
  'other',
]

/**
 * Eşleme her kanonik türü içermeli, fazla anahtar taşımamalı ve her değer ya
 * sütun anahtarı ya null olmalıdır.
 *
 * CHECK içinde subquery kullanılamaz; fazla-anahtar kuralı bu yüzden sayım
 * yerine jsonb anahtar çıkarma ile ifade edilir: kanonik anahtarlar
 * silindiğinde geriye boş nesne kalmalıdır.
 */
const OPERATION_TYPE_ARRAY = `ARRAY[${OPERATION_TYPES.map((type) => `'${type}'`).join(',')}]::text[]`
const MAPPING_COMPLETE = `mapping ?& ${OPERATION_TYPE_ARRAY}`
const MAPPING_NO_EXTRA_KEYS = `(mapping - ${OPERATION_TYPE_ARRAY}) = '{}'::jsonb`
const MAPPING_VALUES_VALID = OPERATION_TYPES
  .map((type) => `(jsonb_typeof(mapping->'${type}') IN ('string','null'))`)
  .join(' AND ')

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE labor_excel_profiles (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      current_version_id uuid,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT labor_excel_profiles_org_fk
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
      CONSTRAINT labor_excel_profiles_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_excel_profiles_org_id_unique UNIQUE (organization_id,id),
      CONSTRAINT labor_excel_profiles_version_valid CHECK (version>=1)
    );

    CREATE TABLE labor_excel_profile_versions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      profile_version integer NOT NULL,
      previous_version_id uuid,
      schema_version text NOT NULL,
      name text NOT NULL,
      insurer_id uuid,
      columns jsonb NOT NULL,
      mapping jsonb NOT NULL,
      revision_reason text,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT labor_excel_profile_versions_profile_fk
        FOREIGN KEY (organization_id,profile_id)
        REFERENCES labor_excel_profiles(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_excel_profile_versions_previous_fk
        FOREIGN KEY (previous_version_id)
        REFERENCES labor_excel_profile_versions(id) ON DELETE RESTRICT,
      CONSTRAINT labor_excel_profile_versions_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      -- Sigorta şirketi AYNI organizasyondan olmalıdır.
      CONSTRAINT labor_excel_profile_versions_insurer_fk
        FOREIGN KEY (organization_id,insurer_id)
        REFERENCES insurers(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_excel_profile_versions_sequence_unique
        UNIQUE (organization_id,profile_id,profile_version),
      CONSTRAINT labor_excel_profile_versions_valid CHECK (
        schema_version='labor-excel-profile/1.0.0'
        AND profile_version>=1
        AND char_length(name) BETWEEN 1 AND 80
        AND name ~ '[^[:space:]]'
        AND name !~ '[[:cntrl:]]'
        AND jsonb_typeof(columns)='array'
        AND jsonb_array_length(columns) BETWEEN 1 AND 24
        AND jsonb_typeof(mapping)='object'
        -- Kanonik tür kümesi tam kapsanmalı ve fazla anahtar olmamalı.
        AND ${MAPPING_COMPLETE}
        AND ${MAPPING_NO_EXTRA_KEYS}
        AND ${MAPPING_VALUES_VALID}
        AND (
          (profile_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL)
          OR
          (profile_version>1 AND previous_version_id IS NOT NULL
            AND char_length(revision_reason) BETWEEN 1 AND 500
            AND revision_reason ~ '[^[:space:]]' AND revision_reason !~ '[[:cntrl:]]')
        )
      )
    );
    CREATE INDEX labor_excel_profile_versions_profile_idx
      ON labor_excel_profile_versions (organization_id,profile_id,profile_version DESC);

    ALTER TABLE labor_excel_profiles
      ADD CONSTRAINT labor_excel_profiles_current_version_fk
        FOREIGN KEY (current_version_id)
        REFERENCES labor_excel_profile_versions(id) ON DELETE RESTRICT;

    -- Sürümler append-only; aggregate silinemez ve kimliği değişmez.
    CREATE FUNCTION labor_excel_profile_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'labor excel profile version is immutable' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER labor_excel_profile_version_guard
      BEFORE UPDATE OR DELETE ON labor_excel_profile_versions
      FOR EACH ROW EXECUTE FUNCTION labor_excel_profile_version_guard();

    CREATE FUNCTION labor_excel_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor excel profile cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'labor excel profile identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_excel_profile_guard
      BEFORE UPDATE OR DELETE ON labor_excel_profiles
      FOR EACH ROW EXECUTE FUNCTION labor_excel_profile_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER labor_excel_profile_guard ON labor_excel_profiles;
    DROP FUNCTION labor_excel_profile_guard();
    DROP TRIGGER labor_excel_profile_version_guard ON labor_excel_profile_versions;
    DROP FUNCTION labor_excel_profile_version_guard();
    ALTER TABLE labor_excel_profiles DROP CONSTRAINT labor_excel_profiles_current_version_fk;
    DROP TABLE labor_excel_profile_versions;
    DROP TABLE labor_excel_profiles;
  `)
}
