/**
 * Paket 27 - AI adaylari icin append-only insan review ve Paket 23 draft
 * promotion provenance modeli. Provider gercekleri degistirilmez.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE ai_candidate_conflicts
      ADD CONSTRAINT ai_candidate_conflicts_tenant_id_unique UNIQUE (organization_id,case_id,run_id,id);
    ALTER TABLE policy_conflicts
      ADD CONSTRAINT policy_conflicts_tenant_id_unique UNIQUE (organization_id,case_id,id);

    CREATE TABLE ai_candidate_reviews (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      candidate_id text NOT NULL,
      review_version integer NOT NULL,
      schema_version text NOT NULL,
      action text NOT NULL,
      normalized_value jsonb NOT NULL,
      original_value text NOT NULL,
      conditions jsonb NOT NULL DEFAULT '[]',
      exceptions jsonb NOT NULL DEFAULT '[]',
      source_anchor_ids text[] NOT NULL,
      reason text,
      evidence_status text NOT NULL,
      reviewed_by_user_id uuid NOT NULL,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_candidate_reviews_candidate_fk FOREIGN KEY (organization_id,case_id,run_id,candidate_id)
        REFERENCES ai_extraction_candidates(organization_id,case_id,run_id,candidate_id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_reviews_reviewer_fk FOREIGN KEY (organization_id,reviewed_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_reviews_version_unique UNIQUE (run_id,candidate_id,review_version),
      CONSTRAINT ai_candidate_reviews_tenant_version_unique UNIQUE (organization_id,case_id,run_id,candidate_id,review_version),
      CONSTRAINT ai_candidate_reviews_valid CHECK (
        review_version>=1 AND schema_version='policy-ai-human-review/1.0.0'
        AND action IN ('accepted','edited','rejected','control_required')
        AND char_length(original_value) BETWEEN 1 AND 1000
        AND pg_column_size(normalized_value)<=100000
        AND jsonb_typeof(conditions)='array' AND jsonb_array_length(conditions)<=20 AND pg_column_size(conditions)<=20000
        AND jsonb_typeof(exceptions)='array' AND jsonb_array_length(exceptions)<=20 AND pg_column_size(exceptions)<=20000
        AND cardinality(source_anchor_ids) BETWEEN 1 AND 20
        AND evidence_status IN ('validated','control_required','rejected_evidence')
        AND (action NOT IN ('edited','rejected','control_required') OR char_length(btrim(reason)) BETWEEN 1 AND 500)
        AND (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
        AND (action NOT IN ('accepted','edited') OR evidence_status<>'rejected_evidence')
      )
    );
    CREATE INDEX ai_candidate_reviews_latest_idx ON ai_candidate_reviews(run_id,candidate_id,review_version DESC);

    CREATE TABLE policy_analysis_ai_facts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      analysis_version_id uuid NOT NULL,
      category text NOT NULL,
      canonical_field text NOT NULL,
      normalized_value jsonb NOT NULL,
      original_value text NOT NULL,
      conditions jsonb NOT NULL DEFAULT '[]',
      exceptions jsonb NOT NULL DEFAULT '[]',
      review_action text NOT NULL,
      origin_run_id uuid NOT NULL,
      origin_candidate_id text NOT NULL,
      origin_review_version integer NOT NULL,
      source_anchor_ids text[] NOT NULL,
      provider_confidence numeric(5,4) NOT NULL,
      source_quality text NOT NULL,
      provider_id text NOT NULL,
      provider_version text NOT NULL,
      model_id text NOT NULL,
      reviewed_by_user_id uuid NOT NULL,
      reviewed_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT policy_analysis_ai_facts_version_fk FOREIGN KEY (organization_id,case_id,analysis_version_id)
        REFERENCES policy_analysis_versions(organization_id,case_id,id) ON DELETE CASCADE,
      CONSTRAINT policy_analysis_ai_facts_review_fk FOREIGN KEY (organization_id,case_id,origin_run_id,origin_candidate_id,origin_review_version)
        REFERENCES ai_candidate_reviews(organization_id,case_id,run_id,candidate_id,review_version) ON DELETE RESTRICT,
      CONSTRAINT policy_analysis_ai_facts_reviewer_fk FOREIGN KEY (organization_id,reviewed_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT policy_analysis_ai_facts_origin_unique UNIQUE (analysis_version_id,origin_run_id,origin_candidate_id),
      CONSTRAINT policy_analysis_ai_facts_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT policy_analysis_ai_facts_valid CHECK (
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
      )
    );

    ALTER TABLE policy_evidence_links DROP CONSTRAINT policy_evidence_links_owner_valid;
    ALTER TABLE policy_evidence_links ADD CONSTRAINT policy_evidence_links_owner_valid
      CHECK (owner_type IN ('coverage','deductible','service_rule','part_rule','replacement_vehicle_rule','exclusion','required_document','scenario_rule','ai_candidate_fact'));

    CREATE TABLE ai_candidate_promotions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      run_id uuid NOT NULL,
      schema_version text NOT NULL,
      review_set_hash text NOT NULL,
      analysis_id uuid NOT NULL,
      analysis_version_id uuid NOT NULL,
      analysis_version integer NOT NULL,
      promoted_candidate_count integer NOT NULL,
      preserved_conflict_count integer NOT NULL,
      promoted_by_user_id uuid NOT NULL,
      promoted_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_candidate_promotions_run_fk FOREIGN KEY (organization_id,case_id,run_id)
        REFERENCES ai_extraction_runs(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotions_analysis_fk FOREIGN KEY (organization_id,case_id,analysis_id)
        REFERENCES policy_analyses(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotions_version_fk FOREIGN KEY (organization_id,case_id,analysis_version_id)
        REFERENCES policy_analysis_versions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotions_actor_fk FOREIGN KEY (organization_id,promoted_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotions_review_unique UNIQUE (run_id,review_set_hash),
      CONSTRAINT ai_candidate_promotions_target_unique UNIQUE (analysis_version_id),
      CONSTRAINT ai_candidate_promotions_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT ai_candidate_promotions_valid CHECK (
        schema_version='policy-ai-promotion/1.0.0' AND review_set_hash ~ '^[a-f0-9]{64}$'
        AND analysis_version>=1 AND promoted_candidate_count BETWEEN 1 AND 100
        AND preserved_conflict_count BETWEEN 0 AND 1000
      )
    );

    CREATE TABLE ai_candidate_promotion_items (
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      promotion_id uuid NOT NULL,
      run_id uuid NOT NULL,
      candidate_id text NOT NULL,
      review_version integer NOT NULL,
      policy_fact_id uuid NOT NULL,
      PRIMARY KEY (promotion_id,candidate_id),
      CONSTRAINT ai_candidate_promotion_items_promotion_fk FOREIGN KEY (organization_id,case_id,promotion_id)
        REFERENCES ai_candidate_promotions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotion_items_review_fk FOREIGN KEY (organization_id,case_id,run_id,candidate_id,review_version)
        REFERENCES ai_candidate_reviews(organization_id,case_id,run_id,candidate_id,review_version) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotion_items_fact_fk FOREIGN KEY (organization_id,case_id,policy_fact_id)
        REFERENCES policy_analysis_ai_facts(organization_id,case_id,id) ON DELETE RESTRICT
    );

    CREATE TABLE ai_candidate_promotion_conflicts (
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      promotion_id uuid NOT NULL,
      run_id uuid NOT NULL,
      conflict_id uuid NOT NULL,
      left_candidate_id text NOT NULL,
      right_candidate_id text NOT NULL,
      status text NOT NULL,
      reason text NOT NULL,
      promoted_policy_conflict_id uuid,
      PRIMARY KEY (promotion_id,conflict_id),
      CONSTRAINT ai_candidate_promotion_conflicts_promotion_fk FOREIGN KEY (organization_id,case_id,promotion_id)
        REFERENCES ai_candidate_promotions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotion_conflicts_source_fk FOREIGN KEY (organization_id,case_id,run_id,conflict_id)
        REFERENCES ai_candidate_conflicts(organization_id,case_id,run_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotion_conflicts_target_fk FOREIGN KEY (organization_id,case_id,promoted_policy_conflict_id)
        REFERENCES policy_conflicts(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT ai_candidate_promotion_conflicts_valid CHECK (
        left_candidate_id<>right_candidate_id AND status IN ('duplicate','conflict_detected','control_required')
        AND reason ~ '^[A-Z0-9_]{1,64}$'
      )
    );

    CREATE FUNCTION ai_candidate_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE expected_version integer; expected_anchors text[]; candidate ai_extraction_candidates%ROWTYPE;
    BEGIN
      SELECT * INTO candidate FROM ai_extraction_candidates c
        WHERE c.organization_id=NEW.organization_id AND c.case_id=NEW.case_id AND c.run_id=NEW.run_id AND c.candidate_id=NEW.candidate_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'AI candidate review target is invalid' USING ERRCODE='foreign_key_violation'; END IF;
      SELECT coalesce(max(r.review_version),0)+1 INTO expected_version FROM ai_candidate_reviews r
        WHERE r.run_id=NEW.run_id AND r.candidate_id=NEW.candidate_id;
      IF NEW.review_version<>expected_version THEN RAISE EXCEPTION 'AI candidate review version is stale' USING ERRCODE='serialization_failure'; END IF;
      SELECT array_agg(l.source_anchor_id ORDER BY l.source_anchor_id) INTO expected_anchors FROM ai_candidate_source_links l
        WHERE l.run_id=NEW.run_id AND l.candidate_id=NEW.candidate_id;
      IF NEW.source_anchor_ids<>expected_anchors THEN RAISE EXCEPTION 'AI candidate review sources cannot change' USING ERRCODE='check_violation'; END IF;
      IF NEW.action='accepted' AND (NEW.normalized_value<>candidate.normalized_value OR NEW.original_value<>candidate.original_value
        OR NEW.conditions<>candidate.conditions OR NEW.exceptions<>candidate.exceptions) THEN
        RAISE EXCEPTION 'accepted AI candidate must preserve provider facts' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ai_candidate_review_guard BEFORE INSERT ON ai_candidate_reviews FOR EACH ROW EXECUTE FUNCTION ai_candidate_review_guard();

    CREATE FUNCTION policy_analysis_ai_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE review ai_candidate_reviews%ROWTYPE;
    BEGIN
      SELECT * INTO review FROM ai_candidate_reviews r
        WHERE r.organization_id=NEW.organization_id AND r.case_id=NEW.case_id AND r.run_id=NEW.origin_run_id
          AND r.candidate_id=NEW.origin_candidate_id AND r.review_version=NEW.origin_review_version;
      IF NOT FOUND OR review.action NOT IN ('accepted','edited') OR NEW.review_action<>review.action
        OR NEW.normalized_value<>review.normalized_value OR NEW.original_value<>review.original_value
        OR NEW.conditions<>review.conditions OR NEW.exceptions<>review.exceptions
        OR NEW.source_anchor_ids<>review.source_anchor_ids OR NEW.reviewed_by_user_id<>review.reviewed_by_user_id
        OR NEW.reviewed_at<>review.reviewed_at THEN
        RAISE EXCEPTION 'promoted AI fact must match reviewed candidate snapshot' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER policy_analysis_ai_fact_guard BEFORE INSERT ON policy_analysis_ai_facts FOR EACH ROW EXECUTE FUNCTION policy_analysis_ai_fact_guard();

    CREATE FUNCTION ai_review_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'AI human review and promotion history is append-only' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER ai_candidate_reviews_append_guard BEFORE UPDATE OR DELETE ON ai_candidate_reviews FOR EACH ROW EXECUTE FUNCTION ai_review_append_guard();
    CREATE TRIGGER ai_candidate_promotions_append_guard BEFORE UPDATE OR DELETE ON ai_candidate_promotions FOR EACH ROW EXECUTE FUNCTION ai_review_append_guard();
    CREATE TRIGGER ai_candidate_promotion_items_append_guard BEFORE UPDATE OR DELETE ON ai_candidate_promotion_items FOR EACH ROW EXECUTE FUNCTION ai_review_append_guard();
    CREATE TRIGGER ai_candidate_promotion_conflicts_append_guard BEFORE UPDATE OR DELETE ON ai_candidate_promotion_conflicts FOR EACH ROW EXECUTE FUNCTION ai_review_append_guard();
    CREATE TRIGGER policy_analysis_ai_facts_append_guard BEFORE UPDATE OR DELETE ON policy_analysis_ai_facts FOR EACH ROW EXECUTE FUNCTION ai_review_append_guard();
    CREATE TRIGGER policy_analysis_ai_facts_approved_guard BEFORE INSERT OR UPDATE OR DELETE ON policy_analysis_ai_facts FOR EACH ROW EXECUTE FUNCTION policy_fact_approved_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER policy_analysis_ai_facts_approved_guard ON policy_analysis_ai_facts;
    DROP TRIGGER policy_analysis_ai_facts_append_guard ON policy_analysis_ai_facts;
    DROP TRIGGER ai_candidate_promotion_conflicts_append_guard ON ai_candidate_promotion_conflicts;
    DROP TRIGGER ai_candidate_promotion_items_append_guard ON ai_candidate_promotion_items;
    DROP TRIGGER ai_candidate_promotions_append_guard ON ai_candidate_promotions;
    DROP TRIGGER ai_candidate_reviews_append_guard ON ai_candidate_reviews;
    DROP FUNCTION ai_review_append_guard();
    DROP TRIGGER policy_analysis_ai_fact_guard ON policy_analysis_ai_facts;
    DROP FUNCTION policy_analysis_ai_fact_guard();
    DROP TRIGGER ai_candidate_review_guard ON ai_candidate_reviews;
    DROP FUNCTION ai_candidate_review_guard();
    DROP TABLE ai_candidate_promotion_conflicts;
    DROP TABLE ai_candidate_promotion_items;
    DROP TABLE ai_candidate_promotions;
    ALTER TABLE policy_evidence_links DROP CONSTRAINT policy_evidence_links_owner_valid;
    ALTER TABLE policy_evidence_links ADD CONSTRAINT policy_evidence_links_owner_valid
      CHECK (owner_type IN ('coverage','deductible','service_rule','part_rule','replacement_vehicle_rule','exclusion','required_document','scenario_rule'));
    DROP TABLE policy_analysis_ai_facts;
    DROP TABLE ai_candidate_reviews;
    ALTER TABLE policy_conflicts DROP CONSTRAINT policy_conflicts_tenant_id_unique;
    ALTER TABLE ai_candidate_conflicts DROP CONSTRAINT ai_candidate_conflicts_tenant_id_unique;
  `)
}
