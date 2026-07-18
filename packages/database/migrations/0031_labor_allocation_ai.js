/*
 * Paket 54 dilim 2: AI işçilik dağıtımı.
 *
 * Öneri föy sürümünden AYRI bir aggregate'tir: `labor_sheet_versions` bu
 * tablolara bağlanmaz ve öneri hiçbir zaman föyü kendiliğinden değiştirmez.
 * Öneri kimliği ve satır sonuçları append-only'dir; sürüm zinciri ve idempotency
 * DB seviyesinde korunur.
 */
const OPERATION_TYPES =
  "'repair','replace','remove_install','paint','consumable','calibration','related_operation','other'"
const ECONOMIC_BUCKETS =
  "'repair_labor','new_part_or_ownership','remove_install','paint_and_consumable','calibration','related_operations'"
const PROVIDER_IDS =
  "'deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','gemini-generate-content'"

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_provider_policies
      ADD COLUMN labor_allocation_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN labor_allocation_allowed_provider_ids text[] NOT NULL DEFAULT '{}';
    ALTER TABLE ai_provider_policies
      ADD CONSTRAINT ai_provider_policies_labor_allocation_provider_valid CHECK (
        labor_allocation_allowed_provider_ids <@ ARRAY[${PROVIDER_IDS}]::text[]
      );

    CREATE TABLE labor_allocation_runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      source_sheet_id uuid NOT NULL,
      source_sheet_version integer NOT NULL,
      evidence_hash text NOT NULL,
      plan_hash text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      prompt_template_version text NOT NULL,
      output_schema_version text NOT NULL,
      operation_types_version text NOT NULL,
      rule_version text NOT NULL,
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
      line_count integer,
      control_required_count integer,
      safe_error_code text,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      CONSTRAINT labor_allocation_runs_case_fk
        FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_runs_sheet_fk
        FOREIGN KEY (organization_id,case_id,source_sheet_id)
        REFERENCES labor_sheets(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_runs_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_runs_org_case_id_unique
        UNIQUE (organization_id,case_id,id),
      CONSTRAINT labor_allocation_runs_valid CHECK (
        source_sheet_version>=1
        AND evidence_hash ~ '^[a-f0-9]{64}$'
        AND plan_hash ~ '^[a-f0-9]{64}$'
        AND provider_id IN (${PROVIDER_IDS})
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND prompt_template_version='labor-allocation-ai/1.0.0'
        AND output_schema_version='labor-allocation-suggestion/1.0.0'
        AND operation_types_version='labor-operation-types/1.0.0'
        AND rule_version='labor-allocation-rules/1.0.0'
        AND status IN (
          'provider_disabled','budget_blocked','running','review_required','failed','outcome_unknown'
        )
        AND outbound_input_characters BETWEEN 1 AND 400000
        AND redacted_value_count BETWEEN 0 AND 10000
        AND redacted_categories <@ ARRAY[
          'address','email','iban','name','phone','plate','reference_number',
          'tax_identity','turkish_identity','vehicle_identity'
        ]::text[]
        AND cardinality(privacy_warnings) BETWEEN 0 AND 40
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
            AND privacy_policy_version='labor-allocation-pii-redaction/1.0.0'
            AND outbound_payload_hash ~ '^[a-f0-9]{64}$'
            AND provider_retention_mode='free_tier_product_improvement'
          )
          OR
          (
            NOT external_provider
            AND provider_id LIKE 'deterministic-%'
            AND privacy_policy_version='labor-allocation-pii/local-only'
            AND outbound_payload_hash IS NULL
            AND redacted_value_count=0
            AND cardinality(redacted_categories)=0
            AND provider_retention_mode='local_only'
          )
        )
        AND (
          (
            status='running'
            AND line_count IS NULL AND control_required_count IS NULL
            AND safe_error_code IS NULL AND completed_at IS NULL AND started_at IS NOT NULL
          )
          OR
          (
            status='review_required'
            AND line_count BETWEEN 1 AND 200
            AND control_required_count BETWEEN 0 AND line_count
            AND safe_error_code IS NULL AND completed_at IS NOT NULL
          )
          OR
          (
            status IN ('provider_disabled','budget_blocked','failed','outcome_unknown')
            AND line_count IS NULL AND control_required_count IS NULL
            AND safe_error_code IS NOT NULL AND completed_at IS NOT NULL
          )
        )
      )
    );
    CREATE INDEX labor_allocation_runs_case_created_idx
      ON labor_allocation_runs (organization_id,case_id,created_at DESC);
    -- Aynı analiz anahtarı için tekrar koruması: BAŞARILI sonuç bir kez üretilir.
    -- Başarısız/engellenmiş çalıştırmalar yeniden denenebilir olmalıdır, aksi
    -- halde sağlayıcı sonradan açıldığında analiz kalıcı olarak kilitlenirdi.
    CREATE UNIQUE INDEX labor_allocation_runs_identity_unique
      ON labor_allocation_runs (
        organization_id,case_id,plan_hash,provider_id,provider_version,model_id,
        prompt_template_version,output_schema_version,operation_types_version
      )
      WHERE status='review_required';

    -- Satır sonuçları: immutable, run başına tek kayıt/satır.
    CREATE TABLE labor_allocation_line_suggestions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      line_ordinal integer NOT NULL,
      source_description text NOT NULL,
      source_action text NOT NULL,
      source_part_amount_minor bigint NOT NULL,
      source_labor_amount_minor bigint NOT NULL,
      allocations jsonb NOT NULL,
      repair_replace_opinion text NOT NULL,
      economic_buckets jsonb NOT NULL,
      economic_repair_total_minor bigint NOT NULL,
      economic_replace_total_minor bigint NOT NULL,
      economic_note text NOT NULL,
      reasoning text NOT NULL,
      evidence_refs text[] NOT NULL DEFAULT '{}',
      confidence numeric(5,4) NOT NULL,
      conflict_codes text[] NOT NULL DEFAULT '{}',
      missing_evidence_codes text[] NOT NULL DEFAULT '{}',
      control_required boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT labor_allocation_line_suggestions_run_fk
        FOREIGN KEY (organization_id,case_id,run_id)
        REFERENCES labor_allocation_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_line_suggestions_ordinal_unique
        UNIQUE (organization_id,run_id,line_ordinal),
      CONSTRAINT labor_allocation_line_suggestions_valid CHECK (
        line_ordinal BETWEEN 1 AND 200
        AND char_length(source_description) BETWEEN 1 AND 160
        AND char_length(source_action) BETWEEN 1 AND 80
        AND source_part_amount_minor BETWEEN 0 AND 10000000000
        AND source_labor_amount_minor BETWEEN 0 AND 10000000000
        AND jsonb_typeof(allocations)='array'
        AND jsonb_array_length(allocations) BETWEEN 1 AND 8
        AND pg_column_size(allocations)<=8000
        AND repair_replace_opinion IN (
          'repair_indicated','replace_indicated','comparable','insufficient_evidence'
        )
        AND jsonb_typeof(economic_buckets)='object'
        AND pg_column_size(economic_buckets)<=4000
        AND economic_repair_total_minor BETWEEN 0 AND 10000000000
        AND economic_replace_total_minor BETWEEN 0 AND 10000000000
        AND char_length(economic_note) BETWEEN 1 AND 600
        AND char_length(reasoning) BETWEEN 1 AND 600
        AND cardinality(evidence_refs) BETWEEN 0 AND 20
        AND confidence BETWEEN 0 AND 1
        AND conflict_codes <@ ARRAY[
          'CONFLICT_ACTION_VS_OPERATION','CONFLICT_AMOUNT_VS_OPERATION',
          'CONFLICT_HISTORY_DISAGREEMENT','CONFLICT_EXPERT_BASELINE_DISAGREEMENT',
          'CONFLICT_DICTIONARY_DISAGREEMENT','CONFLICT_ECONOMIC_INCONCLUSIVE'
        ]::text[]
        AND missing_evidence_codes <@ ARRAY[
          'EVIDENCE_MISSING_VEHICLE_IDENTITY','EVIDENCE_MISSING_PART_CODE',
          'EVIDENCE_MISSING_DAMAGE_REGION','EVIDENCE_MISSING_APPROVED_HISTORY',
          'EVIDENCE_MISSING_DICTIONARY_MATCH','EVIDENCE_MISSING_EXPERT_BASELINE'
        ]::text[]
        -- Eksik kanıt veya çelişki varsa kontrol zorunludur (sunucu kuralının DB aynası).
        AND (
          control_required
          OR (cardinality(conflict_codes)=0 AND cardinality(missing_evidence_codes)=0)
        )
        AND economic_buckets ?& ARRAY[${ECONOMIC_BUCKETS}]::text[]
      )
    );
    CREATE INDEX labor_allocation_line_suggestions_run_idx
      ON labor_allocation_line_suggestions (organization_id,run_id,line_ordinal);

    -- Sağlayıcı makbuzu: idempotency ve dayanıklı sonuç kaydı.
    CREATE TABLE labor_allocation_provider_receipts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      request_hash text NOT NULL,
      client_request_id text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      status text NOT NULL DEFAULT 'dispatch_reserved',
      result_kind text,
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
      CONSTRAINT labor_allocation_provider_receipts_run_fk
        FOREIGN KEY (organization_id,case_id,run_id)
        REFERENCES labor_allocation_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_provider_receipts_actor_fk
        FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT labor_allocation_provider_receipts_run_request_unique
        UNIQUE (organization_id,run_id,request_hash),
      CONSTRAINT labor_allocation_provider_receipts_client_request_unique
        UNIQUE (organization_id,client_request_id),
      CONSTRAINT labor_allocation_provider_receipts_valid CHECK (
        request_hash ~ '^[a-f0-9]{64}$'
        AND client_request_id ~ '^[a-f0-9]{64}$'
        AND char_length(provider_id) BETWEEN 1 AND 80
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND status IN ('dispatch_reserved','response_recorded','outcome_unknown','finalized')
        AND (result_kind IS NULL OR result_kind IN ('success','failure'))
        AND (canonical_output_hash IS NULL OR canonical_output_hash ~ '^[a-f0-9]{64}$')
        AND input_characters BETWEEN 0 AND 400000
        AND (output_characters IS NULL OR output_characters BETWEEN 0 AND 1000000)
        AND (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 1000000)
        AND (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 1000000)
        AND ((input_tokens IS NULL)=(output_tokens IS NULL))
        AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
        AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
        AND char_length(pricing_version) BETWEEN 1 AND 80
        AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
        AND char_length(request_id) BETWEEN 1 AND 128
      )
    );
    CREATE INDEX labor_allocation_provider_receipts_active_budget_idx
      ON labor_allocation_provider_receipts (organization_id,dispatch_started_at)
      WHERE status IN ('dispatch_reserved','response_recorded','outcome_unknown');

    ALTER TABLE ai_usage_ledger
      ADD COLUMN labor_allocation_run_id uuid;
    ALTER TABLE ai_usage_ledger
      ADD CONSTRAINT ai_usage_ledger_labor_allocation_run_fk
        FOREIGN KEY (organization_id,case_id,labor_allocation_run_id)
        REFERENCES labor_allocation_runs(organization_id,case_id,id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX ai_usage_ledger_labor_allocation_request_unique
      ON ai_usage_ledger (organization_id,labor_allocation_run_id,request_hash,status)
      WHERE usage_module='labor_allocation';
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_valid;
    ALTER TABLE ai_usage_ledger ADD CONSTRAINT ai_usage_ledger_valid CHECK (
      request_hash ~ '^[a-f0-9]{64}$'
      AND input_characters BETWEEN 0 AND 400000
      AND output_characters BETWEEN 0 AND 1000000
      AND estimated_cost_minor BETWEEN 0 AND 9007199254740991
      AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991)
      AND status IN ('provider_disabled','budget_blocked','completed','failed','cancelled')
      AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$')
      AND (
        (usage_module='policy_analysis' AND run_id IS NOT NULL
          AND email_suggestion_run_id IS NULL AND labor_suggestion_run_id IS NULL
          AND labor_allocation_run_id IS NULL)
        OR
        (usage_module='email_draft' AND run_id IS NULL
          AND email_suggestion_run_id IS NOT NULL AND labor_suggestion_run_id IS NULL
          AND labor_allocation_run_id IS NULL)
        OR
        (usage_module='labor_sheet' AND run_id IS NULL
          AND email_suggestion_run_id IS NULL AND labor_suggestion_run_id IS NOT NULL
          AND labor_allocation_run_id IS NULL)
        OR
        (usage_module='labor_allocation' AND run_id IS NULL
          AND email_suggestion_run_id IS NULL AND labor_suggestion_run_id IS NULL
          AND labor_allocation_run_id IS NOT NULL)
      )
    );

    CREATE FUNCTION labor_allocation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actual_lines integer;
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor allocation run is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.source_sheet_id IS DISTINCT FROM OLD.source_sheet_id
        OR NEW.source_sheet_version IS DISTINCT FROM OLD.source_sheet_version
        OR NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash
        OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash
        OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
        OR NEW.provider_version IS DISTINCT FROM OLD.provider_version
        OR NEW.model_id IS DISTINCT FROM OLD.model_id
        OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version
        OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version
        OR NEW.operation_types_version IS DISTINCT FROM OLD.operation_types_version
        OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
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
        RAISE EXCEPTION 'labor allocation identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status<>'running' THEN
        RAISE EXCEPTION 'terminal labor allocation run is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='running' OR NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'labor allocation transition is invalid' USING ERRCODE='check_violation';
      END IF;
      IF NEW.status='review_required' THEN
        SELECT count(*) INTO actual_lines FROM labor_allocation_line_suggestions
          WHERE organization_id=NEW.organization_id AND run_id=NEW.id;
        IF actual_lines<>NEW.line_count OR actual_lines=0 THEN
          RAISE EXCEPTION 'labor allocation line coverage is invalid' USING ERRCODE='check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_allocation_run_guard
      BEFORE UPDATE OR DELETE ON labor_allocation_runs
      FOR EACH ROW EXECUTE FUNCTION labor_allocation_run_guard();

    CREATE FUNCTION labor_allocation_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE run_status text;
    BEGIN
      IF TG_OP IN ('UPDATE','DELETE') THEN
        RAISE EXCEPTION 'labor allocation line suggestion is immutable' USING ERRCODE='restrict_violation';
      END IF;
      SELECT status INTO run_status FROM labor_allocation_runs
        WHERE organization_id=NEW.organization_id AND id=NEW.run_id;
      IF run_status IS DISTINCT FROM 'running' THEN
        RAISE EXCEPTION 'labor allocation line requires running run' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_allocation_line_guard
      BEFORE INSERT OR UPDATE OR DELETE ON labor_allocation_line_suggestions
      FOR EACH ROW EXECUTE FUNCTION labor_allocation_line_guard();

    CREATE FUNCTION labor_allocation_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor allocation receipt is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
        OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
        OR NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at
      THEN
        RAISE EXCEPTION 'labor allocation receipt identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status='finalized' THEN
        RAISE EXCEPTION 'finalized labor allocation receipt is immutable' USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_allocation_receipt_guard
      BEFORE UPDATE OR DELETE ON labor_allocation_provider_receipts
      FOR EACH ROW EXECUTE FUNCTION labor_allocation_receipt_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER labor_allocation_receipt_guard ON labor_allocation_provider_receipts;
    DROP FUNCTION labor_allocation_receipt_guard();
    DROP TRIGGER labor_allocation_line_guard ON labor_allocation_line_suggestions;
    DROP FUNCTION labor_allocation_line_guard();
    DROP TRIGGER labor_allocation_run_guard ON labor_allocation_runs;
    DROP FUNCTION labor_allocation_run_guard();

    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_valid;
    DROP INDEX ai_usage_ledger_labor_allocation_request_unique;
    ALTER TABLE ai_usage_ledger DROP CONSTRAINT ai_usage_ledger_labor_allocation_run_fk;
    ALTER TABLE ai_usage_ledger DROP COLUMN labor_allocation_run_id;
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

    DROP TABLE labor_allocation_provider_receipts;
    DROP TABLE labor_allocation_line_suggestions;
    DROP TABLE labor_allocation_runs;

    ALTER TABLE ai_provider_policies
      DROP CONSTRAINT ai_provider_policies_labor_allocation_provider_valid,
      DROP COLUMN labor_allocation_allowed_provider_ids,
      DROP COLUMN labor_allocation_enabled;
  `)
}
