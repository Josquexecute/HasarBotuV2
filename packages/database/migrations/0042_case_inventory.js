/*
 * Dosya Envanteri: araç sahibi mini-yakalama çekirdeği.
 *
 * Envanter export'unun 16 sütunundan 14'ü mevcut tablolardan (cases, insurers,
 * users, service_centers, documents) türetilir. Araç sahibi adı/telefonu
 * HİÇBİR tabloda tutulmuyordu; bu migration yalnız o eksik kanalı kapatır.
 *
 * Tasarım: tam sürüm zinciri (case_vehicle_profile_versions gibi) YOKTUR —
 * orantısız olurdu. Bunun yerine sahip listesi TEK SEFERDE değiştirilir
 * (kullanıcı tüm listeyi gönderir, sunucu atomik biçimde yeni bir
 * `set_version` yazar). Eski `set_version` satırları hiçbir zaman silinmez
 * veya güncellenmez (append-only); bu, ayrı bir tarihçe tablosu olmadan
 * doğal bir denetim izi verir. `case_vehicle_owner_sets` yalnız "güncel
 * set_version hangisi" işaretçisini taşır ve optimistic locking için
 * kullanılır.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE case_vehicle_owner_sets (
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      current_set_version integer NOT NULL DEFAULT 0,
      updated_by_user_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id,case_id),
      CONSTRAINT case_vehicle_owner_sets_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_owner_sets_actor_fk
        FOREIGN KEY (organization_id,updated_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_owner_sets_version_valid CHECK (current_set_version >= 0)
    );

    -- Bir satır = bir sahip; bir set_version = bir "sürüm" (tüm liste).
    -- Append-only: eski set_version'lar guard trigger ile korunur.
    CREATE TABLE case_vehicle_owners (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      set_version integer NOT NULL,
      ordinal integer NOT NULL,
      name text NOT NULL,
      phone text,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_vehicle_owners_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_owners_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_vehicle_owners_set_unique
        UNIQUE (organization_id,case_id,set_version,ordinal),
      CONSTRAINT case_vehicle_owners_valid CHECK (
        set_version >= 1
        AND ordinal >= 0
        AND char_length(btrim(name)) BETWEEN 1 AND 200
        AND name !~ '[[:cntrl:]]'
        -- Telefon DAİMA text: baştaki sıfır ve biçim korunur, sayıya çevrilmez.
        AND (phone IS NULL OR (
          char_length(phone) BETWEEN 3 AND 32
          AND phone ~ '^[0-9()+. -]+$'
          AND phone !~ '[[:cntrl:]]'
        ))
      )
    );
    CREATE INDEX case_vehicle_owners_case_set_idx
      ON case_vehicle_owners (organization_id,case_id,set_version,ordinal);

    CREATE FUNCTION case_vehicle_owners_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'case vehicle owner rows are immutable' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER case_vehicle_owners_guard
      BEFORE UPDATE OR DELETE ON case_vehicle_owners
      FOR EACH ROW EXECUTE FUNCTION case_vehicle_owners_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER case_vehicle_owners_guard ON case_vehicle_owners;
    DROP FUNCTION case_vehicle_owners_guard();
    DROP TABLE case_vehicle_owners;
    DROP TABLE case_vehicle_owner_sets;
  `)
}
