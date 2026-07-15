/**
 * Paket 25 - offline OCR evidence, page quality and geometric locators.
 * Absolute paths, PDF bytes, full-document text and engine secrets are never stored.
 */
export const shorthands = undefined

const RUN_STATUSES = "('queued','rendering','preprocessing','recognizing','normalizing','validating','ready','partial','low_confidence','control_required','failed','cancelled','stale','superseded')"
const PAGE_STATUSES = "('accepted_candidate','partial','low_confidence','unreadable','unsupported','failed','control_required')"

export function up(pgm) {
  pgm.createTable('document_ocr_runs', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    document_id: { type: 'uuid', notNull: true },
    document_version_id: { type: 'uuid', notNull: true },
    text_extraction_id: { type: 'uuid', notNull: true },
    ocr_version: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true, default: 'queued' },
    engine_name: { type: 'text', notNull: true },
    engine_version: { type: 'text', notNull: true },
    language_data_version: { type: 'text', notNull: true },
    language_data_hash: { type: 'text', notNull: true },
    language_mode: { type: 'text', notNull: true },
    render_profile: { type: 'text', notNull: true },
    render_profile_version: { type: 'text', notNull: true },
    preprocessing_version: { type: 'text', notNull: true },
    quality_version: { type: 'text', notNull: true },
    preprocessing_config: { type: 'jsonb', notNull: true },
    normalization_version: { type: 'text', notNull: true },
    locator_version: { type: 'text', notNull: true },
    offset_unit: { type: 'text', notNull: true },
    source_hash: { type: 'text', notNull: true },
    source_size: { type: 'bigint', notNull: true },
    eligible_page_count: { type: 'integer', notNull: true },
    selected_page_numbers: { type: 'integer[]', notNull: true },
    processed_page_count: { type: 'integer', notNull: true, default: 0 },
    ready_page_count: { type: 'integer', notNull: true, default: 0 },
    low_quality_page_count: { type: 'integer', notNull: true, default: 0 },
    empty_page_count: { type: 'integer', notNull: true, default: 0 },
    failed_page_count: { type: 'integer', notNull: true, default: 0 },
    block_count: { type: 'integer', notNull: true, default: 0 },
    line_count: { type: 'integer', notNull: true, default: 0 },
    word_count: { type: 'integer', notNull: true, default: 0 },
    normalized_character_count: { type: 'integer', notNull: true, default: 0 },
    mean_confidence: { type: 'numeric(6,3)' },
    output_hash: { type: 'text' },
    failure_code: { type: 'text' },
    active_job_id: { type: 'uuid' },
    last_chunk_sequence: { type: 'integer', notNull: true, default: -1 },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    request_id: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_document_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','document_id'], references: 'documents (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_version_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','document_version_id'], references: 'document_versions (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_extraction_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','text_extraction_id'], references: 'document_text_extractions (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_org_case_id_unique', { unique: ['organization_id','case_id','id'] })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_version_unique', { unique: ['document_version_id','ocr_version'] })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_status_valid', { check: `status IN ${RUN_STATUSES}` })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_engine_valid', { check: "engine_name='tesseract.js' AND engine_version='7.0.0' AND language_data_version='tessdata-4.0.0-full/1.0.0' AND render_profile IN ('standard','high_quality') AND render_profile_version IN ('policy-ocr-render-standard/1.0.0','policy-ocr-render-high-quality/1.0.0') AND (render_profile='standard')=(render_profile_version='policy-ocr-render-standard/1.0.0') AND preprocessing_version='policy-ocr-preprocessing/1.0.0' AND quality_version='policy-ocr-quality/1.0.0' AND normalization_version='policy-ocr-normalization/1.0.0' AND locator_version='policy-ocr-locator/1.0.0' AND offset_unit='unicode_code_point'" })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_language_valid', { check: "language_mode IN ('tur','eng','tur+eng')" })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_hash_valid', { check: "source_hash ~ '^[a-f0-9]{64}$' AND language_data_hash ~ '^[a-f0-9]{64}$' AND (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$')" })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_counts_valid', { check: `ocr_version>=1 AND version>=1 AND last_chunk_sequence>=-1 AND source_size>=0 AND eligible_page_count>=1 AND cardinality(selected_page_numbers)=eligible_page_count AND 0<ALL(selected_page_numbers) AND processed_page_count>=0 AND ready_page_count>=0 AND low_quality_page_count>=0 AND empty_page_count>=0 AND failed_page_count>=0 AND block_count>=0 AND line_count>=0 AND word_count>=0 AND normalized_character_count>=0 AND processed_page_count=ready_page_count+low_quality_page_count+empty_page_count+failed_page_count AND processed_page_count<=eligible_page_count` })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_confidence_valid', { check: 'mean_confidence IS NULL OR mean_confidence BETWEEN 0 AND 100' })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_failure_safe', { check: "failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'" })
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_terminal_consistent', { check: `(status IN ('ready','partial','low_confidence','control_required') AND output_hash IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL) OR (status='failed' AND completed_at IS NOT NULL AND output_hash IS NULL AND failure_code IS NOT NULL) OR (status IN ('cancelled','stale','superseded') AND completed_at IS NOT NULL) OR status IN ('queued','rendering','preprocessing','recognizing','normalizing','validating')` })
  pgm.createIndex('document_ocr_runs', ['organization_id','case_id','created_at'])
  pgm.sql(`CREATE UNIQUE INDEX document_ocr_runs_exact_identity_unique
    ON document_ocr_runs (organization_id,document_version_id,text_extraction_id,source_hash,render_profile_version,preprocessing_version,quality_version,engine_version,language_data_version,language_data_hash,language_mode,normalization_version,locator_version,selected_page_numbers)`)
  pgm.sql(`CREATE UNIQUE INDEX document_ocr_runs_one_active_source
    ON document_ocr_runs (organization_id,document_version_id)
    WHERE status IN ('queued','rendering','preprocessing','recognizing','normalizing','validating')`)

  pgm.createTable('document_ocr_pages', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true },
    ocr_run_id: { type: 'uuid', notNull: true }, text_page_id: { type: 'uuid', notNull: true }, page_number: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true }, language_mode: { type: 'text', notNull: true },
    image_width: { type: 'integer', notNull: true }, image_height: { type: 'integer', notNull: true }, render_dpi: { type: 'integer', notNull: true },
    rotation_degrees: { type: 'integer', notNull: true }, deskew_degrees: { type: 'numeric(6,3)', notNull: true }, threshold_value: { type: 'integer', notNull: true },
    raw_ocr_text: { type: 'text', notNull: true }, raw_text_hash: { type: 'text', notNull: true },
    normalized_text: { type: 'text', notNull: true }, normalized_text_hash: { type: 'text', notNull: true }, normalized_character_count: { type: 'integer', notNull: true },
    mean_confidence: { type: 'numeric(6,3)', notNull: true }, minimum_confidence: { type: 'numeric(6,3)', notNull: true },
    quality_status: { type: 'text', notNull: true }, reading_order_quality: { type: 'text', notNull: true }, composite_status: { type: 'text', notNull: true }, quality_reason_code: { type: 'text', notNull: true }, requires_human_review: { type: 'boolean', notNull: true },
    block_count: { type: 'integer', notNull: true }, line_count: { type: 'integer', notNull: true }, word_count: { type: 'integer', notNull: true },
    low_confidence_word_count: { type: 'integer', notNull: true }, unreadable_region_count: { type: 'integer', notNull: true }, processing_duration_ms: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_run_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_run_id'], references: 'document_ocr_runs (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_text_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','text_page_id'], references: 'document_text_extraction_pages (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_org_case_id_unique', { unique: ['organization_id','case_id','id'] })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_number_unique', { unique: ['ocr_run_id','page_number'] })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_status_valid', { check: `status IN ${PAGE_STATUSES} AND language_mode IN ('tur','eng','tur+eng') AND quality_status IN ('high','medium','low','insufficient','control_required') AND reading_order_quality IN ('reliable','probable','ambiguous','control_required') AND composite_status IN ('pdf_text_only','ocr_only','combined_non_overlapping','conflict_detected','control_required')` })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_geometry_valid', { check: 'page_number>=1 AND image_width>0 AND image_height>0 AND render_dpi BETWEEN 72 AND 600 AND rotation_degrees IN (0,90,180,270) AND deskew_degrees BETWEEN -15 AND 15 AND threshold_value BETWEEN 0 AND 255' })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_text_valid', { check: "char_length(raw_ocr_text)<=200000 AND raw_text_hash ~ '^[a-f0-9]{64}$' AND char_length(normalized_text)<=200000 AND normalized_character_count=char_length(normalized_text) AND normalized_text_hash ~ '^[a-f0-9]{64}$'" })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_quality_valid', { check: "mean_confidence BETWEEN 0 AND 100 AND minimum_confidence BETWEEN 0 AND 100 AND quality_reason_code IN ('quality_good','low_confidence','insufficient_text','empty_result','suspicious_characters','ocr_failed') AND ((quality_status='high' AND requires_human_review=false) OR (quality_status<>'high' AND requires_human_review=true))" })
  pgm.addConstraint('document_ocr_pages', 'document_ocr_pages_counts_valid', { check: 'block_count>=0 AND line_count>=0 AND word_count>=0 AND low_confidence_word_count>=0 AND low_confidence_word_count<=word_count AND unreadable_region_count>=0 AND processing_duration_ms BETWEEN 0 AND 600000' })
  pgm.createIndex('document_ocr_pages', ['ocr_run_id','page_number'])

  const elementColumns = {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true },
    ocr_run_id: { type: 'uuid', notNull: true }, page_id: { type: 'uuid', notNull: true }, page_number: { type: 'integer', notNull: true },
    element_index: { type: 'integer', notNull: true }, reading_order: { type: 'integer', notNull: true },
    start_offset: { type: 'integer', notNull: true }, end_offset: { type: 'integer', notNull: true }, element_text: { type: 'text', notNull: true }, text_hash: { type: 'text', notNull: true }, confidence: { type: 'numeric(6,3)', notNull: true },
    bbox_x: { type: 'integer', notNull: true }, bbox_y: { type: 'integer', notNull: true }, bbox_width: { type: 'integer', notNull: true }, bbox_height: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }
  pgm.createTable('document_ocr_blocks', elementColumns)
  pgm.addConstraint('document_ocr_blocks', 'document_ocr_blocks_run_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_run_id'], references: 'document_ocr_runs (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_blocks', 'document_ocr_blocks_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','page_id'], references: 'document_ocr_pages (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_blocks', 'document_ocr_blocks_org_case_id_unique', { unique: ['organization_id','case_id','id'] })

  pgm.createTable('document_ocr_lines', { ...elementColumns, block_id: { type: 'uuid', notNull: true } })
  pgm.addConstraint('document_ocr_lines', 'document_ocr_lines_run_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_run_id'], references: 'document_ocr_runs (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_lines', 'document_ocr_lines_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','page_id'], references: 'document_ocr_pages (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_lines', 'document_ocr_lines_block_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','block_id'], references: 'document_ocr_blocks (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_lines', 'document_ocr_lines_org_case_id_unique', { unique: ['organization_id','case_id','id'] })

  pgm.createTable('document_ocr_words', { ...elementColumns, block_id: { type: 'uuid', notNull: true }, line_id: { type: 'uuid', notNull: true } })
  pgm.addConstraint('document_ocr_words', 'document_ocr_words_run_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_run_id'], references: 'document_ocr_runs (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_words', 'document_ocr_words_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','page_id'], references: 'document_ocr_pages (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_words', 'document_ocr_words_block_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','block_id'], references: 'document_ocr_blocks (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_words', 'document_ocr_words_line_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','line_id'], references: 'document_ocr_lines (organization_id,case_id,id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_ocr_words', 'document_ocr_words_org_case_id_unique', { unique: ['organization_id','case_id','id'] })

  for (const table of ['document_ocr_blocks','document_ocr_lines','document_ocr_words']) {
    pgm.addConstraint(table, `${table}_index_unique`, { unique: ['page_id','element_index'] })
    pgm.addConstraint(table, `${table}_reading_unique`, { unique: ['page_id','reading_order'] })
    pgm.addConstraint(table, `${table}_content_valid`, { check: "page_number>=1 AND element_index>=0 AND reading_order>=0 AND start_offset>=0 AND end_offset>start_offset AND char_length(element_text)=end_offset-start_offset AND char_length(element_text)<=200000 AND text_hash ~ '^[a-f0-9]{64}$' AND confidence BETWEEN 0 AND 100 AND bbox_x>=0 AND bbox_y>=0 AND bbox_width>=0 AND bbox_height>=0" })
    pgm.createIndex(table, ['ocr_run_id','page_number','reading_order'])
  }

  pgm.createFunction('document_ocr_element_geometry_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (SELECT 1 FROM document_ocr_pages p WHERE p.id=NEW.page_id AND p.ocr_run_id=NEW.ocr_run_id AND p.organization_id=NEW.organization_id AND p.case_id=NEW.case_id AND p.page_number=NEW.page_number AND NEW.bbox_x+NEW.bbox_width<=p.image_width AND NEW.bbox_y+NEW.bbox_height<=p.image_height AND NEW.end_offset<=char_length(p.normalized_text) AND substring(p.normalized_text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=NEW.element_text) THEN RAISE EXCEPTION 'OCR element geometry or range is invalid' USING ERRCODE='check_violation'; END IF;
    RETURN NEW;
  END;`)
  for (const table of ['document_ocr_blocks','document_ocr_lines','document_ocr_words']) pgm.createTrigger(table, `${table}_geometry_guard`, { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'document_ocr_element_geometry_guard' })

  pgm.addColumns('policy_source_references', {
    ocr_run_id: { type: 'uuid' }, ocr_page_id: { type: 'uuid' }, ocr_block_id: { type: 'uuid' }, ocr_line_id: { type: 'uuid' }, ocr_word_id: { type: 'uuid' },
    ocr_start_offset: { type: 'integer' }, ocr_end_offset: { type: 'integer' },
    ocr_engine_version: { type: 'text' }, ocr_language_data_version: { type: 'text' }, ocr_locator_version: { type: 'text' },
    ocr_quality_status: { type: 'text' }, ocr_reading_order_quality: { type: 'text' },
    ocr_bbox_x: { type: 'integer' }, ocr_bbox_y: { type: 'integer' }, ocr_bbox_width: { type: 'integer' }, ocr_bbox_height: { type: 'integer' },
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_ocr_run_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_run_id'], references: 'document_ocr_runs (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_ocr_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_page_id'], references: 'document_ocr_pages (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_ocr_block_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_block_id'], references: 'document_ocr_blocks (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_ocr_line_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_line_id'], references: 'document_ocr_lines (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_ocr_word_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','ocr_word_id'], references: 'document_ocr_words (organization_id,case_id,id)', onDelete: 'RESTRICT' } })
  pgm.dropConstraint('policy_source_references', 'policy_source_references_text_locator_consistent')
  pgm.addConstraint('policy_source_references', 'policy_source_references_evidence_locator_consistent', { check: `
    (text_extraction_id IS NULL AND text_page_id IS NULL AND text_segment_id IS NULL AND start_offset IS NULL AND end_offset IS NULL
      AND ocr_run_id IS NULL AND ocr_page_id IS NULL AND ocr_block_id IS NULL AND ocr_line_id IS NULL AND ocr_word_id IS NULL AND ocr_start_offset IS NULL AND ocr_end_offset IS NULL AND ocr_engine_version IS NULL AND ocr_language_data_version IS NULL AND ocr_locator_version IS NULL AND ocr_quality_status IS NULL AND ocr_reading_order_quality IS NULL AND ocr_bbox_x IS NULL AND ocr_bbox_y IS NULL AND ocr_bbox_width IS NULL AND ocr_bbox_height IS NULL)
    OR (text_extraction_id IS NOT NULL AND text_page_id IS NOT NULL AND start_offset>=0 AND end_offset>start_offset AND end_offset-start_offset<=1000
      AND ocr_run_id IS NULL AND ocr_page_id IS NULL AND ocr_block_id IS NULL AND ocr_line_id IS NULL AND ocr_word_id IS NULL AND ocr_start_offset IS NULL AND ocr_end_offset IS NULL AND ocr_engine_version IS NULL AND ocr_language_data_version IS NULL AND ocr_locator_version IS NULL AND ocr_quality_status IS NULL AND ocr_reading_order_quality IS NULL AND ocr_bbox_x IS NULL AND ocr_bbox_y IS NULL AND ocr_bbox_width IS NULL AND ocr_bbox_height IS NULL)
    OR (text_extraction_id IS NULL AND text_page_id IS NULL AND text_segment_id IS NULL AND start_offset IS NULL AND end_offset IS NULL
      AND ocr_run_id IS NOT NULL AND ocr_page_id IS NOT NULL AND ocr_start_offset>=0 AND ocr_end_offset>ocr_start_offset AND ocr_end_offset-ocr_start_offset<=1000
      AND ocr_engine_version='7.0.0' AND ocr_language_data_version='tessdata-4.0.0-full/1.0.0' AND ocr_locator_version='policy-ocr-locator/1.0.0' AND ocr_quality_status IN ('high','medium','low','insufficient','control_required') AND ocr_reading_order_quality IN ('reliable','probable','ambiguous','control_required') AND ocr_bbox_x>=0 AND ocr_bbox_y>=0 AND ocr_bbox_width>=0 AND ocr_bbox_height>=0
      AND (ocr_line_id IS NULL OR ocr_block_id IS NOT NULL) AND (ocr_word_id IS NULL OR ocr_line_id IS NOT NULL))` })

  pgm.dropTrigger('policy_source_references', 'policy_source_references_source_guard')
  pgm.dropFunction('policy_source_reference_guard', [])
  pgm.createFunction('policy_source_reference_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM policy_analysis_versions pav JOIN documents d ON d.id=NEW.document_id
      JOIN document_versions dv ON dv.id=NEW.document_version_id AND dv.document_id=d.id
      WHERE pav.id=NEW.analysis_version_id AND pav.organization_id=NEW.organization_id AND pav.case_id=NEW.case_id
        AND d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id
        AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'policy evidence source is not ready verified' USING ERRCODE='check_violation'; END IF;
    IF NEW.text_extraction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_text_extractions e JOIN document_text_extraction_pages p ON p.extraction_id=e.id
      WHERE e.id=NEW.text_extraction_id AND p.id=NEW.text_page_id AND e.organization_id=NEW.organization_id AND e.case_id=NEW.case_id
        AND e.document_version_id=NEW.document_version_id AND e.status IN ('ready','partial') AND p.status='text' AND p.page_number=NEW.page_number
        AND NEW.end_offset<=char_length(p.normalized_text) AND substring(p.normalized_text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=NEW.raw_excerpt
        AND (NEW.text_segment_id IS NULL OR EXISTS (SELECT 1 FROM document_text_extraction_segments s WHERE s.id=NEW.text_segment_id AND s.page_id=p.id AND s.start_offset<=NEW.start_offset AND s.end_offset>=NEW.end_offset))
    ) THEN RAISE EXCEPTION 'policy evidence extraction locator is invalid' USING ERRCODE='check_violation'; END IF;
    IF NEW.ocr_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_ocr_runs r JOIN document_ocr_pages p ON p.ocr_run_id=r.id
      WHERE r.id=NEW.ocr_run_id AND p.id=NEW.ocr_page_id AND r.organization_id=NEW.organization_id AND r.case_id=NEW.case_id
        AND r.document_version_id=NEW.document_version_id AND r.status IN ('ready','partial','low_confidence','control_required') AND p.status IN ('accepted_candidate','partial','low_confidence','control_required') AND p.page_number=NEW.page_number
        AND NEW.ocr_engine_version=r.engine_version AND NEW.ocr_language_data_version=r.language_data_version AND NEW.ocr_locator_version=r.locator_version AND NEW.ocr_quality_status=p.quality_status AND NEW.ocr_reading_order_quality=p.reading_order_quality
        AND NEW.ocr_bbox_x+NEW.ocr_bbox_width<=p.image_width AND NEW.ocr_bbox_y+NEW.ocr_bbox_height<=p.image_height
        AND NEW.ocr_end_offset<=char_length(p.normalized_text) AND substring(p.normalized_text FROM NEW.ocr_start_offset+1 FOR NEW.ocr_end_offset-NEW.ocr_start_offset)=NEW.raw_excerpt
        AND (NEW.ocr_block_id IS NULL OR EXISTS (SELECT 1 FROM document_ocr_blocks b WHERE b.id=NEW.ocr_block_id AND b.page_id=p.id AND b.start_offset<=NEW.ocr_start_offset AND b.end_offset>=NEW.ocr_end_offset))
        AND (NEW.ocr_line_id IS NULL OR EXISTS (SELECT 1 FROM document_ocr_lines l WHERE l.id=NEW.ocr_line_id AND l.page_id=p.id AND l.block_id=NEW.ocr_block_id AND l.start_offset<=NEW.ocr_start_offset AND l.end_offset>=NEW.ocr_end_offset))
        AND (NEW.ocr_word_id IS NULL OR EXISTS (SELECT 1 FROM document_ocr_words w WHERE w.id=NEW.ocr_word_id AND w.page_id=p.id AND w.block_id=NEW.ocr_block_id AND w.line_id=NEW.ocr_line_id AND w.start_offset<=NEW.ocr_start_offset AND w.end_offset>=NEW.ocr_end_offset))
    ) THEN RAISE EXCEPTION 'policy evidence OCR locator is invalid' USING ERRCODE='check_violation'; END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_source_references', 'policy_source_references_source_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_source_reference_guard' })

  pgm.createFunction('document_ocr_evidence_append_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN RAISE EXCEPTION 'document OCR evidence is append-only' USING ERRCODE='restrict_violation'; END;`)
  for (const table of ['document_ocr_pages','document_ocr_blocks','document_ocr_lines','document_ocr_words']) pgm.createTrigger(table, `${table}_append_only`, { when: 'BEFORE', operation: ['UPDATE','DELETE'], level: 'ROW', function: 'document_ocr_evidence_append_guard' })
  pgm.createFunction('document_ocr_terminal_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document OCR run is append-only' USING ERRCODE='restrict_violation'; END IF;
    IF OLD.status IN ('ready','partial','low_confidence','control_required','failed','cancelled','stale','superseded') THEN RAISE EXCEPTION 'terminal OCR run is immutable' USING ERRCODE='restrict_violation'; END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('document_ocr_runs', 'document_ocr_runs_terminal_guard', { when: 'BEFORE', operation: ['UPDATE','DELETE'], level: 'ROW', function: 'document_ocr_terminal_guard' })

  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', { check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace','rename_case_workspace','move_case_workspace','cleanup_moved_workspace','extract_pdf_text','ocr_policy_pages')" })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', { check: "target_type IN ('document_version','photo','case_location','workspace_provisioning','file_operation','document_text_extraction','document_ocr_run')" })
  pgm.sql(`CREATE UNIQUE INDEX jobs_one_active_ocr_run_job ON jobs (organization_id,target_type,target_id) WHERE target_type='document_ocr_run' AND status IN ('pending','leased')`)
  pgm.addConstraint('document_ocr_runs', 'document_ocr_runs_active_job_fk', { foreignKeys: { columns: 'active_job_id', references: 'jobs(id)', onDelete: 'SET NULL' } })
}

