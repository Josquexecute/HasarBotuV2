/* Paket 26: API-owned, provider-neutral policy AI orchestration metadata. */
export function up(pgm) {
  pgm.sql(`
    CREATE TABLE ai_provider_policies (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      enabled boolean NOT NULL DEFAULT false,
      allowed_provider_ids text[] NOT NULL DEFAULT '{}',
      monthly_budget_minor bigint NOT NULL DEFAULT 0,
      per_request_budget_minor bigint NOT NULL DEFAULT 0,
      monthly_hard_stop boolean NOT NULL DEFAULT true,
      maximum_input_characters integer NOT NULL DEFAULT 50000,
      maximum_candidates integer NOT NULL DEFAULT 50,
      request_timeout_ms integer NOT NULL DEFAULT 5000,
      retention_mode text NOT NULL DEFAULT 'canonical_only',
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_provider_policies_org_unique UNIQUE (organization_id),
      CONSTRAINT ai_provider_policies_budget_valid CHECK (monthly_budget_minor BETWEEN 0 AND 9007199254740991 AND per_request_budget_minor BETWEEN 0 AND 9007199254740991 AND maximum_input_characters BETWEEN 1 AND 200000 AND maximum_candidates BETWEEN 1 AND 100 AND request_timeout_ms BETWEEN 100 AND 30000 AND retention_mode='canonical_only' AND version>=1),
      CONSTRAINT ai_provider_policies_provider_valid CHECK (allowed_provider_ids <@ ARRAY['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt']::text[])
    );

    CREATE TABLE ai_source_bundles (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      source_bundle_hash text NOT NULL,
      bundle_schema_version text NOT NULL,
      status text NOT NULL DEFAULT 'building',
      input_characters integer NOT NULL DEFAULT 0,
      source_count integer NOT NULL DEFAULT 0,
      quality_warnings text[] NOT NULL DEFAULT '{}',
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT ai_source_bundles_case_fk FOREIGN KEY (organization_id,case_id) REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_source_bundles_creator_fk FOREIGN KEY (organization_id,created_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_source_bundles_hash_unique UNIQUE (organization_id,case_id,source_bundle_hash),
      CONSTRAINT ai_source_bundles_identity_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT ai_source_bundles_identity_hash_unique UNIQUE (organization_id,case_id,id,source_bundle_hash),
      CONSTRAINT ai_source_bundles_valid CHECK (source_bundle_hash ~ '^[a-f0-9]{64}$' AND bundle_schema_version='policy-ai-source-bundle/1.0.0' AND status IN ('building','ready') AND input_characters BETWEEN 0 AND 200000 AND source_count BETWEEN 0 AND 200 AND (status='building' OR completed_at IS NOT NULL))
    );

    CREATE TABLE ai_source_bundle_items (
      source_anchor_id text NOT NULL,
      bundle_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      source_type text NOT NULL,
      document_id uuid NOT NULL,
      document_version_id uuid NOT NULL,
      extraction_id uuid NOT NULL,
      source_item_id uuid NOT NULL,
      page_number integer NOT NULL,
      source_text text NOT NULL,
      text_hash text NOT NULL,
      source_quality text NOT NULL,
      warnings text[] NOT NULL DEFAULT '{}',
      historical_selected boolean NOT NULL DEFAULT false,
      ordinal integer NOT NULL,
      PRIMARY KEY (bundle_id,source_anchor_id),
      CONSTRAINT ai_source_bundle_items_bundle_fk FOREIGN KEY (organization_id,case_id,bundle_id) REFERENCES ai_source_bundles(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_source_bundle_items_document_fk FOREIGN KEY (organization_id,case_id,document_id) REFERENCES documents(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_source_bundle_items_version_fk FOREIGN KEY (organization_id,case_id,document_version_id) REFERENCES document_versions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_source_bundle_items_bundle_ordinal_unique UNIQUE (bundle_id,ordinal),
      CONSTRAINT ai_source_bundle_items_bundle_source_unique UNIQUE (bundle_id,source_type,extraction_id,source_item_id),
      CONSTRAINT ai_source_bundle_items_anchor_bundle_unique UNIQUE (bundle_id,source_anchor_id),
      CONSTRAINT ai_source_bundle_items_tenant_anchor_unique UNIQUE (organization_id,case_id,bundle_id,source_anchor_id),
      CONSTRAINT ai_source_bundle_items_valid CHECK (source_anchor_id ~ '^[a-f0-9]{64}$' AND source_type IN ('pdf_text','ocr') AND page_number BETWEEN 1 AND 1000 AND char_length(source_text) BETWEEN 1 AND 200000 AND text_hash ~ '^[a-f0-9]{64}$' AND source_quality IN ('high','medium','low','control_required') AND ordinal BETWEEN 0 AND 199)
    );

    CREATE TABLE ai_extraction_runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      source_bundle_id uuid NOT NULL,
      source_bundle_hash text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      prompt_template_version text NOT NULL,
      output_schema_version text NOT NULL,
      status text NOT NULL DEFAULT 'planned',
      candidate_count integer NOT NULL DEFAULT 0,
      conflict_count integer NOT NULL DEFAULT 0,
      control_required_count integer NOT NULL DEFAULT 0,
      input_characters integer NOT NULL,
      estimated_cost_minor bigint NOT NULL,
      actual_cost_minor bigint,
      safe_error_code text,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      CONSTRAINT ai_extraction_runs_case_fk FOREIGN KEY (organization_id,case_id) REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_extraction_runs_bundle_fk FOREIGN KEY (organization_id,case_id,source_bundle_id,source_bundle_hash) REFERENCES ai_source_bundles(organization_id,case_id,id,source_bundle_hash) ON DELETE RESTRICT,
      CONSTRAINT ai_extraction_runs_creator_fk FOREIGN KEY (organization_id,created_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_extraction_runs_org_case_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT ai_extraction_runs_bundle_identity_unique UNIQUE (organization_id,case_id,id,source_bundle_id),
      CONSTRAINT ai_extraction_runs_identity_unique UNIQUE (organization_id,case_id,source_bundle_hash,provider_id,provider_version,model_id,prompt_template_version,output_schema_version),
      CONSTRAINT ai_extraction_runs_valid CHECK (source_bundle_hash ~ '^[a-f0-9]{64}$' AND provider_id IN ('deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt') AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80 AND prompt_template_version='policy-ai-extraction/1.0.0' AND output_schema_version='policy-ai-candidates/1.0.0' AND status IN ('planned','provider_disabled','budget_blocked','running','validating','review_required','failed','stale','cancelled','superseded') AND candidate_count BETWEEN 0 AND 100 AND conflict_count BETWEEN 0 AND 1000 AND control_required_count BETWEEN 0 AND 100 AND input_characters BETWEEN 1 AND 200000 AND estimated_cost_minor BETWEEN 0 AND 9007199254740991 AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991) AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$') AND version>=1)
    );

    CREATE TABLE ai_extraction_candidates (
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      candidate_id text NOT NULL,
      category text NOT NULL,
      canonical_field text NOT NULL,
      normalized_value jsonb NOT NULL,
      original_value text NOT NULL,
      conditions jsonb NOT NULL DEFAULT '[]',
      exceptions jsonb NOT NULL DEFAULT '[]',
      provider_confidence numeric(5,4) NOT NULL,
      source_quality text NOT NULL,
      validation_status text NOT NULL,
      conflict_status text NOT NULL DEFAULT 'none',
      human_review_status text NOT NULL DEFAULT 'pending',
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      prompt_template_version text NOT NULL,
      output_schema_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id,candidate_id),
      CONSTRAINT ai_extraction_candidates_run_fk FOREIGN KEY (organization_id,case_id,run_id) REFERENCES ai_extraction_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_extraction_candidates_tenant_identity_unique UNIQUE (organization_id,case_id,run_id,candidate_id),
      CONSTRAINT ai_extraction_candidates_valid CHECK (candidate_id ~ '^[a-zA-Z0-9_.-]{1,80}$' AND category IN ('policy_identity','coverage','deductible','service_rule','part_rule','replacement_vehicle','assistance','valuation','exclusion','required_document','special_condition') AND canonical_field ~ '^[a-z0-9_.-]{1,120}$' AND char_length(original_value) BETWEEN 1 AND 1000 AND pg_column_size(normalized_value)<=100000 AND jsonb_typeof(conditions)='array' AND jsonb_array_length(conditions)<=20 AND pg_column_size(conditions)<=20000 AND jsonb_typeof(exceptions)='array' AND jsonb_array_length(exceptions)<=20 AND pg_column_size(exceptions)<=20000 AND provider_confidence BETWEEN 0 AND 1 AND source_quality IN ('high','medium','low','control_required') AND validation_status IN ('validated','control_required','rejected_evidence') AND conflict_status IN ('none','duplicate','conflict_detected','control_required') AND human_review_status IN ('pending','control_required') AND char_length(provider_version) BETWEEN 1 AND 80 AND char_length(model_id) BETWEEN 1 AND 80 AND prompt_template_version='policy-ai-extraction/1.0.0' AND output_schema_version='policy-ai-candidates/1.0.0')
    );

    CREATE TABLE ai_candidate_source_links (
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      candidate_id text NOT NULL,
      bundle_id uuid NOT NULL,
      source_anchor_id text NOT NULL,
      PRIMARY KEY (run_id,candidate_id,source_anchor_id),
      CONSTRAINT ai_candidate_source_links_candidate_fk FOREIGN KEY (organization_id,case_id,run_id,candidate_id) REFERENCES ai_extraction_candidates(organization_id,case_id,run_id,candidate_id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_source_links_run_bundle_fk FOREIGN KEY (organization_id,case_id,run_id,bundle_id) REFERENCES ai_extraction_runs(organization_id,case_id,id,source_bundle_id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_source_links_anchor_fk FOREIGN KEY (organization_id,case_id,bundle_id,source_anchor_id) REFERENCES ai_source_bundle_items(organization_id,case_id,bundle_id,source_anchor_id) ON DELETE RESTRICT
    );

    CREATE TABLE ai_candidate_conflicts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      left_candidate_id text NOT NULL,
      right_candidate_id text NOT NULL,
      status text NOT NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_candidate_conflicts_left_fk FOREIGN KEY (organization_id,case_id,run_id,left_candidate_id) REFERENCES ai_extraction_candidates(organization_id,case_id,run_id,candidate_id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_conflicts_right_fk FOREIGN KEY (organization_id,case_id,run_id,right_candidate_id) REFERENCES ai_extraction_candidates(organization_id,case_id,run_id,candidate_id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_conflicts_pair_unique UNIQUE (run_id,left_candidate_id,right_candidate_id,reason),
      CONSTRAINT ai_candidate_conflicts_valid CHECK (left_candidate_id<>right_candidate_id AND status IN ('duplicate','conflict_detected','control_required') AND reason ~ '^[A-Z0-9_]{1,64}$')
    );

    CREATE TABLE ai_usage_ledger (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      provider_id text NOT NULL,
      model_id text NOT NULL,
      request_hash text NOT NULL,
      input_characters integer NOT NULL,
      output_characters integer NOT NULL DEFAULT 0,
      estimated_cost_minor bigint NOT NULL,
      actual_cost_minor bigint,
      status text NOT NULL,
      safe_error_code text,
      started_at timestamptz NOT NULL,
      completed_at timestamptz,
      CONSTRAINT ai_usage_ledger_run_fk FOREIGN KEY (organization_id,case_id,run_id) REFERENCES ai_extraction_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_usage_ledger_request_unique UNIQUE (organization_id,run_id,request_hash,status),
      CONSTRAINT ai_usage_ledger_valid CHECK (request_hash ~ '^[a-f0-9]{64}$' AND input_characters BETWEEN 0 AND 200000 AND output_characters BETWEEN 0 AND 1000000 AND estimated_cost_minor BETWEEN 0 AND 9007199254740991 AND (actual_cost_minor IS NULL OR actual_cost_minor BETWEEN 0 AND 9007199254740991) AND status IN ('provider_disabled','budget_blocked','completed','failed','cancelled') AND (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{1,64}$'))
    );
    CREATE INDEX ai_usage_ledger_org_month_idx ON ai_usage_ledger (organization_id,started_at);

    CREATE FUNCTION ai_source_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI source bundle is append-only' USING ERRCODE='restrict_violation'; END IF;
      IF OLD.status='ready' THEN RAISE EXCEPTION 'ready AI source bundle is immutable' USING ERRCODE='restrict_violation'; END IF;
      IF NEW.status='ready' AND (NEW.source_count<1 OR NEW.input_characters<1 OR (SELECT count(*) FROM ai_source_bundle_items WHERE bundle_id=NEW.id)<>NEW.source_count) THEN RAISE EXCEPTION 'AI source bundle is incomplete' USING ERRCODE='check_violation'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ai_source_bundle_guard BEFORE UPDATE OR DELETE ON ai_source_bundles FOR EACH ROW EXECUTE FUNCTION ai_source_bundle_guard();
    CREATE FUNCTION ai_bundle_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AI source item is append-only' USING ERRCODE='restrict_violation'; END IF;
      IF EXISTS (SELECT 1 FROM ai_source_bundles b WHERE b.id=NEW.bundle_id AND b.status='ready') THEN RAISE EXCEPTION 'ready AI source bundle is immutable' USING ERRCODE='restrict_violation'; END IF;
      IF NEW.source_type='pdf_text' AND NOT EXISTS (SELECT 1 FROM document_text_extractions e JOIN document_text_extraction_segments s ON s.extraction_id=e.id JOIN document_versions dv ON dv.id=e.document_version_id JOIN documents d ON d.id=e.document_id AND d.organization_id=e.organization_id AND d.case_id=e.case_id WHERE e.id=NEW.extraction_id AND s.id=NEW.source_item_id AND e.organization_id=NEW.organization_id AND e.case_id=NEW.case_id AND e.document_id=NEW.document_id AND e.document_version_id=NEW.document_version_id AND (e.status='ready' OR (NEW.historical_selected AND e.status='stale')) AND (NEW.historical_selected OR d.current_version_id=dv.id) AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL AND s.page_number=NEW.page_number AND s.segment_text=NEW.source_text AND s.text_hash=NEW.text_hash) THEN RAISE EXCEPTION 'AI PDF source is invalid' USING ERRCODE='check_violation'; END IF;
      IF NEW.source_type='ocr' AND NOT EXISTS (SELECT 1 FROM document_ocr_runs r JOIN document_ocr_lines l ON l.ocr_run_id=r.id JOIN document_ocr_pages p ON p.id=l.page_id JOIN document_versions dv ON dv.id=r.document_version_id JOIN documents d ON d.id=r.document_id AND d.organization_id=r.organization_id AND d.case_id=r.case_id WHERE r.id=NEW.extraction_id AND l.id=NEW.source_item_id AND r.organization_id=NEW.organization_id AND r.case_id=NEW.case_id AND r.document_id=NEW.document_id AND r.document_version_id=NEW.document_version_id AND (r.status IN ('ready','partial','low_confidence','control_required') OR (NEW.historical_selected AND r.status IN ('stale','superseded'))) AND (NEW.historical_selected OR d.current_version_id=dv.id) AND p.status IN ('accepted_candidate','partial','low_confidence','control_required') AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL AND l.page_number=NEW.page_number AND l.element_text=NEW.source_text AND l.text_hash=NEW.text_hash) THEN RAISE EXCEPTION 'AI OCR source is invalid' USING ERRCODE='check_violation'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ai_bundle_item_guard BEFORE INSERT OR UPDATE OR DELETE ON ai_source_bundle_items FOR EACH ROW EXECUTE FUNCTION ai_bundle_item_guard();
    CREATE FUNCTION ai_candidate_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI provider candidate facts are immutable' USING ERRCODE='restrict_violation'; END $$;
    CREATE TRIGGER ai_candidate_immutable_guard BEFORE UPDATE OR DELETE ON ai_extraction_candidates FOR EACH ROW EXECUTE FUNCTION ai_candidate_immutable_guard();
    CREATE FUNCTION ai_candidate_source_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI candidate source links are append-only' USING ERRCODE='restrict_violation'; END $$;
    CREATE TRIGGER ai_candidate_source_link_guard BEFORE UPDATE OR DELETE ON ai_candidate_source_links FOR EACH ROW EXECUTE FUNCTION ai_candidate_source_link_guard();
    CREATE FUNCTION ai_candidate_conflict_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI candidate conflicts are append-only' USING ERRCODE='restrict_violation'; END $$;
    CREATE TRIGGER ai_candidate_conflict_guard BEFORE UPDATE OR DELETE ON ai_candidate_conflicts FOR EACH ROW EXECUTE FUNCTION ai_candidate_conflict_guard();
    CREATE FUNCTION ai_usage_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI usage ledger is append-only' USING ERRCODE='restrict_violation'; END $$;
    CREATE TRIGGER ai_usage_append_guard BEFORE UPDATE OR DELETE ON ai_usage_ledger FOR EACH ROW EXECUTE FUNCTION ai_usage_append_guard();
    CREATE FUNCTION ai_candidate_source_required_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM ai_candidate_source_links l WHERE l.run_id=NEW.run_id AND l.candidate_id=NEW.candidate_id) THEN RAISE EXCEPTION 'AI candidate source is required' USING ERRCODE='check_violation'; END IF; RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER ai_candidate_source_required_guard AFTER INSERT ON ai_extraction_candidates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_candidate_source_required_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER ai_candidate_source_required_guard ON ai_extraction_candidates; DROP FUNCTION ai_candidate_source_required_guard();
    DROP TRIGGER ai_usage_append_guard ON ai_usage_ledger; DROP FUNCTION ai_usage_append_guard();
    DROP TRIGGER ai_candidate_conflict_guard ON ai_candidate_conflicts; DROP FUNCTION ai_candidate_conflict_guard();
    DROP TRIGGER ai_candidate_source_link_guard ON ai_candidate_source_links; DROP FUNCTION ai_candidate_source_link_guard();
    DROP TRIGGER ai_candidate_immutable_guard ON ai_extraction_candidates; DROP FUNCTION ai_candidate_immutable_guard();
    DROP TRIGGER ai_bundle_item_guard ON ai_source_bundle_items; DROP FUNCTION ai_bundle_item_guard();
    DROP TRIGGER ai_source_bundle_guard ON ai_source_bundles; DROP FUNCTION ai_source_bundle_guard();
    DROP TABLE ai_usage_ledger; DROP TABLE ai_candidate_conflicts; DROP TABLE ai_candidate_source_links; DROP TABLE ai_extraction_candidates; DROP TABLE ai_extraction_runs; DROP TABLE ai_source_bundle_items; DROP TABLE ai_source_bundles; DROP TABLE ai_provider_policies;
  `)
}
