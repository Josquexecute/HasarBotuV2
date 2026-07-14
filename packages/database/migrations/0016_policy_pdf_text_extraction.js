/**
 * Paket 24 - verified Kasko PDF text extraction snapshots.
 * PDF binary/absolute path/parser stack is never stored. Raw text is bounded
 * per page; normalized text and deterministic segments are append-only evidence.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('document_text_extractions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    document_id: { type: 'uuid', notNull: true },
    document_version_id: { type: 'uuid', notNull: true },
    extraction_version: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true, default: 'queued' },
    parser_name: { type: 'text', notNull: true },
    parser_version: { type: 'text', notNull: true },
    normalization_version: { type: 'text', notNull: true },
    offset_unit: { type: 'text', notNull: true },
    source_hash: { type: 'text', notNull: true },
    source_size: { type: 'bigint', notNull: true },
    page_count: { type: 'integer', notNull: true, default: 0 },
    text_page_count: { type: 'integer', notNull: true, default: 0 },
    image_only_page_count: { type: 'integer', notNull: true, default: 0 },
    empty_page_count: { type: 'integer', notNull: true, default: 0 },
    failed_page_count: { type: 'integer', notNull: true, default: 0 },
    segment_count: { type: 'integer', notNull: true, default: 0 },
    raw_character_count: { type: 'integer', notNull: true, default: 0 },
    normalized_character_count: { type: 'integer', notNull: true, default: 0 },
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
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id','case_id','document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id','case_id','document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_org_case_id_unique', { unique: ['organization_id','case_id','id'] })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_identity_unique', { unique: ['organization_id','document_version_id','parser_name','parser_version','normalization_version'] })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_version_unique', { unique: ['document_version_id','extraction_version'] })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_status_valid', { check: "status IN ('queued','processing','ready','partial','ocr_required','failed','cancelled','stale')" })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_engine_valid', { check: "parser_name='pdfjs-dist' AND parser_version='6.1.200' AND normalization_version='pdf-text-normalization/1.0.0' AND offset_unit='unicode_code_point'" })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_hash_valid', { check: "source_hash ~ '^[a-f0-9]{64}$' AND (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$')" })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_counts_valid', { check: `extraction_version>=1 AND version>=1 AND last_chunk_sequence>=-1 AND source_size>=0 AND page_count>=0 AND text_page_count>=0 AND image_only_page_count>=0 AND empty_page_count>=0 AND failed_page_count>=0 AND segment_count>=0 AND raw_character_count>=0 AND normalized_character_count>=0 AND text_page_count+image_only_page_count+empty_page_count+failed_page_count<=page_count` })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_failure_safe', { check: "failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'" })
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_terminal_consistent', { check: "(status IN ('ready','partial','ocr_required') AND output_hash IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL) OR (status='failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL AND output_hash IS NULL) OR (status IN ('cancelled','stale') AND completed_at IS NOT NULL) OR status IN ('queued','processing')" })
  pgm.createIndex('document_text_extractions', ['organization_id','case_id','created_at'])

  pgm.createTable('document_text_extraction_pages', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true },
    extraction_id: { type: 'uuid', notNull: true }, page_number: { type: 'integer', notNull: true }, status: { type: 'text', notNull: true },
    raw_text: { type: 'text', notNull: true }, normalized_text: { type: 'text', notNull: true },
    raw_text_hash: { type: 'text', notNull: true }, normalized_text_hash: { type: 'text', notNull: true },
    raw_character_count: { type: 'integer', notNull: true }, normalized_character_count: { type: 'integer', notNull: true },
    segment_count: { type: 'integer', notNull: true }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_extraction_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','extraction_id'], references: 'document_text_extractions (organization_id, case_id, id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_number_unique', { unique: ['extraction_id','page_number'] })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_org_case_id_unique', { unique: ['organization_id','case_id','id'] })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_status_valid', { check: "status IN ('text','image_only','empty','failed','skipped')" })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_bounds_valid', { check: 'page_number>=1 AND char_length(raw_text)<=200000 AND char_length(normalized_text)<=200000 AND raw_character_count=char_length(raw_text) AND normalized_character_count=char_length(normalized_text) AND segment_count>=0' })
  pgm.addConstraint('document_text_extraction_pages', 'document_text_extraction_pages_hash_valid', { check: "raw_text_hash ~ '^[a-f0-9]{64}$' AND normalized_text_hash ~ '^[a-f0-9]{64}$'" })
  pgm.createIndex('document_text_extraction_pages', ['extraction_id','page_number'])

  pgm.createTable('document_text_extraction_segments', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true },
    extraction_id: { type: 'uuid', notNull: true }, page_id: { type: 'uuid', notNull: true }, page_number: { type: 'integer', notNull: true },
    segment_index: { type: 'integer', notNull: true }, segment_type: { type: 'text', notNull: true },
    start_offset: { type: 'integer', notNull: true }, end_offset: { type: 'integer', notNull: true },
    segment_text: { type: 'text', notNull: true }, text_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_extraction_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','extraction_id'], references: 'document_text_extractions (organization_id, case_id, id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','page_id'], references: 'document_text_extraction_pages (organization_id, case_id, id)', onDelete: 'CASCADE' } })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_order_unique', { unique: ['page_id','segment_index'] })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_org_case_id_unique', { unique: ['organization_id','case_id','id'] })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_type_valid', { check: "segment_type IN ('title','heading','clause','paragraph','list','table','header_footer','unknown')" })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_offsets_valid', { check: 'page_number>=1 AND segment_index>=0 AND start_offset>=0 AND end_offset>start_offset AND char_length(segment_text)=end_offset-start_offset AND char_length(segment_text)<=200000' })
  pgm.addConstraint('document_text_extraction_segments', 'document_text_extraction_segments_hash_valid', { check: "text_hash ~ '^[a-f0-9]{64}$'" })
  pgm.createIndex('document_text_extraction_segments', ['extraction_id','page_number','segment_index'])

  // Package 23 evidence may optionally bind to a verified extraction range.
  pgm.addColumns('policy_source_references', {
    text_extraction_id: { type: 'uuid' }, text_page_id: { type: 'uuid' }, text_segment_id: { type: 'uuid' },
    start_offset: { type: 'integer' }, end_offset: { type: 'integer' },
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_extraction_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','text_extraction_id'], references: 'document_text_extractions (organization_id, case_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_text_page_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','text_page_id'], references: 'document_text_extraction_pages (organization_id, case_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_text_segment_tenant_fk', { foreignKeys: { columns: ['organization_id','case_id','text_segment_id'], references: 'document_text_extraction_segments (organization_id, case_id, id)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('policy_source_references', 'policy_source_references_text_locator_consistent', { check: `(text_extraction_id IS NULL AND text_page_id IS NULL AND text_segment_id IS NULL AND start_offset IS NULL AND end_offset IS NULL) OR (text_extraction_id IS NOT NULL AND text_page_id IS NOT NULL AND start_offset>=0 AND end_offset>start_offset AND end_offset-start_offset<=1000)` })

  pgm.dropTrigger('policy_source_references', 'policy_source_references_source_guard')
  pgm.dropFunction('policy_source_reference_guard', [])
  pgm.createFunction('policy_source_reference_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM policy_analysis_versions pav JOIN documents d ON d.id=NEW.document_id
      JOIN document_versions dv ON dv.id=NEW.document_version_id AND dv.document_id=d.id
      WHERE pav.id=NEW.analysis_version_id AND pav.organization_id=NEW.organization_id AND pav.case_id=NEW.case_id
        AND d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id
        AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id
        AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'policy evidence source is not ready verified' USING ERRCODE='check_violation'; END IF;
    IF NEW.text_extraction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_text_extractions e JOIN document_text_extraction_pages p ON p.extraction_id=e.id
      WHERE e.id=NEW.text_extraction_id AND p.id=NEW.text_page_id AND e.organization_id=NEW.organization_id AND e.case_id=NEW.case_id
        AND e.document_version_id=NEW.document_version_id AND e.status IN ('ready','partial') AND p.status='text'
        AND p.page_number=NEW.page_number AND NEW.end_offset<=char_length(p.normalized_text)
        AND substring(p.normalized_text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=NEW.raw_excerpt
        AND (NEW.text_segment_id IS NULL OR EXISTS (SELECT 1 FROM document_text_extraction_segments s WHERE s.id=NEW.text_segment_id AND s.page_id=p.id AND s.start_offset<=NEW.start_offset AND s.end_offset>=NEW.end_offset))
    ) THEN RAISE EXCEPTION 'policy evidence extraction locator is invalid' USING ERRCODE='check_violation'; END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_source_references', 'policy_source_references_source_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_source_reference_guard' })

  pgm.createFunction('document_text_append_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN RAISE EXCEPTION 'document text evidence is append-only' USING ERRCODE='restrict_violation'; END;`)
  for (const table of ['document_text_extraction_pages','document_text_extraction_segments']) pgm.createTrigger(table, `${table}_append_only`, { when: 'BEFORE', operation: ['UPDATE','DELETE'], level: 'ROW', function: 'document_text_append_guard' })
  pgm.createFunction('document_text_terminal_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document text extraction is append-only' USING ERRCODE='restrict_violation'; END IF;
    IF OLD.status IN ('ready','partial','ocr_required','failed','cancelled','stale') THEN RAISE EXCEPTION 'terminal extraction is immutable' USING ERRCODE='restrict_violation'; END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('document_text_extractions', 'document_text_extractions_terminal_guard', { when: 'BEFORE', operation: ['UPDATE','DELETE'], level: 'ROW', function: 'document_text_terminal_guard' })

  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', { check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace','rename_case_workspace','move_case_workspace','cleanup_moved_workspace','extract_pdf_text')" })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', { check: "target_type IN ('document_version','photo','case_location','workspace_provisioning','file_operation','document_text_extraction')" })
  pgm.sql(`CREATE UNIQUE INDEX jobs_one_active_text_extraction_job ON jobs (organization_id,target_type,target_id) WHERE target_type='document_text_extraction' AND status IN ('pending','leased')`)
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_active_job_fk', { foreignKeys: { columns: 'active_job_id', references: 'jobs(id)', onDelete: 'SET NULL' } })
}

export function down(pgm) {
  pgm.dropConstraint('document_text_extractions', 'document_text_extractions_active_job_fk')
  pgm.sql('DROP INDEX jobs_one_active_text_extraction_job')
  pgm.dropConstraint('jobs', 'jobs_target_type_valid')
  pgm.dropConstraint('jobs', 'jobs_type_valid')
  pgm.addConstraint('jobs', 'jobs_type_valid', { check: "type IN ('verify_document','verify_photo','verify_case_location','provision_case_workspace','rename_case_workspace','move_case_workspace','cleanup_moved_workspace')" })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', { check: "target_type IN ('document_version','photo','case_location','workspace_provisioning','file_operation')" })
  pgm.dropTrigger('document_text_extractions', 'document_text_extractions_terminal_guard')
  pgm.dropFunction('document_text_terminal_guard', [])
  for (const table of ['document_text_extraction_pages','document_text_extraction_segments']) pgm.dropTrigger(table, `${table}_append_only`)
  pgm.dropFunction('document_text_append_guard', [])
  pgm.dropTrigger('policy_source_references', 'policy_source_references_source_guard')
  pgm.dropFunction('policy_source_reference_guard', [])
  pgm.createFunction('policy_source_reference_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (SELECT 1 FROM policy_analysis_versions pav JOIN documents d ON d.id=NEW.document_id JOIN document_versions dv ON dv.id=NEW.document_version_id AND dv.document_id=d.id WHERE pav.id=NEW.analysis_version_id AND pav.organization_id=NEW.organization_id AND pav.case_id=NEW.case_id AND d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'policy evidence source is not a ready verified case document version' USING ERRCODE='check_violation'; END IF; RETURN NEW; END;`)
  pgm.createTrigger('policy_source_references', 'policy_source_references_source_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_source_reference_guard' })
  pgm.dropConstraint('policy_source_references', 'policy_source_references_text_locator_consistent')
  pgm.dropConstraint('policy_source_references', 'policy_source_references_text_segment_tenant_fk')
  pgm.dropConstraint('policy_source_references', 'policy_source_references_text_page_tenant_fk')
  pgm.dropConstraint('policy_source_references', 'policy_source_references_extraction_tenant_fk')
  pgm.dropColumns('policy_source_references', ['text_extraction_id','text_page_id','text_segment_id','start_offset','end_offset'])
  pgm.dropTable('document_text_extraction_segments')
  pgm.dropTable('document_text_extraction_pages')
  pgm.dropTable('document_text_extractions')
}
