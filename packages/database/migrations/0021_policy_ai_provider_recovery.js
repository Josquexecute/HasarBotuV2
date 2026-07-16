/* Paket 29: durable provider-call receipt and post-call transaction recovery. */
export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_provider_policies DROP CONSTRAINT ai_provider_policies_provider_valid;
    ALTER TABLE ai_provider_policies ADD CONSTRAINT ai_provider_policies_provider_valid
      CHECK (allowed_provider_ids <@ ARRAY['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses','gemini-generate-content']::text[]);

    ALTER TABLE policy_analysis_ai_facts DROP CONSTRAINT policy_analysis_ai_facts_valid;
    ALTER TABLE policy_analysis_ai_facts ADD CONSTRAINT policy_analysis_ai_facts_valid CHECK (
      category IN ('policy_identity','coverage','deductible','service_rule','part_rule','replacement_vehicle','assistance','valuation','exclusion','required_document','special_condition')
      AND canonical_field ~ '^[a-z0-9_.-]{1,120}$'
      AND char_length(original_value) BETWEEN 1 AND 1000
      AND pg_column_size(normalized_value)<=100000
      AND jsonb_typeof(conditions)='array' AND jsonb_array_length(conditions)<=20 AND pg_column_size(conditions)<=20000
      AND jsonb_typeof(exceptions)='array' AND jsonb_array_length(exceptions)<=20 AND pg_column_size(exceptions)<=20000
      AND review_action IN ('accepted','edited') AND origin_review_version>=1
      AND cardinality(source_anchor_ids) BETWEEN 1 AND 20
      AND provider_confidence BETWEEN 0 AND 1
      AND source_quality IN ('high','medium','low','control_required')
      AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses','gemini-generate-content')
      AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80
    );

    ALTER TABLE ai_extraction_runs DROP CONSTRAINT ai_extraction_runs_valid;
    ALTER TABLE ai_extraction_runs ADD CONSTRAINT ai_extraction_runs_valid CHECK (
      source_bundle_hash ~ '^[a-f0-9]{64}$'
      AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses','gemini-generate-content')
      AND char_length(provider_version) BETWEEN 1 AND 80
      AND char_length(model_id) BETWEEN 1 AND 80
      AND prompt_template_version='policy-ai-extraction/1.0.0'
      AND output_schema_version='policy-ai-candidates/1.0.0'
      AND status IN ('planned','provider_disabled','budget_blocked','running','validating','review_required','failed','stale','cancelled','superseded')
      AND candidate_count BETWEEN 0 AND 100
      AND conflict_count BETWEEN 0 AND 1000
      AND control_required_count BETWEEN 0 AND 100
      AND input_characters BETWEEN 1 AND 200000
      AND outbound_input_characters BETWEEN 1 AND 200000
      AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
      AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
      AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
      AND redacted_value_count BETWEEN 0 AND 10000
      AND redacted_categories <@ ARRAY['address','email','iban','name','phone','plate','reference_number','tax_identity','turkish_identity','vehicle_identity']::text[]
      AND char_length(pricing_version) BETWEEN 1 AND 80
      AND version>=1
      AND (
        (external_provider AND provider_id='openai-responses' AND privacy_policy_version='policy-ai-pii-redaction/1.0.0' AND outbound_payload_hash ~ '^[a-f0-9]{64}$' AND provider_retention_mode='store_false')
        OR
        (external_provider AND provider_id='gemini-generate-content' AND privacy_policy_version='policy-ai-pii-redaction/1.0.0' AND outbound_payload_hash ~ '^[a-f0-9]{64}$' AND provider_retention_mode='free_tier_product_improvement')
        OR
        (NOT external_provider AND privacy_policy_version='policy-ai-pii/local-only' AND outbound_payload_hash IS NULL AND redacted_value_count=0 AND cardinality(redacted_categories)=0 AND provider_retention_mode='local_only')
      )
    );

    CREATE TABLE ai_provider_call_receipts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
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
      version integer NOT NULL DEFAULT 1,
      CONSTRAINT ai_provider_call_receipts_run_fk
        FOREIGN KEY (organization_id,case_id,run_id)
        REFERENCES ai_extraction_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_provider_call_receipts_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_provider_call_receipts_run_request_unique
        UNIQUE (organization_id,run_id,request_hash),
      CONSTRAINT ai_provider_call_receipts_client_request_unique
        UNIQUE (organization_id,client_request_id),
      CONSTRAINT ai_provider_call_receipts_valid CHECK (
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
        AND (canonical_output IS NULL OR pg_column_size(canonical_output)<=250000)
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
        AND version>=1
        AND (
          (status='dispatch_reserved' AND result_kind IS NULL AND canonical_output IS NULL AND canonical_output_hash IS NULL AND response_received_at IS NULL AND finalized_at IS NULL)
          OR
          (status='response_recorded' AND result_kind IS NOT NULL AND response_received_at IS NOT NULL AND finalized_at IS NULL
            AND ((result_kind='success' AND canonical_output IS NOT NULL AND canonical_output_hash IS NOT NULL AND safe_error_code IS NULL)
              OR (result_kind='failure' AND canonical_output IS NULL AND canonical_output_hash IS NULL AND safe_error_code IS NOT NULL)))
          OR
          (status='outcome_unknown' AND result_kind='failure' AND canonical_output IS NULL AND canonical_output_hash IS NULL AND safe_error_code='AI_PROVIDER_OUTCOME_UNKNOWN' AND finalized_at IS NOT NULL)
          OR
          (status='finalized' AND result_kind IS NOT NULL AND response_received_at IS NOT NULL AND finalized_at IS NOT NULL)
        )
      )
    );
    CREATE INDEX ai_provider_call_receipts_active_budget_idx
      ON ai_provider_call_receipts (organization_id,dispatch_started_at)
      WHERE status IN ('dispatch_reserved','response_recorded','outcome_unknown');

    CREATE FUNCTION ai_provider_call_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'AI provider call receipts are append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.run_id IS DISTINCT FROM OLD.run_id
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
      THEN RAISE EXCEPTION 'AI provider receipt identity is immutable' USING ERRCODE='restrict_violation'; END IF;
      IF OLD.status IN ('finalized','outcome_unknown') THEN
        RAISE EXCEPTION 'AI provider terminal receipt is immutable' USING ERRCODE='restrict_violation';
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
      ) THEN RAISE EXCEPTION 'AI provider response facts are immutable' USING ERRCODE='restrict_violation'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ai_provider_call_receipt_guard
      BEFORE UPDATE OR DELETE ON ai_provider_call_receipts
      FOR EACH ROW EXECUTE FUNCTION ai_provider_call_receipt_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER ai_provider_call_receipt_guard ON ai_provider_call_receipts;
    DROP FUNCTION ai_provider_call_receipt_guard();
    DROP TABLE ai_provider_call_receipts;

    ALTER TABLE ai_extraction_runs DROP CONSTRAINT ai_extraction_runs_valid;
    ALTER TABLE ai_extraction_runs ADD CONSTRAINT ai_extraction_runs_valid CHECK (
      source_bundle_hash ~ '^[a-f0-9]{64}$'
      AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses')
      AND char_length(provider_version) BETWEEN 1 AND 80
      AND char_length(model_id) BETWEEN 1 AND 80
      AND prompt_template_version='policy-ai-extraction/1.0.0'
      AND output_schema_version='policy-ai-candidates/1.0.0'
      AND status IN ('planned','provider_disabled','budget_blocked','running','validating','review_required','failed','stale','cancelled','superseded')
      AND candidate_count BETWEEN 0 AND 100
      AND conflict_count BETWEEN 0 AND 1000
      AND control_required_count BETWEEN 0 AND 100
      AND input_characters BETWEEN 1 AND 200000
      AND outbound_input_characters BETWEEN 1 AND 200000
      AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
      AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
      AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
      AND redacted_value_count BETWEEN 0 AND 10000
      AND redacted_categories <@ ARRAY['address','email','iban','name','phone','plate','reference_number','tax_identity','turkish_identity','vehicle_identity']::text[]
      AND char_length(pricing_version) BETWEEN 1 AND 80
      AND version>=1
      AND (
        (external_provider AND privacy_policy_version='policy-ai-pii-redaction/1.0.0' AND outbound_payload_hash ~ '^[a-f0-9]{64}$' AND provider_retention_mode='store_false')
        OR
        (NOT external_provider AND privacy_policy_version='policy-ai-pii/local-only' AND outbound_payload_hash IS NULL AND redacted_value_count=0 AND cardinality(redacted_categories)=0 AND provider_retention_mode='local_only')
      )
    );

    ALTER TABLE policy_analysis_ai_facts DROP CONSTRAINT policy_analysis_ai_facts_valid;
    ALTER TABLE policy_analysis_ai_facts ADD CONSTRAINT policy_analysis_ai_facts_valid CHECK (
      category IN ('policy_identity','coverage','deductible','service_rule','part_rule','replacement_vehicle','assistance','valuation','exclusion','required_document','special_condition')
      AND canonical_field ~ '^[a-z0-9_.-]{1,120}$'
      AND char_length(original_value) BETWEEN 1 AND 1000
      AND pg_column_size(normalized_value)<=100000
      AND jsonb_typeof(conditions)='array' AND jsonb_array_length(conditions)<=20 AND pg_column_size(conditions)<=20000
      AND jsonb_typeof(exceptions)='array' AND jsonb_array_length(exceptions)<=20 AND pg_column_size(exceptions)<=20000
      AND review_action IN ('accepted','edited') AND origin_review_version>=1
      AND cardinality(source_anchor_ids) BETWEEN 1 AND 20
      AND provider_confidence BETWEEN 0 AND 1
      AND source_quality IN ('high','medium','low','control_required')
      AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses')
      AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80
    );

    ALTER TABLE ai_provider_policies DROP CONSTRAINT ai_provider_policies_provider_valid;
    ALTER TABLE ai_provider_policies ADD CONSTRAINT ai_provider_policies_provider_valid
      CHECK (allowed_provider_ids <@ ARRAY['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses']::text[]);
  `)
}
