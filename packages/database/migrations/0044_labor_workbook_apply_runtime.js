/**
 * Paket 65B — onaylı İşçilik revision'ını güvenli workbook yazım job'ına bağlar.
 *
 * Fiziksel yol tutulmaz. Uygulama snapshot'ı ve satır referansları immutable;
 * preview/approval/sonuç alanları durum makinesi boyunca tek yönlü dolar.
 * Fiziksel yazım mevcut `jobs` queue/lease altyapısıyla yalnız File Agent'tadır.
 */
export const shorthands = undefined

const EXISTING_JOB_TYPES =
  "'verify_document','verify_photo','verify_case_location','provision_case_workspace'," +
  "'rename_case_workspace','move_case_workspace','cleanup_moved_workspace'," +
  "'extract_pdf_text','ocr_policy_pages'"
const EXISTING_TARGET_TYPES =
  "'document_version','photo','case_location','workspace_provisioning','file_operation'," +
  "'document_text_extraction','document_ocr_run'"

export function up(pgm) {
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: `type IN (${EXISTING_JOB_TYPES},'preview_labor_workbook_apply','apply_labor_workbook')`,
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: `target_type IN (${EXISTING_TARGET_TYPES},'labor_workbook_apply')`,
  })

  pgm.addConstraint(
    'labor_allocation_applications',
    'labor_allocation_applications_org_case_id_unique',
    { unique: ['organization_id', 'case_id', 'id'] },
  )
  pgm.addConstraint(
    'labor_excel_profile_versions',
    'labor_excel_profile_versions_org_profile_id_unique',
    { unique: ['organization_id', 'profile_id', 'id'] },
  )

  pgm.sql(`
    CREATE TABLE labor_workbook_apply_operations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations ON DELETE RESTRICT,
      case_id uuid NOT NULL,
      application_id uuid NOT NULL,
      revision_id uuid NOT NULL REFERENCES labor_sheet_versions ON DELETE RESTRICT,
      revision_version integer NOT NULL,
      profile_id uuid NOT NULL,
      profile_version_id uuid NOT NULL,
      profile_version integer NOT NULL,
      storage_root_key text NOT NULL,
      relative_workbook_path text NOT NULL,
      sheet_name text NOT NULL,
      rule_version text NOT NULL,
      approved_revision_snapshot_hash text NOT NULL,
      immutable_request_snapshot jsonb NOT NULL,
      status text NOT NULL DEFAULT 'preview_pending',
      version integer NOT NULL DEFAULT 1,
      source_workbook_hash text,
      preview_plan_hash text,
      preview_plan jsonb,
      previous_total_minor bigint,
      new_total_minor bigint NOT NULL,
      changed_row_count integer NOT NULL DEFAULT 0,
      unchanged_row_count integer NOT NULL DEFAULT 0,
      control_required_row_count integer NOT NULL DEFAULT 0,
      preview_job_id uuid REFERENCES jobs ON DELETE RESTRICT,
      apply_job_id uuid REFERENCES jobs ON DELETE RESTRICT,
      preview_idempotency_key text NOT NULL,
      approval_idempotency_key text,
      approved_by_user_id uuid,
      approved_at timestamptz,
      result_workbook_hash text,
      backup_file_name text,
      safe_error_code text,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,

      CONSTRAINT labor_workbook_apply_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_application_fk
        FOREIGN KEY (organization_id,case_id,application_id)
        REFERENCES labor_allocation_applications(organization_id,case_id,id)
        ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_profile_fk
        FOREIGN KEY (organization_id,profile_id)
        REFERENCES labor_excel_profiles(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_profile_version_fk
        FOREIGN KEY (organization_id,profile_id,profile_version_id)
        REFERENCES labor_excel_profile_versions(organization_id,profile_id,id)
        ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_approver_fk
        FOREIGN KEY (organization_id,approved_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_workbook_apply_valid CHECK (
        rule_version='labor-workbook-apply/1.0.0'
        AND status IN ('preview_pending','preview_ready','approved','applying',
          'completed','control_required','failed')
        AND revision_version>=1 AND profile_version>=1 AND version>=1
        AND approved_revision_snapshot_hash ~ '^[a-f0-9]{64}$'
        AND (source_workbook_hash IS NULL OR source_workbook_hash ~ '^[a-f0-9]{64}$')
        AND (preview_plan_hash IS NULL OR preview_plan_hash ~ '^[a-f0-9]{64}$')
        AND (result_workbook_hash IS NULL OR result_workbook_hash ~ '^[a-f0-9]{64}$')
        AND new_total_minor>=0
        AND (previous_total_minor IS NULL OR previous_total_minor>=0)
        AND changed_row_count>=0 AND unchanged_row_count>=0
        AND control_required_row_count>=0
        AND length(preview_idempotency_key) BETWEEN 1 AND 200
        AND (approval_idempotency_key IS NULL
          OR length(approval_idempotency_key) BETWEEN 1 AND 200)
        AND relative_workbook_path <> ''
        AND left(relative_workbook_path,1) <> '/'
        AND relative_workbook_path !~ '^[A-Za-z]:'
        AND relative_workbook_path !~ '(^|/)[.][.](/|$)'
        AND relative_workbook_path !~ '[<>:"|?*]'
        AND relative_workbook_path !~ '[[:cntrl:]]'
        AND strpos(relative_workbook_path,chr(92))=0
        AND lower(right(relative_workbook_path,5))='.xlsx'
        AND immutable_request_snapshot::text !~ '[A-Za-z]:'
        AND strpos(immutable_request_snapshot::text,chr(92))=0
        AND (
          (approved_by_user_id IS NULL AND approved_at IS NULL
            AND approval_idempotency_key IS NULL AND apply_job_id IS NULL)
          OR
          (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
            AND approval_idempotency_key IS NOT NULL AND apply_job_id IS NOT NULL)
        )
        AND (status<>'preview_pending' OR preview_job_id IS NOT NULL)
        AND (
          status<>'completed'
          OR (result_workbook_hash IS NOT NULL AND backup_file_name IS NOT NULL
            AND completed_at IS NOT NULL AND safe_error_code IS NULL)
        )
      )
    );

    CREATE UNIQUE INDEX labor_workbook_apply_preview_key_unique
      ON labor_workbook_apply_operations (organization_id,preview_idempotency_key);
    CREATE UNIQUE INDEX labor_workbook_apply_approval_key_unique
      ON labor_workbook_apply_operations (organization_id,approval_idempotency_key)
      WHERE approval_idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX labor_workbook_apply_preview_job_unique
      ON labor_workbook_apply_operations (preview_job_id)
      WHERE preview_job_id IS NOT NULL;
    CREATE UNIQUE INDEX labor_workbook_apply_apply_job_unique
      ON labor_workbook_apply_operations (apply_job_id)
      WHERE apply_job_id IS NOT NULL;
    CREATE INDEX labor_workbook_apply_case_idx
      ON labor_workbook_apply_operations (organization_id,case_id,created_at DESC);

    CREATE FUNCTION labor_workbook_apply_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor workbook apply operation cannot be deleted'
          USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.application_id IS DISTINCT FROM OLD.application_id
        OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
        OR NEW.revision_version IS DISTINCT FROM OLD.revision_version
        OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
        OR NEW.profile_version_id IS DISTINCT FROM OLD.profile_version_id
        OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
        OR NEW.storage_root_key IS DISTINCT FROM OLD.storage_root_key
        OR NEW.relative_workbook_path IS DISTINCT FROM OLD.relative_workbook_path
        OR NEW.sheet_name IS DISTINCT FROM OLD.sheet_name
        OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
        OR NEW.approved_revision_snapshot_hash IS DISTINCT FROM OLD.approved_revision_snapshot_hash
        OR NEW.immutable_request_snapshot IS DISTINCT FROM OLD.immutable_request_snapshot
        OR NEW.preview_job_id IS DISTINCT FROM OLD.preview_job_id
        OR NEW.preview_idempotency_key IS DISTINCT FROM OLD.preview_idempotency_key
        OR NEW.new_total_minor IS DISTINCT FROM OLD.new_total_minor
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'labor workbook apply identity is immutable'
          USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status IN ('completed','control_required','failed') THEN
        RAISE EXCEPTION 'terminal labor workbook apply operation is immutable'
          USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'labor workbook apply version must advance exactly once'
          USING ERRCODE='serialization_failure';
      END IF;
      RETURN NEW;
    END $$;

    CREATE TRIGGER labor_workbook_apply_guard
      BEFORE UPDATE OR DELETE ON labor_workbook_apply_operations
      FOR EACH ROW EXECUTE FUNCTION labor_workbook_apply_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER labor_workbook_apply_guard ON labor_workbook_apply_operations;
    DROP FUNCTION labor_workbook_apply_guard();
    DROP TABLE labor_workbook_apply_operations;
  `)
  pgm.dropConstraint(
    'labor_excel_profile_versions',
    'labor_excel_profile_versions_org_profile_id_unique',
  )
  pgm.dropConstraint(
    'labor_allocation_applications',
    'labor_allocation_applications_org_case_id_unique',
  )
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: `type IN (${EXISTING_JOB_TYPES})`,
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: `target_type IN (${EXISTING_TARGET_TYPES})`,
  })
}
