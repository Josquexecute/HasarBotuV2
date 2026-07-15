/* Paket 28: real provider privacy envelope and token-based usage accounting. */
export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_provider_policies DROP CONSTRAINT ai_provider_policies_provider_valid;
    ALTER TABLE ai_provider_policies ADD CONSTRAINT ai_provider_policies_provider_valid
      CHECK (allowed_provider_ids <@ ARRAY['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses']::text[]);

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

    ALTER TABLE ai_extraction_runs DROP CONSTRAINT ai_extraction_runs_valid;
    ALTER TABLE ai_extraction_runs
      ADD COLUMN external_provider boolean NOT NULL DEFAULT false,
      ADD COLUMN privacy_policy_version text NOT NULL DEFAULT 'policy-ai-pii/local-only',
      ADD COLUMN outbound_payload_hash text,
      ADD COLUMN outbound_input_characters integer NOT NULL DEFAULT 1,
      ADD COLUMN redacted_value_count integer NOT NULL DEFAULT 0,
      ADD COLUMN redacted_categories text[] NOT NULL DEFAULT '{}',
      ADD COLUMN provider_retention_mode text NOT NULL DEFAULT 'local_only',
      ADD COLUMN pricing_version text NOT NULL DEFAULT 'deterministic-cost/1.0.0';
    UPDATE ai_extraction_runs SET outbound_input_characters=input_characters;
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

    ALTER TABLE ai_usage_ledger
      ADD COLUMN input_tokens integer,
      ADD COLUMN output_tokens integer,
      ADD COLUMN pricing_version text NOT NULL DEFAULT 'deterministic-cost/1.0.0';
    ALTER TABLE ai_usage_ledger ADD CONSTRAINT ai_usage_token_accounting_valid CHECK (
      (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 1000000)
      AND (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 1000000)
      AND char_length(pricing_version) BETWEEN 1 AND 80
      AND ((input_tokens IS NULL)=(output_tokens IS NULL))
    );

    CREATE FUNCTION ai_run_privacy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.external_provider IS DISTINCT FROM OLD.external_provider
        OR NEW.privacy_policy_version IS DISTINCT FROM OLD.privacy_policy_version
        OR NEW.outbound_payload_hash IS DISTINCT FROM OLD.outbound_payload_hash
        OR NEW.outbound_input_characters IS DISTINCT FROM OLD.outbound_input_characters
        OR NEW.redacted_value_count IS DISTINCT FROM OLD.redacted_value_count
        OR NEW.redacted_categories IS DISTINCT FROM OLD.redacted_categories
        OR NEW.provider_retention_mode IS DISTINCT FROM OLD.provider_retention_mode
        OR NEW.pricing_version IS DISTINCT FROM OLD.pricing_version
      THEN RAISE EXCEPTION 'AI provider privacy facts are immutable' USING ERRCODE='restrict_violation'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ai_run_privacy_guard BEFORE UPDATE ON ai_extraction_runs FOR EACH ROW EXECUTE FUNCTION ai_run_privacy_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER ai_run_privacy_guard ON ai_extraction_runs;
    DROP FUNCTION ai_run_privacy_guard();
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
      AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt')
      AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80
    );
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_token_accounting_valid;
    ALTER TABLE ai_usage_ledger DROP COLUMN pricing_version, DROP COLUMN output_tokens, DROP COLUMN input_tokens;
    ALTER TABLE ai_extraction_runs DROP CONSTRAINT ai_extraction_runs_valid;
    ALTER TABLE ai_extraction_runs
      DROP COLUMN pricing_version,
      DROP COLUMN provider_retention_mode,
      DROP COLUMN redacted_categories,
      DROP COLUMN redacted_value_count,
      DROP COLUMN outbound_input_characters,
      DROP COLUMN outbound_payload_hash,
      DROP COLUMN privacy_policy_version,
      DROP COLUMN external_provider;
    ALTER TABLE ai_extraction_runs ADD CONSTRAINT ai_extraction_runs_valid CHECK (source_bundle_hash ~ '^[a-f0-9]{64}$' AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt') AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80 AND prompt_template_version='policy-ai-extraction/1.0.0' AND output_schema_version='policy-ai-candidates/1.0.0' AND status IN ('planned','provider_disabled','budget_blocked','running','validating','review_required','failed','stale','cancelled','superseded') AND candidate_count BETWEEN 0 AND 100 AND conflict_count BETWEEN 0 AND 1000 AND control_required_count BETWEEN 0 AND 100 AND input_characters BETWEEN 1 AND 200000 AND estimated_cost_minor BETWEEN 0 AND 9007199254740991 AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991) AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$') AND version>=1);
    ALTER TABLE ai_provider_policies DROP CONSTRAINT ai_provider_policies_provider_valid;
    ALTER TABLE ai_provider_policies ADD CONSTRAINT ai_provider_policies_provider_valid CHECK (allowed_provider_ids <@ ARRAY['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt']::text[]);
  `)
}