export function down(pgm) {
  pgm.dropConstraint('document_ocr_runs', 'document_ocr_runs_active_job_fk')
  pgm.sql('DROP INDEX jobs_one_active_ocr_run_job')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', { check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace','rename_case_workspace','move_case_workspace','cleanup_moved_workspace','extract_pdf_text')" })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', { check: "target_type IN ('document_version','photo','case_location','workspace_provisioning','file_operation','document_text_extraction')" })
  pgm.dropTrigger('document_ocr_runs', 'document_ocr_runs_terminal_guard')
  pgm.dropFunction('document_ocr_terminal_guard', [])
  for (const table of ['document_ocr_pages','document_ocr_blocks','document_ocr_lines','document_ocr_words']) pgm.dropTrigger(table, `${table}_append_only`)
  pgm.dropFunction('document_ocr_evidence_append_guard', [])
  for (const table of ['document_ocr_blocks','document_ocr_lines','document_ocr_words']) pgm.dropTrigger(table, `${table}_geometry_guard`)
  pgm.dropFunction('document_ocr_element_geometry_guard', [])
  pgm.dropTrigger('policy_source_references', 'policy_source_references_source_guard')
  pgm.dropFunction('policy_source_reference_guard', [])
  pgm.createFunction('policy_source_reference_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (SELECT 1 FROM policy_analysis_versions pav JOIN documents d ON d.id=NEW.document_id JOIN document_versions dv ON dv.id=NEW.document_version_id AND dv.document_id=d.id WHERE pav.id=NEW.analysis_version_id AND pav.organization_id=NEW.organization_id AND pav.case_id=NEW.case_id AND d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'policy evidence source is not ready verified' USING ERRCODE='check_violation'; END IF;
    IF NEW.text_extraction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_text_extractions e JOIN document_text_extraction_pages p ON p.extraction_id=e.id WHERE e.id=NEW.text_extraction_id AND p.id=NEW.text_page_id AND e.organization_id=NEW.organization_id AND e.case_id=NEW.case_id AND e.document_version_id=NEW.document_version_id AND e.status IN ('ready','partial') AND p.status='text' AND p.page_number=NEW.page_number AND NEW.end_offset<=char_length(p.normalized_text) AND substring(p.normalized_text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=NEW.raw_excerpt AND (NEW.text_segment_id IS NULL OR EXISTS (SELECT 1 FROM document_text_extraction_segments s WHERE s.id=NEW.text_segment_id AND s.page_id=p.id AND s.start_offset<=NEW.start_offset AND s.end_offset>=NEW.end_offset))) THEN RAISE EXCEPTION 'policy evidence extraction locator is invalid' USING ERRCODE='check_violation'; END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_source_references', 'policy_source_references_source_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_source_reference_guard' })
  pgm.dropConstraint('policy_source_references', 'policy_source_references_evidence_locator_consistent')
  for (const constraint of ['policy_source_references_ocr_word_tenant_fk','policy_source_references_ocr_line_tenant_fk','policy_source_references_ocr_block_tenant_fk','policy_source_references_ocr_page_tenant_fk','policy_source_references_ocr_run_tenant_fk']) pgm.dropConstraint('policy_source_references', constraint)
  pgm.dropColumns('policy_source_references', ['ocr_run_id','ocr_page_id','ocr_block_id','ocr_line_id','ocr_word_id','ocr_start_offset','ocr_end_offset','ocr_engine_version','ocr_language_data_version','ocr_locator_version','ocr_quality_status','ocr_reading_order_quality','ocr_bbox_x','ocr_bbox_y','ocr_bbox_width','ocr_bbox_height'])
  pgm.addConstraint('policy_source_references', 'policy_source_references_text_locator_consistent', { check: `(text_extraction_id IS NULL AND text_page_id IS NULL AND text_segment_id IS NULL AND start_offset IS NULL AND end_offset IS NULL) OR (text_extraction_id IS NOT NULL AND text_page_id IS NOT NULL AND start_offset>=0 AND end_offset>start_offset AND end_offset-start_offset<=1000)` })
  pgm.dropTable('document_ocr_words')
  pgm.dropTable('document_ocr_lines')
  pgm.dropTable('document_ocr_blocks')
  pgm.dropTable('document_ocr_pages')
  pgm.sql('DROP INDEX document_ocr_runs_one_active_source')
  pgm.sql('DROP INDEX document_ocr_runs_exact_identity_unique')
  pgm.dropTable('document_ocr_runs')
}
