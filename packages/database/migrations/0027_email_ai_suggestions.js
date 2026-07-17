/* Paket 42: kullanıcı kontrollü AI e-posta önerisi, ortak bütçe ve usage ledger genişlemesi. */
export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_provider_policies
      ADD COLUMN email_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN email_allowed_provider_ids text[] NOT NULL DEFAULT '{}';
    ALTER TABLE ai_provider_policies
      ADD CONSTRAINT ai_provider_policies_email_provider_valid CHECK (
        email_allowed_provider_ids <@ ARRAY[
          'deterministic-success',
          'deterministic-invalid-schema',
          'deterministic-timeout',
          'deterministic-failure',
          'gemini-generate-content'
        ]::text[]
      );

    CREATE TABLE email_ai_suggestion_runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      draft_type text NOT NULL,
      base_preview_hash text NOT NULL,
      plan_hash text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      prompt_template_version text NOT NULL,
      output_schema_version text NOT NULL,
      status text NOT NULL DEFAULT 'running',
      external_provider boolean NOT NULL,
      privacy_policy_version text NOT NULL,
      outbound_payload_hash text,
      outbound_input_characters integer NOT NULL,
      redacted_value_count integer NOT NULL DEFAULT 0,
      redacted_categories text[] NOT NULL DEFAULT '{}',
      privacy_warnings text[] NOT NULL DEFAULT '{}',
      provider_retention_mode text NOT NULL,
      pricing_version text NOT NULL,
      estimated_cost_minor bigint NOT NULL,
      actual_cost_minor bigint,
      subject_suffix text,
      body text,
      reasoning text,
      output_warnings text[],
      confidence numeric(5,4),
      safe_error_code text,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      CONSTRAINT email_ai_suggestion_runs_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT email_ai_suggestion_runs_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT email_ai_suggestion_runs_org_case_id_unique
        UNIQUE (organization_id,case_id,id),
      CONSTRAINT email_ai_suggestion_runs_identity_unique
        UNIQUE (
          organization_id,case_id,plan_hash,provider_id,provider_version,model_id,
          prompt_template_version,output_schema_version
        ),
      CONSTRAINT email_ai_suggestion_runs_valid CHECK (
        draft_type IN (
          'repair_approval_request','missing_document_request','preliminary_report_notice',
          'service_change_notice','deductible_service_part_notice','portal_deductible_note',
          'closure_documents_request','case_status_update','recourse_documents_request',
          'pert_evaluation_notice','custom_instruction'
        )
        AND base_preview_hash ~ '^[a-f0-9]{64}$'
        AND plan_hash ~ '^[a-f0-9]{64}$'
        AND provider_id IN (
          'deterministic-success','deterministic-invalid-schema','deterministic-timeout',
          'deterministic-failure','gemini-generate-content'
        )
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND prompt_template_version='email-ai-draft/1.0.0'
        AND output_schema_version='email-ai-suggestion/1.0.0'
        AND status IN (
          'provider_disabled','budget_blocked','running','review_required',
          'failed','outcome_unknown'
        )
        AND outbound_input_characters BETWEEN 1 AND 200000
        AND redacted_value_count BETWEEN 0 AND 10000
        AND redacted_categories <@ ARRAY[
          'address','email','iban','name','phone','plate','reference_number',
          'tax_identity','turkish_identity','vehicle_identity'
        ]::text[]
        AND cardinality(privacy_warnings) BETWEEN 0 AND 20
        AND provider_retention_mode IN ('local_only','store_false','free_tier_product_improvement')
        AND char_length(pricing_version) BETWEEN 1 AND 80
        AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
        AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
        AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
        AND version>=1
        AND (
          (
            external_provider
            AND provider_id='gemini-generate-content'
            AND privacy_policy_version='email-ai-pii-redaction/1.0.0'
            AND outbound_payload_hash ~ '^[a-f0-9]{64}$'
            AND provider_retention_mode='free_tier_product_improvement'
          )
          OR
          (
            NOT external_provider
            AND provider_id LIKE 'deterministic-%'
            AND privacy_policy_version='email-ai-pii/local-only'
            AND outbound_payload_hash IS NULL
            AND redacted_value_count=0
            AND cardinality(redacted_categories)=0
            AND provider_retention_mode='local_only'
          )
        )
        AND (
          (
            status='running'
            AND subject_suffix IS NULL AND body IS NULL AND reasoning IS NULL
            AND output_warnings IS NULL AND confidence IS NULL
            AND safe_error_code IS NULL AND completed_at IS NULL AND started_at IS NOT NULL
          )
          OR
          (
            status='review_required'
            AND char_length(subject_suffix) BETWEEN 1 AND 120
            AND char_length(body) BETWEEN 1 AND 20000
            AND char_length(reasoning) BETWEEN 1 AND 500
            AND cardinality(output_warnings) BETWEEN 0 AND 10
            AND confidence BETWEEN 0 AND 1
            AND safe_error_code IS NULL AND completed_at IS NOT NULL
          )
          OR
          (
            status IN ('provider_disabled','budget_blocked','failed','outcome_unknown')
            AND subject_suffix IS NULL AND body IS NULL AND reasoning IS NULL
            AND output_warnings IS NULL AND confidence IS NULL
            AND safe_error_code IS NOT NULL AND completed_at IS NOT NULL
          )
        )
      )
    );
    CREATE INDEX email_ai_suggestion_runs_case_created_idx
      ON email_ai_suggestion_runs (organization_id,case_id,created_at DESC);

    CREATE TABLE email_ai_provider_receipts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      email_suggestion_run_id uuid NOT NULL,
      request_hash text NOT NULL,
      idempotency_request_hash text NOT NULL,
      client_request_id text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      status text NOT NULL DEFAULT 'dispatch_reserved',
      result_kind text,
      provider_response_id text,
      provider_request_id text,
      canonical_output jsonb,
      canonical_output_hash text,
      input_characters integer NOT NULL,
      output_characters integer,
      input_tokens integer,
      output_tokens integer,
      estimated_cost_minor bigint NOT NULL,
      actual_cost_minor bigint,
      pricing_version text NOT NULL,
      safe_error_code text,
      created_by_user_id uuid NOT NULL,
      request_id text NOT NULL,
      dispatch_started_at timestamptz NOT NULL DEFAULT now(),
      response_received_at timestamptz,
      finalized_at timestamptz,
      CONSTRAINT email_ai_provider_receipts_run_fk
        FOREIGN KEY (organization_id,case_id,email_suggestion_run_id)
        REFERENCES email_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT email_ai_provider_receipts_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT email_ai_provider_receipts_run_request_unique
        UNIQUE (organization_id,email_suggestion_run_id,request_hash),
      CONSTRAINT email_ai_provider_receipts_client_request_unique
        UNIQUE (organization_id,client_request_id),
      CONSTRAINT email_ai_provider_receipts_valid CHECK (
        request_hash ~ '^[a-f0-9]{64}$'
        AND idempotency_request_hash ~ '^[a-f0-9]{64}$'
        AND client_request_id ~ '^[a-f0-9]{64}$'
        AND char_length(provider_id) BETWEEN 1 AND 80
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND status IN ('dispatch_reserved','response_recorded','outcome_unknown','finalized')
        AND (result_kind IS NULL OR result_kind IN ('success','failure'))
        AND (provider_response_id IS NULL OR char_length(provider_response_id) BETWEEN 1 AND 200)
        AND (provider_request_id IS NULL OR char_length(provider_request_id) BETWEEN 1 AND 512)
        AND (canonical_output IS NULL OR pg_column_size(canonical_output)<=100000)
        AND (canonical_output_hash IS NULL OR canonical_output_hash ~ '^[a-f0-9]{64}$')
        AND input_characters BETWEEN 0 AND 200000
        AND (output_characters IS NULL OR output_characters BETWEEN 0 AND 1000000)
        AND (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 1000000)
        AND (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 1000000)
        AND ((input_tokens IS NULL)=(output_tokens IS NULL))
        AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
        AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
        AND char_length(pricing_version) BETWEEN 1 AND 80
        AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
        AND char_length(request_id) BETWEEN 1 AND 128
        AND (
          (
            status='dispatch_reserved' AND result_kind IS NULL
            AND canonical_output IS NULL AND canonical_output_hash IS NULL
            AND response_received_at IS NULL AND finalized_at IS NULL
          )
          OR
          (
            status='response_recorded' AND result_kind IS NOT NULL
            AND response_received_at IS NOT NULL AND finalized_at IS NULL
            AND (
              (result_kind='success' AND canonical_output IS NOT NULL
                AND canonical_output_hash IS NOT NULL AND safe_error_code IS NULL)
              OR
              (result_kind='failure' AND canonical_output IS NULL
                AND canonical_output_hash IS NULL AND safe_error_code IS NOT NULL)
            )
          )
          OR
          (
            status='outcome_unknown' AND result_kind='failure'
            AND canonical_output IS NULL AND canonical_output_hash IS NULL
            AND safe_error_code='AI_PROVIDER_OUTCOME_UNKNOWN'
            AND finalized_at IS NOT NULL
          )
          OR
          (
            status='finalized' AND result_kind IS NOT NULL
            AND response_received_at IS NOT NULL AND finalized_at IS NOT NULL
          )
        )
      )
    );
    CREATE INDEX email_ai_provider_receipts_active_budget_idx
      ON email_ai_provider_receipts (organization_id,dispatch_started_at)
      WHERE status IN ('dispatch_reserved','response_recorded','outcome_unknown');

    ALTER TABLE email_draft_versions
      ADD COLUMN email_ai_suggestion_run_id uuid;
    ALTER TABLE email_draft_versions
      ADD CONSTRAINT email_draft_versions_ai_suggestion_fk
        FOREIGN KEY (organization_id,case_id,email_ai_suggestion_run_id)
        REFERENCES email_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT;
    ALTER TABLE email_draft_versions
      DROP CONSTRAINT email_draft_versions_static_valid,
      DROP CONSTRAINT email_draft_versions_shape_valid;
    ALTER TABLE email_draft_versions
      ADD CONSTRAINT email_draft_versions_static_valid CHECK (
        template_version='email-draft-template/1.0.0'
        AND source_type IN ('deterministic_template','ai_assisted','manual_revision')
        AND preview_hash ~ '^[a-f0-9]{64}$'
        AND draft_version >= 1
      ),
      ADD CONSTRAINT email_draft_versions_shape_valid CHECK (
        (
          draft_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL
          AND (
            (source_type='deterministic_template' AND email_ai_suggestion_run_id IS NULL)
            OR
            (source_type='ai_assisted' AND email_ai_suggestion_run_id IS NOT NULL)
          )
        )
        OR
        (
          draft_version>1 AND previous_version_id IS NOT NULL
          AND source_type='manual_revision' AND email_ai_suggestion_run_id IS NULL
          AND length(revision_reason) BETWEEN 1 AND 500
          AND revision_reason ~ '[^[:space:]]'
          AND revision_reason !~ '[[:cntrl:]]'
        )
      );

    ALTER TABLE ai_usage_ledger
      ADD COLUMN usage_module text NOT NULL DEFAULT 'policy_analysis',
      ADD COLUMN email_suggestion_run_id uuid;
    ALTER TABLE ai_usage_ledger ALTER COLUMN run_id DROP NOT NULL;
    ALTER TABLE ai_usage_ledger
      ADD CONSTRAINT ai_usage_ledger_email_run_fk
        FOREIGN KEY (organization_id,case_id,email_suggestion_run_id)
        REFERENCES email_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT;
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_request_unique;
    CREATE UNIQUE INDEX ai_usage_ledger_policy_request_unique
      ON ai_usage_ledger (organization_id,run_id,request_hash,status)
      WHERE usage_module='policy_analysis';
    CREATE UNIQUE INDEX ai_usage_ledger_email_request_unique
      ON ai_usage_ledger (organization_id,email_suggestion_run_id,request_hash,status)
      WHERE usage_module='email_draft';
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_valid;
    ALTER TABLE ai_usage_ledger ADD CONSTRAINT ai_usage_ledger_valid CHECK (
      request_hash ~ '^[a-f0-9]{64}$'
      AND input_characters BETWEEN 0 AND 200000
      AND output_characters BETWEEN 0 AND 1000000
      AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
      AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
      AND status IN ('provider_disabled','budget_blocked','completed','failed','cancelled')
      AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
      AND (
        (usage_module='policy_analysis' AND run_id IS NOT NULL AND email_suggestion_run_id IS NULL)
        OR
        (usage_module='email_draft' AND run_id IS NULL AND email_suggestion_run_id IS NOT NULL)
      )
    );

    CREATE FUNCTION email_ai_suggestion_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'email AI suggestion run is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.draft_type IS DISTINCT FROM OLD.draft_type
        OR NEW.base_preview_hash IS DISTINCT FROM OLD.base_preview_hash
        OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash
        OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
        OR NEW.provider_version IS DISTINCT FROM OLD.provider_version
        OR NEW.model_id IS DISTINCT FROM OLD.model_id
        OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version
        OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version
        OR NEW.external_provider IS DISTINCT FROM OLD.external_provider
        OR NEW.privacy_policy_version IS DISTINCT FROM OLD.privacy_policy_version
        OR NEW.outbound_payload_hash IS DISTINCT FROM OLD.outbound_payload_hash
        OR NEW.outbound_input_characters IS DISTINCT FROM OLD.outbound_input_characters
        OR NEW.redacted_value_count IS DISTINCT FROM OLD.redacted_value_count
        OR NEW.redacted_categories IS DISTINCT FROM OLD.redacted_categories
        OR NEW.privacy_warnings IS DISTINCT FROM OLD.privacy_warnings
        OR NEW.provider_retention_mode IS DISTINCT FROM OLD.provider_retention_mode
        OR NEW.pricing_version IS DISTINCT FROM OLD.pricing_version
        OR NEW.estimated_cost_minor IS DISTINCT FROM OLD.estimated_cost_minor
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'email AI suggestion identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status<>'running' THEN
        RAISE EXCEPTION 'terminal email AI suggestion is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='running' OR NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'email AI suggestion transition is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER email_ai_suggestion_run_guard
      BEFORE UPDATE OR DELETE ON email_ai_suggestion_runs
      FOR EACH ROW EXECUTE FUNCTION email_ai_suggestion_run_guard();

    CREATE FUNCTION email_ai_provider_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'email AI provider receipt is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.email_suggestion_run_id IS DISTINCT FROM OLD.email_suggestion_run_id
        OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
        OR NEW.idempotency_request_hash IS DISTINCT FROM OLD.idempotency_request_hash
        OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
        OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
        OR NEW.provider_version IS DISTINCT FROM OLD.provider_version
        OR NEW.model_id IS DISTINCT FROM OLD.model_id
        OR NEW.input_characters IS DISTINCT FROM OLD.input_characters
        OR NEW.estimated_cost_minor IS DISTINCT FROM OLD.estimated_cost_minor
        OR NEW.pricing_version IS DISTINCT FROM OLD.pricing_version
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.request_id IS DISTINCT FROM OLD.request_id
        OR NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at
      THEN
        RAISE EXCEPTION 'email AI provider receipt identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status IN ('finalized','outcome_unknown') THEN
        RAISE EXCEPTION 'terminal email AI provider receipt is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status='response_recorded' AND (
        NEW.status<>'finalized'
        OR NEW.result_kind IS DISTINCT FROM OLD.result_kind
        OR NEW.provider_response_id IS DISTINCT FROM OLD.provider_response_id
        OR NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id
        OR NEW.canonical_output IS DISTINCT FROM OLD.canonical_output
        OR NEW.canonical_output_hash IS DISTINCT FROM OLD.canonical_output_hash
        OR NEW.output_characters IS DISTINCT FROM OLD.output_characters
        OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens
        OR NEW.output_tokens IS DISTINCT FROM OLD.output_tokens
        OR NEW.actual_cost_minor IS DISTINCT FROM OLD.actual_cost_minor
        OR NEW.safe_error_code IS DISTINCT FROM OLD.safe_error_code
        OR NEW.response_received_at IS DISTINCT FROM OLD.response_received_at
      ) THEN
        RAISE EXCEPTION 'email AI provider response facts are immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER email_ai_provider_receipt_guard
      BEFORE UPDATE OR DELETE ON email_ai_provider_receipts
      FOR EACH ROW EXECUTE FUNCTION email_ai_provider_receipt_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER email_ai_provider_receipt_guard ON email_ai_provider_receipts;
    DROP FUNCTION email_ai_provider_receipt_guard();
    DROP TRIGGER email_ai_suggestion_run_guard ON email_ai_suggestion_runs;
    DROP FUNCTION email_ai_suggestion_run_guard();

    DELETE FROM ai_usage_ledger WHERE usage_module='email_draft';
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_valid;
    DROP INDEX ai_usage_ledger_email_request_unique;
    DROP INDEX ai_usage_ledger_policy_request_unique;
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_email_run_fk;
    ALTER TABLE ai_usage_ledger DROP COLUMN email_suggestion_run_id, DROP COLUMN usage_module;
    ALTER TABLE ai_usage_ledger ALTER COLUMN run_id SET NOT NULL;
    ALTER TABLE ai_usage_ledger ADD CONSTRAINT ai_usage_ledger_request_unique
      UNIQUE (organization_id,run_id,request_hash,status);
    ALTER TABLE ai_usage_ledger ADD CONSTRAINT ai_usage_ledger_valid CHECK (
      request_hash ~ '^[a-f0-9]{64}$'
      AND input_characters BETWEEN 0 AND 200000
      AND output_characters BETWEEN 0 AND 1000000
      AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
      AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
      AND status IN ('provider_disabled','budget_blocked','completed','failed','cancelled')
      AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
    );

    ALTER TABLE email_draft_versions
      DROP CONSTRAINT email_draft_versions_shape_valid,
      DROP CONSTRAINT email_draft_versions_static_valid,
      DROP CONSTRAINT email_draft_versions_ai_suggestion_fk;
    ALTER TABLE email_draft_versions DROP COLUMN email_ai_suggestion_run_id;
    ALTER TABLE email_draft_versions
      ADD CONSTRAINT email_draft_versions_static_valid CHECK (
        template_version='email-draft-template/1.0.0'
        AND source_type IN ('deterministic_template','manual_revision')
        AND preview_hash ~ '^[a-f0-9]{64}$'
        AND draft_version >= 1
      ),
      ADD CONSTRAINT email_draft_versions_shape_valid CHECK (
        (draft_version=1 AND previous_version_id IS NULL
          AND source_type='deterministic_template' AND revision_reason IS NULL)
        OR
        (draft_version>1 AND previous_version_id IS NOT NULL
          AND source_type='manual_revision'
          AND length(revision_reason) BETWEEN 1 AND 500
          AND revision_reason ~ '[^[:space:]]'
          AND revision_reason !~ '[[:cntrl:]]')
      );

    DROP TABLE email_ai_provider_receipts;
    DROP TABLE email_ai_suggestion_runs;
    ALTER TABLE ai_provider_policies
      DROP CONSTRAINT ai_provider_policies_email_provider_valid,
      DROP COLUMN email_allowed_provider_ids,
      DROP COLUMN email_enabled;
  `)
}
