/*
 * Paket 64 ara dilim — AI çıktı ve talimat sürümü 2.0.0 (HB-2026-074).
 *
 * Satır bazlı kategori dağılımı eklendiği için `labor-allocation-ai` ve
 * `labor-allocation-suggestion` sürümleri yükseldi. 0031/0036 bu iki alanı
 * TEK literale sabitliyordu; yeni koşular bu yüzden yazılamıyordu.
 *
 * Kısıt GEVŞETİLMEZ, YALNIZ İKİ SÜRÜME açılır: eski koşular kendi 1.0.0
 * sürümleriyle okunmaya devam eder ve sessizce yeniden yorumlanmaz; yeni
 * koşular 2.0.0 yazar. Serbest metne dönüştürmek sürüm denetimini
 * tamamen kaldırırdı, o yüzden yapılmadı.
 */
export function up(pgm) {
  pgm.sql(`
    ALTER TABLE labor_allocation_runs DROP CONSTRAINT labor_allocation_runs_valid;
  `)

  pgm.sql(`
    ALTER TABLE labor_allocation_runs
      ADD CONSTRAINT labor_allocation_runs_valid CHECK (
        source_sheet_version>=1
        AND evidence_hash ~ '^[a-f0-9]{64}$'
        AND plan_hash ~ '^[a-f0-9]{64}$'
        AND provider_id IN (
          'deterministic-success','deterministic-invalid-schema','deterministic-timeout',
          'deterministic-failure','gemini-generate-content'
        )
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND prompt_template_version IN ('labor-allocation-ai/1.0.0','labor-allocation-ai/2.0.0')
        AND output_schema_version IN ('labor-allocation-suggestion/1.0.0','labor-allocation-suggestion/2.0.0')
        AND operation_types_version='labor-operation-types/1.0.0'
        AND rule_version='labor-allocation-rules/1.0.0'
        AND status IN (
          'provider_disabled','budget_blocked','queued','running','review_required','failed',
          'outcome_unknown','cancel_requested','cancelled'
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
            AND provider_retention_mode='local_only'
          )
        )
        -- Paket 62 ilerleme alanları: analiz başlarken birlikte yazılır.
        AND ((total_line_count IS NULL) = (total_chunk_count IS NULL))
        AND ((total_line_count IS NULL) = (chunk_size IS NULL))
        AND (total_line_count IS NULL OR total_line_count BETWEEN 1 AND 200)
        AND (total_chunk_count IS NULL OR total_chunk_count BETWEEN 1 AND 200)
        AND (chunk_size IS NULL OR chunk_size BETWEEN 1 AND 200)
        -- İptal zamanı yalnız iptal akışında anlamlıdır.
        AND (cancel_requested_at IS NULL OR status IN ('cancel_requested','cancelled','failed','outcome_unknown','review_required'))
        AND (status<>'cancelled' OR cancel_requested_at IS NOT NULL)
        AND (status<>'cancel_requested' OR cancel_requested_at IS NOT NULL)
      );
  `)
}

export function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM labor_allocation_runs
         WHERE output_schema_version='labor-allocation-suggestion/2.0.0'
      ) THEN
        RAISE EXCEPTION 'cannot roll back: category-axis runs exist'
          USING ERRCODE='restrict_violation';
      END IF;
    END $$;

    ALTER TABLE labor_allocation_runs DROP CONSTRAINT labor_allocation_runs_valid;
  `)

  pgm.sql(`
    ALTER TABLE labor_allocation_runs
      ADD CONSTRAINT labor_allocation_runs_valid CHECK (
        source_sheet_version>=1
        AND evidence_hash ~ '^[a-f0-9]{64}$'
        AND plan_hash ~ '^[a-f0-9]{64}$'
        AND provider_id IN (
          'deterministic-success','deterministic-invalid-schema','deterministic-timeout',
          'deterministic-failure','gemini-generate-content'
        )
        AND char_length(provider_version) BETWEEN 1 AND 80
        AND char_length(model_id) BETWEEN 1 AND 80
        AND prompt_template_version='labor-allocation-ai/1.0.0'
        AND output_schema_version='labor-allocation-suggestion/1.0.0'
        AND operation_types_version='labor-operation-types/1.0.0'
        AND rule_version='labor-allocation-rules/1.0.0'
        AND status IN (
          'provider_disabled','budget_blocked','queued','running','review_required','failed',
          'outcome_unknown','cancel_requested','cancelled'
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
            AND provider_retention_mode='local_only'
          )
        )
        -- Paket 62 ilerleme alanları: analiz başlarken birlikte yazılır.
        AND ((total_line_count IS NULL) = (total_chunk_count IS NULL))
        AND ((total_line_count IS NULL) = (chunk_size IS NULL))
        AND (total_line_count IS NULL OR total_line_count BETWEEN 1 AND 200)
        AND (total_chunk_count IS NULL OR total_chunk_count BETWEEN 1 AND 200)
        AND (chunk_size IS NULL OR chunk_size BETWEEN 1 AND 200)
        -- İptal zamanı yalnız iptal akışında anlamlıdır.
        AND (cancel_requested_at IS NULL OR status IN ('cancel_requested','cancelled','failed','outcome_unknown','review_required'))
        AND (status<>'cancelled' OR cancel_requested_at IS NOT NULL)
        AND (status<>'cancel_requested' OR cancel_requested_at IS NOT NULL)
      );
  `)
}
