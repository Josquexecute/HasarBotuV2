/**
 * Paket 57 — eksper baseline kanıtı (HB-2026-064).
 *
 * Baseline için YENİ kaynak tablo açılmaz: kanıt, aynı dosyanın önceki
 * immutable föy sürümüdür ve `labor_sheet_versions` içinde zaten durur.
 * Burada yalnız hangi baseline'ın kullanıldığı ve satır bazlı karşılaştırma
 * sonucu, öneriyle birlikte immutable biçimde saklanır.
 *
 * AI önerileri (`labor_allocation_line_suggestions`) hiçbir koşulda baseline
 * kaynağı DEĞİLDİR; bu ayrım veri kaynağında yapılır.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.sql(`
    ALTER TABLE labor_allocation_runs
      ADD COLUMN baseline_sheet_version integer,
      ADD COLUMN baseline_match_version text,
      ADD COLUMN baseline_matched_line_count integer NOT NULL DEFAULT 0;

    ALTER TABLE labor_allocation_runs
      ADD CONSTRAINT labor_allocation_runs_baseline_valid CHECK (
        (baseline_sheet_version IS NULL) = (baseline_match_version IS NULL)
        AND (baseline_sheet_version IS NULL OR baseline_sheet_version >= 1)
        AND (baseline_match_version IS NULL
          OR baseline_match_version = 'labor-baseline-match/1.0.0')
        AND baseline_matched_line_count >= 0
        AND (baseline_sheet_version IS NOT NULL OR baseline_matched_line_count = 0)
      );

    ALTER TABLE labor_allocation_line_suggestions
      ADD COLUMN baseline_part_amount_minor bigint,
      ADD COLUMN baseline_labor_amount_minor bigint,
      ADD COLUMN baseline_part_ratio double precision,
      ADD COLUMN baseline_suggested_part_ratio double precision,
      ADD COLUMN baseline_conflict boolean NOT NULL DEFAULT false;

    -- Baseline alanları ya tamamen doludur ya tamamen boştur; çelişki bayrağı
    -- yalnız eşleşmiş satırda true olabilir. Böylece "baseline yok ama çelişki
    -- var" gibi anlamsız bir kayıt oluşamaz.
    ALTER TABLE labor_allocation_line_suggestions
      ADD CONSTRAINT labor_allocation_line_suggestions_baseline_valid CHECK (
        (
          (baseline_part_amount_minor IS NULL)
          = (baseline_labor_amount_minor IS NULL)
        )
        AND (
          (baseline_part_amount_minor IS NULL)
          = (baseline_part_ratio IS NULL)
        )
        AND (
          (baseline_part_amount_minor IS NULL)
          = (baseline_suggested_part_ratio IS NULL)
        )
        AND (baseline_part_amount_minor IS NULL OR baseline_part_amount_minor >= 0)
        AND (baseline_labor_amount_minor IS NULL OR baseline_labor_amount_minor >= 0)
        AND (baseline_part_ratio IS NULL
          OR (baseline_part_ratio >= 0 AND baseline_part_ratio <= 1))
        AND (baseline_suggested_part_ratio IS NULL
          OR (baseline_suggested_part_ratio >= 0 AND baseline_suggested_part_ratio <= 1))
        AND (baseline_conflict = false OR baseline_part_amount_minor IS NOT NULL)
      );
  `)

  // Run kimliğinin değişmezliği: baseline seçimi de kimliğin parçasıdır.
  // Sonradan değiştirilebilseydi, saklanan öneri başka bir kanıta ait
  // gösterilebilirdi.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION labor_allocation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actual_lines integer;
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor allocation run is append-only' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.case_id IS DISTINCT FROM OLD.case_id
        OR NEW.source_sheet_id IS DISTINCT FROM OLD.source_sheet_id
        OR NEW.source_sheet_version IS DISTINCT FROM OLD.source_sheet_version
        OR NEW.baseline_sheet_version IS DISTINCT FROM OLD.baseline_sheet_version
        OR NEW.baseline_match_version IS DISTINCT FROM OLD.baseline_match_version
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
        RAISE EXCEPTION 'labor allocation run identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status <> 'running' THEN
        RAISE EXCEPTION 'terminal labor allocation run is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='review_required' THEN
        SELECT count(*)::int INTO actual_lines
          FROM labor_allocation_line_suggestions
         WHERE run_id=NEW.id;
        IF NEW.line_count IS NULL OR NEW.line_count <> actual_lines THEN
          RAISE EXCEPTION 'labor allocation line count mismatch' USING ERRCODE='check_violation';
        END IF;
        IF NEW.baseline_matched_line_count > actual_lines THEN
          RAISE EXCEPTION 'labor allocation baseline match count invalid' USING ERRCODE='check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
  `)
}

export async function down(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION labor_allocation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        RAISE EXCEPTION 'labor allocation run identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status <> 'running' THEN
        RAISE EXCEPTION 'terminal labor allocation run is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF NEW.status='review_required' THEN
        SELECT count(*)::int INTO actual_lines
          FROM labor_allocation_line_suggestions
         WHERE run_id=NEW.id;
        IF NEW.line_count IS NULL OR NEW.line_count <> actual_lines THEN
          RAISE EXCEPTION 'labor allocation line count mismatch' USING ERRCODE='check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
  `)

  pgm.sql(`
    ALTER TABLE labor_allocation_line_suggestions
      DROP CONSTRAINT labor_allocation_line_suggestions_baseline_valid,
      DROP COLUMN baseline_part_amount_minor,
      DROP COLUMN baseline_labor_amount_minor,
      DROP COLUMN baseline_part_ratio,
      DROP COLUMN baseline_suggested_part_ratio,
      DROP COLUMN baseline_conflict;

    ALTER TABLE labor_allocation_runs
      DROP CONSTRAINT labor_allocation_runs_baseline_valid,
      DROP COLUMN baseline_sheet_version,
      DROP COLUMN baseline_match_version,
      DROP COLUMN baseline_matched_line_count;
  `)
}
