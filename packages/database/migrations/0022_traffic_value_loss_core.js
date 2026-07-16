/**
 * Paket 32 - 01.07.2026 Trafik deger kaybi piyasa farki cekirdegi.
 *
 * Eski Ek-1 katsayi formulu saklanmaz/uygulanmaz. Input ve sonuc snapshot'lari
 * surumlu; kanit, emsal ve insan karar gecmisi append-only'dir.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE traffic_value_loss_assessments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      case_id uuid NOT NULL,
      current_version_id uuid,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT traffic_value_loss_assessments_case_fk FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE CASCADE,
      CONSTRAINT traffic_value_loss_assessments_creator_fk FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_assessments_case_unique UNIQUE (organization_id,case_id),
      CONSTRAINT traffic_value_loss_assessments_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT traffic_value_loss_assessments_version_positive CHECK (version>=1)
    );

    CREATE TABLE traffic_value_loss_versions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      assessment_id uuid NOT NULL,
      assessment_version integer NOT NULL,
      status text NOT NULL,
      rule_set_id text NOT NULL,
      rule_version text NOT NULL,
      effective_from date NOT NULL,
      evaluated_on date NOT NULL,
      input_snapshot jsonb NOT NULL,
      result_snapshot jsonb NOT NULL,
      result_code text NOT NULL,
      human_approval_status text NOT NULL DEFAULT 'pending',
      approved_by_user_id uuid,
      approved_at timestamptz,
      approval_reason text,
      is_active boolean NOT NULL DEFAULT false,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT traffic_value_loss_versions_assessment_fk FOREIGN KEY (organization_id,case_id,assessment_id)
        REFERENCES traffic_value_loss_assessments(organization_id,case_id,id) ON DELETE CASCADE,
      CONSTRAINT traffic_value_loss_versions_creator_fk FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_versions_approver_fk FOREIGN KEY (organization_id,approved_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_versions_number_unique UNIQUE (assessment_id,assessment_version),
      CONSTRAINT traffic_value_loss_versions_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT traffic_value_loss_versions_status_valid CHECK (status IN ('draft','control_required','awaiting_approval','approved','rejected','superseded')),
      CONSTRAINT traffic_value_loss_versions_result_valid CHECK (result_code IN ('calculable','no_value_loss','not_applicable','control_required')),
      CONSTRAINT traffic_value_loss_versions_rule_locked CHECK (
        rule_set_id='traffic-value-loss-market-difference'
        AND rule_version='2026.07.01.1'
        AND effective_from=DATE '2026-07-01'
      ),
      CONSTRAINT traffic_value_loss_versions_snapshot_bounded CHECK (
        jsonb_typeof(input_snapshot)='object' AND pg_column_size(input_snapshot)<=200000
        AND jsonb_typeof(result_snapshot)='object' AND pg_column_size(result_snapshot)<=200000
      ),
      CONSTRAINT traffic_value_loss_versions_approval_valid CHECK (
        (human_approval_status='pending' AND approved_by_user_id IS NULL AND approved_at IS NULL)
        OR (human_approval_status IN ('approved','rejected') AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
      ),
      CONSTRAINT traffic_value_loss_versions_active_approved CHECK (is_active=false OR status='approved'),
      CONSTRAINT traffic_value_loss_versions_positive CHECK (assessment_version>=1),
      CONSTRAINT traffic_value_loss_versions_reason_bounded CHECK (approval_reason IS NULL OR char_length(btrim(approval_reason)) BETWEEN 1 AND 500)
    );
    CREATE UNIQUE INDEX traffic_value_loss_one_active_approved
      ON traffic_value_loss_versions(organization_id,case_id)
      WHERE status='approved' AND is_active=true;
    CREATE INDEX traffic_value_loss_versions_case_idx
      ON traffic_value_loss_versions(organization_id,case_id,assessment_version DESC);
    ALTER TABLE traffic_value_loss_assessments
      ADD CONSTRAINT traffic_value_loss_assessments_current_fk
      FOREIGN KEY (organization_id,case_id,current_version_id)
      REFERENCES traffic_value_loss_versions(organization_id,case_id,id) ON DELETE RESTRICT;

    CREATE TABLE traffic_value_loss_evidence (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      version_id uuid NOT NULL,
      evidence_key text NOT NULL,
      source_type text NOT NULL,
      document_id uuid,
      document_version_id uuid,
      external_reference text,
      source_hash text NOT NULL,
      observed_at date,
      supports text[] NOT NULL,
      verification_status text NOT NULL,
      conflict boolean NOT NULL DEFAULT false,
      notes text,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT traffic_value_loss_evidence_version_fk FOREIGN KEY (organization_id,case_id,version_id)
        REFERENCES traffic_value_loss_versions(organization_id,case_id,id) ON DELETE CASCADE,
      CONSTRAINT traffic_value_loss_evidence_document_fk FOREIGN KEY (organization_id,case_id,document_id)
        REFERENCES documents(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_evidence_document_version_fk FOREIGN KEY (organization_id,case_id,document_version_id)
        REFERENCES document_versions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_evidence_creator_fk FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_evidence_key_unique UNIQUE (version_id,evidence_key),
      CONSTRAINT traffic_value_loss_evidence_tenant_id_unique UNIQUE (organization_id,case_id,version_id,id),
      CONSTRAINT traffic_value_loss_evidence_type_valid CHECK (source_type IN ('document_version','market_comparable','sbm_history','expert_observation')),
      CONSTRAINT traffic_value_loss_evidence_shape_valid CHECK (
        (source_type='document_version' AND document_id IS NOT NULL AND document_version_id IS NOT NULL AND external_reference IS NULL)
        OR (source_type<>'document_version' AND document_id IS NULL AND document_version_id IS NULL
          AND (
            (external_reference LIKE 'https://%' AND external_reference !~ E'[\\\\]' AND external_reference !~ '[[:cntrl:]]')
            OR (
              external_reference ~ '^ref:[A-Za-z0-9][A-Za-z0-9._/-]*$'
              AND position('..' in external_reference)=0
            )
          ))
      ),
      CONSTRAINT traffic_value_loss_evidence_hash_valid CHECK (source_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT traffic_value_loss_evidence_supports_valid CHECK (
        cardinality(supports) BETWEEN 1 AND 20
        AND supports <@ ARRAY['vehicle_identity','mileage','usage_type','damage_parts','prior_damage','pre_accident_market_value','post_repair_market_value','fault_rate','heavy_damage_status']::text[]
      ),
      CONSTRAINT traffic_value_loss_evidence_verification_valid CHECK (verification_status IN ('verified','control_required')),
      CONSTRAINT traffic_value_loss_evidence_text_bounded CHECK (
        char_length(evidence_key) BETWEEN 1 AND 100
        AND evidence_key ~ '^[A-Za-z0-9._-]+$'
        AND (external_reference IS NULL OR char_length(external_reference)<=500)
        AND (notes IS NULL OR char_length(btrim(notes)) BETWEEN 1 AND 500)
      )
    );

    CREATE TABLE traffic_value_loss_comparables (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      version_id uuid NOT NULL,
      comparable_key text NOT NULL,
      side text NOT NULL,
      amount_minor bigint NOT NULL,
      mileage integer,
      observed_at date NOT NULL,
      evidence_id uuid NOT NULL,
      excluded boolean NOT NULL DEFAULT false,
      exclusion_reason text,
      CONSTRAINT traffic_value_loss_comparables_version_fk FOREIGN KEY (organization_id,case_id,version_id)
        REFERENCES traffic_value_loss_versions(organization_id,case_id,id) ON DELETE CASCADE,
      CONSTRAINT traffic_value_loss_comparables_evidence_fk FOREIGN KEY (organization_id,case_id,version_id,evidence_id)
        REFERENCES traffic_value_loss_evidence(organization_id,case_id,version_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_comparables_key_unique UNIQUE (version_id,comparable_key),
      CONSTRAINT traffic_value_loss_comparables_side_valid CHECK (side IN ('pre_accident','post_repair')),
      CONSTRAINT traffic_value_loss_comparables_numbers_valid CHECK (
        amount_minor BETWEEN 0 AND 9007199254740991
        AND (mileage IS NULL OR mileage BETWEEN 0 AND 10000000)
      ),
      CONSTRAINT traffic_value_loss_comparables_exclusion_valid CHECK (
        (excluded=false AND exclusion_reason IS NULL)
        OR (excluded=true AND char_length(btrim(exclusion_reason)) BETWEEN 1 AND 500)
      ),
      CONSTRAINT traffic_value_loss_comparables_key_valid CHECK (
        char_length(comparable_key) BETWEEN 1 AND 100 AND comparable_key ~ '^[A-Za-z0-9._-]+$'
      )
    );

    CREATE TABLE traffic_value_loss_approval_events (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      assessment_id uuid NOT NULL,
      version_id uuid NOT NULL,
      action text NOT NULL,
      actor_user_id uuid NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT traffic_value_loss_approval_events_assessment_fk FOREIGN KEY (organization_id,case_id,assessment_id)
        REFERENCES traffic_value_loss_assessments(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_approval_events_version_fk FOREIGN KEY (organization_id,case_id,version_id)
        REFERENCES traffic_value_loss_versions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_approval_events_actor_fk FOREIGN KEY (organization_id,actor_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_approval_events_action_valid CHECK (action IN ('submitted','approved','rejected')),
      CONSTRAINT traffic_value_loss_approval_events_reason_valid CHECK (
        (action='rejected' AND char_length(btrim(reason)) BETWEEN 1 AND 500)
        OR (action<>'rejected' AND (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500))
      )
    );

    CREATE FUNCTION traffic_value_loss_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'traffic value loss evidence/history is append-only' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER traffic_value_loss_evidence_append_guard BEFORE UPDATE OR DELETE ON traffic_value_loss_evidence
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_append_guard();
    CREATE TRIGGER traffic_value_loss_comparables_append_guard BEFORE UPDATE OR DELETE ON traffic_value_loss_comparables
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_append_guard();
    CREATE TRIGGER traffic_value_loss_approval_events_append_guard BEFORE UPDATE OR DELETE ON traffic_value_loss_approval_events
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_append_guard();

    CREATE FUNCTION traffic_value_loss_terminal_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_version uuid; terminal boolean;
    BEGIN
      target_version := CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
      SELECT status IN ('approved','superseded') INTO terminal FROM traffic_value_loss_versions WHERE id=target_version;
      IF terminal THEN RAISE EXCEPTION 'approved traffic value loss facts are immutable' USING ERRCODE='restrict_violation'; END IF;
      RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END $$;
    CREATE TRIGGER traffic_value_loss_evidence_terminal_guard BEFORE INSERT ON traffic_value_loss_evidence
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_terminal_fact_guard();
    CREATE TRIGGER traffic_value_loss_comparables_terminal_guard BEFORE INSERT ON traffic_value_loss_comparables
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_terminal_fact_guard();

    CREATE FUNCTION traffic_value_loss_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id
        OR NEW.assessment_id<>OLD.assessment_id OR NEW.created_by_user_id<>OLD.created_by_user_id
        OR NEW.created_at<>OLD.created_at THEN
        RAISE EXCEPTION 'traffic value loss version identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status='superseded' THEN
        RAISE EXCEPTION 'superseded traffic value loss version is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status='approved' AND NOT (
        NEW.status='superseded' AND NEW.is_active=false
        AND NEW.input_snapshot=OLD.input_snapshot AND NEW.result_snapshot=OLD.result_snapshot
        AND NEW.rule_set_id=OLD.rule_set_id AND NEW.rule_version=OLD.rule_version
        AND NEW.human_approval_status=OLD.human_approval_status
        AND NEW.approved_by_user_id=OLD.approved_by_user_id AND NEW.approved_at=OLD.approved_at
        AND NEW.approval_reason IS NOT DISTINCT FROM OLD.approval_reason
      ) THEN
        RAISE EXCEPTION 'approved traffic value loss version is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.input_snapshot<>OLD.input_snapshot OR NEW.result_snapshot<>OLD.result_snapshot
        OR NEW.rule_set_id<>OLD.rule_set_id OR NEW.rule_version<>OLD.rule_version
        OR NEW.effective_from<>OLD.effective_from OR NEW.evaluated_on<>OLD.evaluated_on
        OR NEW.result_code<>OLD.result_code OR NEW.assessment_version<>OLD.assessment_version THEN
        RAISE EXCEPTION 'traffic value loss calculation facts are immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='approved' THEN
        IF OLD.status<>'awaiting_approval' OR NEW.human_approval_status<>'approved'
          OR NEW.approved_by_user_id IS NULL OR NEW.approved_at IS NULL
          OR coalesce((NEW.result_snapshot->>'canSubmitForApproval')::boolean,false)<>true THEN
          RAISE EXCEPTION 'traffic value loss approval prerequisites are not met' USING ERRCODE='check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER traffic_value_loss_version_guard BEFORE UPDATE ON traffic_value_loss_versions
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_version_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER traffic_value_loss_version_guard ON traffic_value_loss_versions;
    DROP FUNCTION traffic_value_loss_version_guard();
    DROP TRIGGER traffic_value_loss_comparables_terminal_guard ON traffic_value_loss_comparables;
    DROP TRIGGER traffic_value_loss_evidence_terminal_guard ON traffic_value_loss_evidence;
    DROP FUNCTION traffic_value_loss_terminal_fact_guard();
    DROP TRIGGER traffic_value_loss_approval_events_append_guard ON traffic_value_loss_approval_events;
    DROP TRIGGER traffic_value_loss_comparables_append_guard ON traffic_value_loss_comparables;
    DROP TRIGGER traffic_value_loss_evidence_append_guard ON traffic_value_loss_evidence;
    DROP FUNCTION traffic_value_loss_append_guard();
    DROP TABLE traffic_value_loss_approval_events;
    DROP TABLE traffic_value_loss_comparables;
    DROP TABLE traffic_value_loss_evidence;
    ALTER TABLE traffic_value_loss_assessments DROP CONSTRAINT traffic_value_loss_assessments_current_fk;
    DROP TABLE traffic_value_loss_versions;
    DROP TABLE traffic_value_loss_assessments;
  `)
}
