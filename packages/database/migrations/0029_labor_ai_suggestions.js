/* Paket 44: kanıtlı AI işçilik önerisi, ortak bütçe ve usage ledger genişlemesi. */
export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_provider_policies
      ADD COLUMN labor_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN labor_allowed_provider_ids text[] NOT NULL DEFAULT '{}';
    ALTER TABLE ai_provider_policies
      ADD CONSTRAINT ai_provider_policies_labor_provider_valid CHECK (
        labor_allowed_provider_ids <@ ARRAY[
          'deterministic-success',
          'deterministic-invalid-schema',
          'deterministic-timeout',
          'deterministic-failure',
          'gemini-generate-content'
        ]::text[]
      );

    CREATE TABLE labor_ai_suggestion_runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      base_sheet_version integer,
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
      suggestion_items jsonb,
      reasoning text,
      output_warnings text[],
      confidence numeric(5,4),
      safe_error_code text,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      CONSTRAINT labor_ai_suggestion_runs_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_ai_suggestion_runs_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_ai_suggestion_runs_org_case_id_unique
        UNIQUE (organization_id,case_id,id),
      CONSTRAINT labor_ai_suggestion_runs_identity_unique
        UNIQUE (
          organization_id,case_id,plan_hash,provider_id,provider_version,model_id,
          prompt_template_version,output_schema_version
        ),
      CONSTRAINT labor_ai_suggestion_runs_valid CHECK (
        (base_sheet_version IS NULL OR base_sheet_version>=1)
        AND plan_hash ~ '^[a-f0-9]{64}$'
        AND provider_id IN (
          'deterministic-success','deterministic-invalid-schema','deterministic-timeout',
          'deterministic-failure','gemini-generate-content'
        )
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND prompt_template_version='labor-ai-draft/1.0.0'
        AND output_schema_version='labor-ai-suggestion/1.0.0'
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
            AND privacy_policy_version='labor-ai-pii-redaction/1.0.0'
            AND outbound_payload_hash ~ '^[a-f0-9]{64}$'
            AND provider_retention_mode='free_tier_product_improvement'
          )
          OR
          (
            NOT external_provider
            AND provider_id LIKE 'deterministic-%'
            AND privacy_policy_version='labor-ai-pii/local-only'
            AND outbound_payload_hash IS NULL
            AND redacted_value_count=0
            AND cardinality(redacted_categories)=0
            AND provider_retention_mode='local_only'
          )
        )
        AND (
          (
            status='running'
            AND suggestion_items IS NULL AND reasoning IS NULL
            AND output_warnings IS NULL AND confidence IS NULL
            AND safe_error_code IS NULL AND completed_at IS NULL AND started_at IS NOT NULL
          )
          OR
          (
            status='review_required'
            AND suggestion_items IS NOT NULL
            AND jsonb_typeof(suggestion_items)='array'
            AND jsonb_array_length(suggestion_items) BETWEEN 1 AND 50
            AND pg_column_size(suggestion_items)<=100000
            AND char_length(reasoning) BETWEEN 1 AND 500
            AND cardinality(output_warnings) BETWEEN 0 AND 10
            AND confidence BETWEEN 0 AND 1
            AND safe_error_code IS NULL AND completed_at IS NOT NULL
          )
          OR
          (
            status IN ('provider_disabled','budget_blocked','failed','outcome_unknown')
            AND suggestion_items IS NULL AND reasoning IS NULL
            AND output_warnings IS NULL AND confidence IS NULL
            AND safe_error_code IS NOT NULL AND completed_at IS NOT NULL
          )
        )
      )
    );
    CREATE INDEX labor_ai_suggestion_runs_case_created_idx
      ON labor_ai_suggestion_runs (organization_id,case_id,created_at DESC);

    CREATE TABLE labor_ai_provider_receipts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      labor_suggestion_run_id uuid NOT NULL,
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
      CONSTRAINT labor_ai_provider_receipts_run_fk
        FOREIGN KEY (organization_id,case_id,labor_suggestion_run_id)
        REFERENCES labor_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_ai_provider_receipts_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_ai_provider_receipts_run_request_unique
        UNIQUE (organization_id,labor_suggestion_run_id,request_hash),
      CONSTRAINT labor_ai_provider_receipts_client_request_unique
        UNIQUE (organization_id,client_request_id),
      CONSTRAINT labor_ai_provider_receipts_valid CHECK (
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
    CREATE INDEX labor_ai_provider_receipts_active_budget_idx
      ON labor_ai_provider_receipts (organization_id,dispatch_started_at)
      WHERE status IN ('dispatch_reserved','response_recorded','outcome_unknown');

    ALTER TABLE labor_sheet_versions
      ADD COLUMN labor_ai_suggestion_run_id uuid;
    ALTER TABLE labor_sheet_versions
      ADD CONSTRAINT labor_sheet_versions_ai_suggestion_fk
        FOREIGN KEY (organization_id,case_id,labor_ai_suggestion_run_id)
        REFERENCES labor_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT;
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

    ALTER TABLE ai_usage_ledger
      ADD COLUMN labor_suggestion_run_id uuid;
    ALTER TABLE ai_usage_ledger
      ADD CONSTRAINT ai_usage_ledger_labor_run_fk
        FOREIGN KEY (organization_id,case_id,labor_suggestion_run_id)
        REFERENCES labor_ai_suggestion_runs(organization_id,case_id,id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX ai_usage_ledger_labor_request_unique
      ON ai_usage_ledger (organization_id,labor_suggestion_run_id,request_hash,status)
      WHERE usage_module='labor_sheet';
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
        (usage_module='policy_analysis' AND run_id IS NOT NULL
          AND email_suggestion_run_id IS NULL AND labor_suggestion_run_id IS NULL)
        OR
        (usage_module='email_draft' AND run_id IS NULL
          AND email_suggestion_run_id IS NOT NULL AND labor_suggestion_run_id IS NULL)
        OR
        (usage_module='labor_sheet' AND run_id IS NULL
          AND email_suggestion_run_id IS NULL AND labor_suggestion_run_id IS NOT NULL)
      )
    );

    CREATE FUNCTION labor_ai_suggestion_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor AI suggestion run is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.base_sheet_version IS DISTINCT FROM OLD.base_sheet_version
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
        RAISE EXCEPTION 'labor AI suggestion identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status<>'running' THEN
        RAISE EXCEPTION 'terminal labor AI suggestion is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='running' OR NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'labor AI suggestion transition is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_ai_suggestion_run_guard
      BEFORE UPDATE OR DELETE ON labor_ai_suggestion_runs
      FOR EACH ROW EXECUTE FUNCTION labor_ai_suggestion_run_guard();

    CREATE FUNCTION labor_ai_provider_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor AI provider receipt is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.labor_suggestion_run_id IS DISTINCT FROM OLD.labor_suggestion_run_id
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
        RAISE EXCEPTION 'labor AI provider receipt identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status IN ('finalized','outcome_unknown') THEN
        RAISE EXCEPTION 'terminal labor AI provider receipt is immutable' USING ERRCODE='restrict_violation';
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
        RAISE EXCEPTION 'labor AI provider response facts are immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_ai_provider_receipt_guard
      BEFORE UPDATE OR DELETE ON labor_ai_provider_receipts
      FOR EACH ROW EXECUTE FUNCTION labor_ai_provider_receipt_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER labor_ai_provider_receipt_guard ON labor_ai_provider_receipts;
    DROP FUNCTION labor_ai_provider_receipt_guard();
    DROP TRIGGER labor_ai_suggestion_run_guard ON labor_ai_suggestion_runs;
    DROP FUNCTION labor_ai_suggestion_run_guard();

    DELETE FROM ai_usage_ledger WHERE usage_module='labor_sheet';
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_valid;
    DROP INDEX ai_usage_ledger_labor_request_unique;
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_labor_run_fk;
    ALTER TABLE ai_usage_ledger DROP COLUMN labor_suggestion_run_id;
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

    ALTER TABLE labor_sheet_versions
      DROP CONSTRAINT labor_sheet_versions_shape_valid,
      DROP CONSTRAINT labor_sheet_versions_static_valid,
      DROP CONSTRAINT labor_sheet_versions_ai_suggestion_fk;
    ALTER TABLE labor_sheet_versions DROP COLUMN labor_ai_suggestion_run_id;
    ALTER TABLE labor_sheet_versions
      ADD CONSTRAINT labor_sheet_versions_static_valid CHECK (
        currency='TRY'
        AND source_type IN ('user_entered','manual_revision')
        AND sheet_version >= 1
      ),
      ADD CONSTRAINT labor_sheet_versions_shape_valid CHECK (
        (sheet_version=1 AND previous_version_id IS NULL
          AND source_type='user_entered' AND revision_reason IS NULL)
        OR
        (sheet_version>1 AND previous_version_id IS NOT NULL
          AND source_type='manual_revision'
          AND length(revision_reason) BETWEEN 1 AND 500
          AND revision_reason ~ '[^[:space:]]'
          AND revision_reason !~ '[[:cntrl:]]')
      );

    DROP TABLE labor_ai_provider_receipts;
    DROP TABLE labor_ai_suggestion_runs;
    ALTER TABLE ai_provider_policies
      DROP CONSTRAINT ai_provider_policies_labor_provider_valid,
      DROP COLUMN labor_allowed_provider_ids,
      DROP COLUMN labor_enabled;
  `)
}
