/**
 * Paket 58 — onaylı AI dağıtımının föye uygulanması (HB-2026-065).
 *
 * Paket 54 bilinçli olarak `applied: false` bıraktı: öneri föyü değiştirmiyordu
 * ve hangi dağılımın gerçekten onaylandığını gösteren bir kayıt yoktu. Bu
 * migration o boşluğu AYRI bir uygulama aggregate'iyle kapatır.
 *
 * Değişmezler:
 *  - Bir hedef föy sürümü yalnız BİR uygulama kaydına bağlanabilir.
 *  - Bir run yalnız BİR kez başarıyla uygulanabilir.
 *  - `completed` durumu hedef föy sürümü olmadan mümkün değildir.
 *  - `ai_allocation_applied` kaynak türüne sahip bir föy sürümü, commit anında
 *    tamamlanmış bir uygulama kaydına bağlı OLMAK ZORUNDADIR (deferred).
 *  - Uygulanan satır snapshot'ları immutable'dır.
 */
export const shorthands = undefined

export async function up(pgm) {
  // Kaynak türü: AI dağıtımının uygulandığı sürüm `manual_revision` diye
  // etiketlenemez; provenance yalanı Paket 57'de kapatılan hatanın aynısı olur.
  pgm.sql(`
    ALTER TABLE labor_sheet_versions
      DROP CONSTRAINT labor_sheet_versions_static_valid,
      DROP CONSTRAINT labor_sheet_versions_shape_valid;

    ALTER TABLE labor_sheet_versions
      ADD CONSTRAINT labor_sheet_versions_static_valid CHECK (
        currency='TRY'
        AND source_type IN ('user_entered','ai_assisted','manual_revision','ai_allocation_applied')
        AND sheet_version >= 1
      ),
      ADD CONSTRAINT labor_sheet_versions_shape_valid CHECK (
        (
          sheet_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL
          AND (
            (source_type='user_entered' AND labor_ai_suggestion_run_id IS NULL)
            OR
            (source_type='ai_assisted' AND labor_ai_suggestion_run_id IS NOT NULL)
          )
        )
        OR
        (
          sheet_version>1 AND previous_version_id IS NOT NULL
          AND length(revision_reason) BETWEEN 1 AND 500
          AND revision_reason ~ '[^[:space:]]'
          AND revision_reason !~ '[[:cntrl:]]'
          AND (
            (source_type='manual_revision' AND labor_ai_suggestion_run_id IS NULL)
            OR
            (source_type='ai_assisted' AND labor_ai_suggestion_run_id IS NOT NULL)
            OR
            (source_type='ai_allocation_applied' AND labor_ai_suggestion_run_id IS NULL)
          )
        )
      );
  `)

  pgm.sql(`
    CREATE TABLE labor_allocation_applications (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations ON DELETE RESTRICT,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      source_sheet_id uuid NOT NULL,
      source_sheet_version integer NOT NULL,
      target_sheet_version_id uuid,
      target_sheet_version integer,
      apply_schema_version text NOT NULL,
      status text NOT NULL DEFAULT 'running',
      selected_line_count integer NOT NULL,
      rejected_line_count integer NOT NULL,
      modified_line_count integer NOT NULL,
      control_required_line_count integer NOT NULL,
      idempotency_key text NOT NULL,
      safe_error_code text,
      applied_by_user_id uuid NOT NULL REFERENCES users ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,

      CONSTRAINT labor_allocation_applications_case_fk
        FOREIGN KEY (organization_id,case_id) REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_applications_run_fk
        FOREIGN KEY (organization_id,case_id,run_id)
        REFERENCES labor_allocation_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_applications_target_fk
        FOREIGN KEY (organization_id,case_id,source_sheet_id,target_sheet_version_id)
        REFERENCES labor_sheet_versions(organization_id,case_id,sheet_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_applications_valid CHECK (
        status IN ('running','completed','failed')
        AND apply_schema_version = 'labor-allocation-apply/1.0.0'
        AND source_sheet_version >= 1
        AND selected_line_count >= 1
        AND rejected_line_count >= 0
        AND modified_line_count >= 0
        AND modified_line_count <= selected_line_count
        AND control_required_line_count >= 0
        AND control_required_line_count <= selected_line_count
        AND length(idempotency_key) BETWEEN 1 AND 200
        -- completed yalnız gerçek bir hedef föy sürümüyle mümkündür.
        AND (
          (status='completed'
            AND target_sheet_version_id IS NOT NULL
            AND target_sheet_version IS NOT NULL
            AND target_sheet_version > source_sheet_version
            AND completed_at IS NOT NULL
            AND safe_error_code IS NULL)
          OR
          (status<>'completed'
            AND target_sheet_version_id IS NULL
            AND target_sheet_version IS NULL
            AND completed_at IS NULL)
        )
      )
    );

    -- Bir hedef föy sürümü yalnız bir uygulama kaydına aittir.
    CREATE UNIQUE INDEX labor_allocation_applications_target_unique
      ON labor_allocation_applications (organization_id,target_sheet_version_id)
      WHERE target_sheet_version_id IS NOT NULL;

    -- Aynı run ikinci kez BAŞARIYLA uygulanamaz; başarısız deneme tekrarlanabilir.
    CREATE UNIQUE INDEX labor_allocation_applications_run_unique
      ON labor_allocation_applications (organization_id,run_id)
      WHERE status='completed';

    CREATE UNIQUE INDEX labor_allocation_applications_idempotency_unique
      ON labor_allocation_applications (organization_id,idempotency_key);

    CREATE INDEX labor_allocation_applications_case_idx
      ON labor_allocation_applications (organization_id,case_id,created_at DESC);
  `)

  pgm.sql(`
    CREATE TABLE labor_allocation_applied_lines (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations ON DELETE RESTRICT,
      application_id uuid NOT NULL REFERENCES labor_allocation_applications ON DELETE RESTRICT,
      line_ordinal integer NOT NULL,
      -- Kaynak öneri satırı ile hedef föy satırının bağlantısı.
      suggestion_line_ordinal integer NOT NULL,
      target_line_ordinal integer NOT NULL,
      suggested_description text NOT NULL,
      suggested_action text NOT NULL,
      suggested_part_amount_minor bigint NOT NULL,
      suggested_labor_amount_minor bigint NOT NULL,
      suggested_operation_types text[] NOT NULL,
      applied_description text NOT NULL,
      applied_action text NOT NULL,
      applied_part_amount_minor bigint NOT NULL,
      applied_labor_amount_minor bigint NOT NULL,
      modified boolean NOT NULL,
      control_required boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT labor_allocation_applied_lines_unique
        UNIQUE (application_id,line_ordinal),
      CONSTRAINT labor_allocation_applied_lines_valid CHECK (
        line_ordinal >= 1
        AND suggestion_line_ordinal >= 1
        AND target_line_ordinal >= 1
        AND suggested_part_amount_minor >= 0
        AND suggested_labor_amount_minor >= 0
        AND applied_part_amount_minor >= 0
        AND applied_labor_amount_minor >= 0
        AND applied_part_amount_minor + applied_labor_amount_minor > 0
        AND cardinality(suggested_operation_types) >= 1
        AND length(applied_description) BETWEEN 1 AND 200
        AND length(applied_action) BETWEEN 1 AND 120
        -- modified bayrağı snapshot'larla tutarlı olmalıdır; "değişmedi" denip
        -- farklı değer saklanamaz.
        AND modified = (
          suggested_description <> applied_description
          OR suggested_action <> applied_action
          OR suggested_part_amount_minor <> applied_part_amount_minor
          OR suggested_labor_amount_minor <> applied_labor_amount_minor
        )
      )
    );

    CREATE INDEX labor_allocation_applied_lines_application_idx
      ON labor_allocation_applied_lines (organization_id,application_id,line_ordinal);
  `)

  // Uygulama kaydı ve satırları append-only; tamamlandıktan sonra dokunulamaz.
  pgm.sql(`
    CREATE FUNCTION labor_allocation_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor allocation application is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.source_sheet_id IS DISTINCT FROM OLD.source_sheet_id
        OR NEW.source_sheet_version IS DISTINCT FROM OLD.source_sheet_version
        OR NEW.apply_schema_version IS DISTINCT FROM OLD.apply_schema_version
        OR NEW.selected_line_count IS DISTINCT FROM OLD.selected_line_count
        OR NEW.rejected_line_count IS DISTINCT FROM OLD.rejected_line_count
        OR NEW.modified_line_count IS DISTINCT FROM OLD.modified_line_count
        OR NEW.control_required_line_count IS DISTINCT FROM OLD.control_required_line_count
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.applied_by_user_id IS DISTINCT FROM OLD.applied_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'labor allocation application identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status <> 'running' THEN
        RAISE EXCEPTION 'terminal labor allocation application is immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;

    CREATE TRIGGER labor_allocation_application_guard
      BEFORE UPDATE OR DELETE ON labor_allocation_applications
      FOR EACH ROW EXECUTE FUNCTION labor_allocation_application_guard();

    CREATE FUNCTION labor_allocation_applied_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE application_status text;
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'applied allocation line is immutable' USING ERRCODE='restrict_violation';
      END IF;
      SELECT status INTO application_status
        FROM labor_allocation_applications WHERE id=NEW.application_id;
      IF application_status IS DISTINCT FROM 'running' THEN
        RAISE EXCEPTION 'applied allocation line requires running application'
          USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;

    CREATE TRIGGER labor_allocation_applied_line_guard
      BEFORE INSERT OR UPDATE OR DELETE ON labor_allocation_applied_lines
      FOR EACH ROW EXECUTE FUNCTION labor_allocation_applied_line_guard();
  `)

  // Ters yön: `ai_allocation_applied` etiketli bir föy sürümü, commit anında
  // tamamlanmış bir uygulama kaydına bağlı olmalıdır. Deferred olduğu için
  // sürüm önce, provenance sonra yazılabilir; ikisi de aynı transaction'da.
  pgm.sql(`
    CREATE FUNCTION labor_sheet_version_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE provenance_count integer;
    BEGIN
      IF NEW.source_type <> 'ai_allocation_applied' THEN RETURN NEW; END IF;
      SELECT count(*)::int INTO provenance_count
        FROM labor_allocation_applications
       WHERE target_sheet_version_id=NEW.id AND status='completed';
      IF provenance_count <> 1 THEN
        RAISE EXCEPTION 'ai allocation sheet version requires completed application provenance'
          USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;

    CREATE CONSTRAINT TRIGGER labor_sheet_version_application_guard
      AFTER INSERT ON labor_sheet_versions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION labor_sheet_version_application_guard();
  `)
}

