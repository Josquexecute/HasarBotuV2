/**
 * Paket 62 — AI analiz ilerlemesi ve dayanıklılığı (HB-2026-069).
 *
 * Paket 61 chunking'i büyük föyleri çalışır hale getirdi ama 100 satır ~85 sn
 * sürüyor ve kullanıcı bu süre boyunca donmuş bir ekran görüyordu. Bu migration
 * run'a GERÇEK bir durum modeli ve ilerleme alanları ekler.
 *
 * İlerleme İKİNCİ BİR KAYIT SİSTEMİ KURMAZ: tamamlanan chunk sayısı mevcut
 * `labor_allocation_provider_receipts` satırlarından sayılır. Run'a yalnız
 * receipt'lerden türetilemeyen üst bilgiler eklenir (toplam satır, toplam
 * chunk, chunk boyutu) — bunlar analiz başlarken bilinir ve sonradan değişmez.
 *
 * Durum modeli:
 *   queued → running → review_required | failed | outcome_unknown
 *   running → cancel_requested → cancelled
 * `cancel_requested` bilinçli olarak ayrı bir durumdur: iptal isteği alınmış
 * ama sonucun gerçekten durdurulduğu HENÜZ doğrulanmamıştır. Sonuç belirsizken
 * kullanıcıya "iptal edildi" denmez.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.sql(`
    ALTER TABLE labor_allocation_runs
      ADD COLUMN total_line_count integer,
      ADD COLUMN total_chunk_count integer,
      ADD COLUMN chunk_size integer,
      ADD COLUMN cancel_requested_at timestamptz,
      ADD COLUMN progress_updated_at timestamptz;

    ALTER TABLE labor_allocation_runs
      DROP CONSTRAINT labor_allocation_runs_valid;
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

    CREATE INDEX labor_allocation_runs_active_idx
      ON labor_allocation_runs (organization_id,case_id,source_sheet_version)
      WHERE status IN ('queued','running','cancel_requested');
  `)

  // Durum geçişleri: yalnız queued/running/cancel_requested mutasyona açıktır.
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
        -- İş bölünmesi run kimliğinin parçasıdır; sonradan değiştirilemez.
        OR NEW.total_line_count IS DISTINCT FROM OLD.total_line_count
        OR NEW.total_chunk_count IS DISTINCT FROM OLD.total_chunk_count
        OR NEW.chunk_size IS DISTINCT FROM OLD.chunk_size
      THEN
        RAISE EXCEPTION 'labor allocation run identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      -- Yalnız aktif durumlar güncellenebilir; terminal run dokunulmazdır.
      IF OLD.status NOT IN ('queued','running','cancel_requested') THEN
        RAISE EXCEPTION 'terminal labor allocation run is immutable' USING ERRCODE='restrict_violation';
      END IF;
      -- İptal isteği geri alınamaz: cancel_requested yalnız cancelled veya
      -- gerçekten tamamlanmış bir sonuca gidebilir.
      IF OLD.status='cancel_requested' AND NEW.status IN ('queued','running') THEN
        RAISE EXCEPTION 'cancel request cannot be reverted' USING ERRCODE='restrict_violation';
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
      -- İptal edilmiş veya başarısız run hiçbir öneri satırı taşıyamaz:
      -- kısmi sonuç kullanıcıya sızmaz.
      IF NEW.status IN ('cancelled','failed','outcome_unknown') THEN
        SELECT count(*)::int INTO actual_lines
          FROM labor_allocation_line_suggestions
         WHERE run_id=NEW.id;
        IF actual_lines > 0 THEN
          RAISE EXCEPTION 'unsuccessful labor allocation run cannot carry suggestions'
            USING ERRCODE='check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
  `)

  // Satır önerileri yalnız `running` run'a eklenebilirdi; `queued` de aktif
  // sayılmaz çünkü sağlayıcı çağrısı `running` durumunda yapılır.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION labor_allocation_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE run_status text;
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'labor allocation line suggestion is immutable' USING ERRCODE='restrict_violation';
      END IF;
      SELECT status INTO run_status FROM labor_allocation_runs WHERE id=NEW.run_id;
      IF run_status IS DISTINCT FROM 'running' THEN
        RAISE EXCEPTION 'labor allocation line suggestion requires running run'
          USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;
  `)
}

export async function down(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION labor_allocation_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE run_status text;
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'labor allocation line suggestion is immutable' USING ERRCODE='restrict_violation';
      END IF;
      SELECT status INTO run_status FROM labor_allocation_runs WHERE id=NEW.run_id;
      IF run_status IS DISTINCT FROM 'running' THEN
        RAISE EXCEPTION 'labor allocation line suggestion requires running run'
          USING ERRCODE='restrict_violation';
      END IF;
      RETURN NEW;
    END $$;

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

    DROP INDEX labor_allocation_runs_active_idx;

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
            AND provider_retention_mode='local_only'
          )
        )
      );

    ALTER TABLE labor_allocation_runs
      DROP COLUMN progress_updated_at,
      DROP COLUMN cancel_requested_at,
      DROP COLUMN chunk_size,
      DROP COLUMN total_chunk_count,
      DROP COLUMN total_line_count;
  `)
}