export async function down(pgm) {
  pgm.sql(`
    DROP TRIGGER labor_sheet_version_application_guard ON labor_sheet_versions;
    DROP FUNCTION labor_sheet_version_application_guard();
    DROP TRIGGER labor_allocation_applied_line_guard ON labor_allocation_applied_lines;
    DROP FUNCTION labor_allocation_applied_line_guard();
    DROP TRIGGER labor_allocation_application_guard ON labor_allocation_applications;
    DROP FUNCTION labor_allocation_application_guard();
    DROP TABLE labor_allocation_applied_lines;
    DROP TABLE labor_allocation_applications;
  `)

  pgm.sql(`
    ALTER TABLE labor_sheet_versions
      DROP CONSTRAINT labor_sheet_versions_static_valid,
      DROP CONSTRAINT labor_sheet_versions_shape_valid;

    ALTER TABLE labor_sheet_versions
      ADD CONSTRAINT labor_sheet_versions_static_valid CHECK (
        currency='TRY'
        AND source_type IN ('user_entered','ai_assisted','manual_revision')
        AND sheet_version >= 1
      ),
      ADD CONSTRAINT labor_sheet_versions_shape_valid CHECK (
        (
          sheet_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL
          AND (
            (source_type='user_entered' AND labor_ai_suggestion_run_id IS NULL)
            OR
            (source_type='ai_assisted' AND labor_ai_suggestion_run_id IS NOT NULL)
          )
        )
        OR
        (
          sheet_version>1 AND previous_version_id IS NOT NULL
          AND length(revision_reason) BETWEEN 1 AND 500
          AND revision_reason ~ '[^[:space:]]'
          AND revision_reason !~ '[[:cntrl:]]'
          AND (
            (source_type='manual_revision' AND labor_ai_suggestion_run_id IS NULL)
            OR
            (source_type='ai_assisted' AND labor_ai_suggestion_run_id IS NOT NULL)
          )
        )
      );
  `)
}
