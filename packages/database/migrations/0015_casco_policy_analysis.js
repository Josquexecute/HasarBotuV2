/**
 * Paket 23 - kanitli Kasko police analiz cekirdegi.
 *
 * Belge byte'i veya tum police metni saklanmaz. Kaynaklar yalniz sinirli excerpt,
 * sayfa/bolum/madde ve hash tasir. Kanonik analiz normalize tablolardadir;
 * JSONB yalniz degisken kosullar ve guvenli senaryo snapshot'i icindir.
 */
export const shorthands = undefined

const ANALYSIS_STATUSES = "('draft','extracted','control_required','conflict_detected','awaiting_approval','approved','superseded','rejected','failed')"
const SOURCE_TYPES = "('policy','endorsement','general_conditions','special_conditions','notice_form','external_reference')"
const COVERAGE_TYPES = "('collision','fire','theft','natural_disaster','flood','earthquake','terror','glass','key_loss','roadside_assistance','replacement_vehicle','mini_repair','mobile_repair','legal_protection','personal_accident','third_party_liability','loss_of_use','wrong_fuel','animal_damage','electronic_mechanical_damage','other')"
const SCENARIO_TYPES = "('coverage','deductible','uncontracted_service','authorized_service','glass_service','mini_repair','mobile_repair','replacement_vehicle','roadside_assistance','part_type','betterment','previous_total_loss')"

export function up(pgm) {
  // Tenant-bilesik FK'ler icin savunma-derinligi unique anahtarlari.
  pgm.addConstraint('cases', 'cases_org_id_unique', { unique: ['organization_id', 'id'] })
  pgm.addConstraint('documents', 'documents_org_case_id_unique', { unique: ['organization_id', 'case_id', 'id'] })
  pgm.addConstraint('document_versions', 'document_versions_org_case_id_unique', { unique: ['organization_id', 'case_id', 'id'] })

  pgm.createTable('policy_analyses', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    insurer_id: { type: 'uuid' },
    source_document_id: { type: 'uuid', notNull: true },
    source_document_version_id: { type: 'uuid', notNull: true },
    current_version_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_analyses', 'policy_analyses_org_case_id_unique', { unique: ['organization_id', 'case_id', 'id'] })
  pgm.addConstraint('policy_analyses', 'policy_analyses_case_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('policy_analyses', 'policy_analyses_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'source_document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_analyses', 'policy_analyses_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'source_document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_analyses', 'policy_analyses_insurer_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'insurer_id'], references: 'insurers (organization_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_analyses', 'policy_analyses_version_positive', { check: 'version >= 1' })
  pgm.createIndex('policy_analyses', ['organization_id', 'case_id', 'updated_at'])

  pgm.createTable('policy_analysis_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    analysis_id: { type: 'uuid', notNull: true },
    source_document_id: { type: 'uuid', notNull: true },
    source_document_version_id: { type: 'uuid', notNull: true },
    analysis_version: { type: 'integer', notNull: true },
    analysis_status: { type: 'text', notNull: true },
    policy_number: { type: 'text' },
    endorsement_number: { type: 'text' },
    product_name: { type: 'text' },
    product_type: { type: 'text' },
    insurer_format: { type: 'text' },
    policy_start_date: { type: 'date' },
    policy_end_date: { type: 'date' },
    issue_date: { type: 'date' },
    insured_vehicle_reference: { type: 'text' },
    source_completeness: { type: 'text', notNull: true },
    human_approval_status: { type: 'text', notNull: true, default: 'pending' },
    approved_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    approved_at: { type: 'timestamptz' },
    approval_reason: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: false },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_analysis_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'analysis_id'], references: 'policy_analyses (organization_id, case_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'source_document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'source_document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_number_unique', { unique: ['analysis_id', 'analysis_version'] })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_id_analysis_unique', { unique: ['id', 'analysis_id'] })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_org_case_id_unique', { unique: ['organization_id', 'case_id', 'id'] })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_status_valid', { check: `analysis_status IN ${ANALYSIS_STATUSES}` })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_source_completeness_valid', { check: "source_completeness IN ('complete','partial','unknown')" })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_approval_status_valid', { check: "human_approval_status IN ('pending','approved','rejected')" })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_date_range_valid', { check: 'policy_end_date IS NULL OR policy_start_date IS NULL OR policy_end_date >= policy_start_date' })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_approval_consistent', {
    check: `(human_approval_status = 'pending' AND approved_by_user_id IS NULL AND approved_at IS NULL)
      OR (human_approval_status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
      OR (human_approval_status = 'rejected' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)`,
  })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_active_approved', { check: "is_active = false OR analysis_status = 'approved'" })
  pgm.addConstraint('policy_analysis_versions', 'policy_analysis_versions_positive', { check: 'analysis_version >= 1 AND version >= 1' })
  pgm.sql(`CREATE UNIQUE INDEX policy_analysis_versions_one_active_source
    ON policy_analysis_versions (organization_id, case_id, source_document_id)
    WHERE analysis_status='approved' AND is_active=true`)
  pgm.createIndex('policy_analysis_versions', ['organization_id', 'case_id', 'analysis_id', 'analysis_version'])
  pgm.addConstraint('policy_analyses', 'policy_analyses_current_version_fk', {
    foreignKeys: { columns: ['current_version_id', 'id'], references: 'policy_analysis_versions (id, analysis_id)', onDelete: 'RESTRICT' },
  })

  pgm.createTable('policy_source_references', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    document_id: { type: 'uuid', notNull: true },
    document_version_id: { type: 'uuid', notNull: true },
    page_number: { type: 'integer', notNull: true },
    section_heading: { type: 'text', notNull: true },
    clause_identifier: { type: 'text', notNull: true },
    raw_excerpt: { type: 'text', notNull: true },
    excerpt_hash: { type: 'text', notNull: true },
    locator: { type: 'text' },
    source_type: { type: 'text', notNull: true },
    confidence: { type: 'numeric(5,4)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_page_positive', { check: 'page_number >= 1' })
  pgm.addConstraint('policy_source_references', 'policy_source_references_required_text', {
    check: `length(btrim(section_heading)) BETWEEN 1 AND 300 AND length(btrim(clause_identifier)) BETWEEN 1 AND 300
      AND length(btrim(raw_excerpt)) BETWEEN 1 AND 1000 AND raw_excerpt !~ '[[:cntrl:]]'`,
  })
  pgm.addConstraint('policy_source_references', 'policy_source_references_hash_valid', { check: "excerpt_hash ~ '^[a-f0-9]{64}$'" })
  pgm.addConstraint('policy_source_references', 'policy_source_references_type_valid', { check: `source_type IN ${SOURCE_TYPES}` })
  pgm.addConstraint('policy_source_references', 'policy_source_references_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })
  pgm.addConstraint('policy_source_references', 'policy_source_references_org_case_id_unique', { unique: ['organization_id', 'case_id', 'id'] })
  pgm.createIndex('policy_source_references', ['analysis_version_id', 'page_number'])

  pgm.createTable('policy_coverages', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    code: { type: 'text', notNull: true }, canonical_type: { type: 'text', notNull: true }, original_heading: { type: 'text', notNull: true }, original_wording: { type: 'text', notNull: true }, inclusion: { type: 'text', notNull: true },
    limit_data: { type: 'jsonb' }, conditions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, exceptions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, required_documents: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, confidence: { type: 'numeric(5,4)', notNull: true },
  })
  pgm.addConstraint('policy_coverages', 'policy_coverages_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_coverages', 'policy_coverages_type_valid', { check: `canonical_type IN ${COVERAGE_TYPES}` })
  pgm.addConstraint('policy_coverages', 'policy_coverages_inclusion_valid', { check: "inclusion IN ('included','excluded','conditional','unknown')" })
  pgm.addConstraint('policy_coverages', 'policy_coverages_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_deductibles', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    code: { type: 'text', notNull: true }, deductible_type: { type: 'text', notNull: true }, trigger_text: { type: 'text', notNull: true }, conditions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, calculation_type: { type: 'text', notNull: true },
    fixed_amount: { type: 'numeric(14,2)' }, percentage: { type: 'numeric(7,4)' }, minimum_amount: { type: 'numeric(14,2)' }, maximum_amount: { type: 'numeric(14,2)' }, insurer_share: { type: 'numeric(7,4)' }, insured_share: { type: 'numeric(7,4)' },
    affected_coverage: { type: 'text' }, affected_repair_method: { type: 'text' }, affected_service_type: { type: 'text' }, affected_part_rule: { type: 'text' }, exception_text: { type: 'text' }, confidence: { type: 'numeric(5,4)', notNull: true }, approval_status: { type: 'text', notNull: true },
  })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_type_valid', { check: "deductible_type IN ('general','conditional','uncontracted_service','unauthorized_service','glass_service','key_theft','previous_total_loss','betterment','age_usage','driver_condition','geographic','part_difference','claim_count','other')" })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_calculation_valid', { check: "calculation_type IN ('fixed','percentage','share','conditional','unknown')" })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_numbers_valid', { check: `(fixed_amount IS NULL OR fixed_amount >= 0) AND (minimum_amount IS NULL OR minimum_amount >= 0) AND (maximum_amount IS NULL OR maximum_amount >= 0) AND (percentage IS NULL OR percentage BETWEEN 0 AND 100) AND (insurer_share IS NULL OR insurer_share BETWEEN 0 AND 100) AND (insured_share IS NULL OR insured_share BETWEEN 0 AND 100)` })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_approval_valid', { check: "approval_status IN ('unreviewed','approved','rejected')" })
  pgm.addConstraint('policy_deductibles', 'policy_deductibles_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_service_rules', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' }, code: { type: 'text', notNull: true },
    authorized_service_requirement: { type: 'boolean' }, insurer_contracted_service_requirement: { type: 'boolean' }, service_freedom: { type: 'text', notNull: true }, glass_network: { type: 'text' }, mobile_repair_restriction: { type: 'text' }, mini_repair_restriction: { type: 'text' }, towing_destination: { type: 'text' }, labor_restriction: { type: 'text' }, condition_text: { type: 'text' }, confidence: { type: 'numeric(5,4)', notNull: true },
  })
  pgm.addConstraint('policy_service_rules', 'policy_service_rules_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_service_rules', 'policy_service_rules_freedom_valid', { check: "service_freedom IN ('free','restricted','conditional','unknown')" })
  pgm.addConstraint('policy_service_rules', 'policy_service_rules_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_part_rules', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' }, code: { type: 'text', notNull: true },
    allowed_part_types: { type: 'text[]', notNull: true }, procurement_rule: { type: 'text' }, repair_vs_replacement_condition: { type: 'text' }, betterment_condition: { type: 'text' }, condition_text: { type: 'text' }, confidence: { type: 'numeric(5,4)', notNull: true },
  })
  pgm.addConstraint('policy_part_rules', 'policy_part_rules_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_part_rules', 'policy_part_rules_types_valid', { check: "cardinality(allowed_part_types) >= 1 AND allowed_part_types <@ ARRAY['original','equivalent','aftermarket','used']::text[]" })
  pgm.addConstraint('policy_part_rules', 'policy_part_rules_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_replacement_vehicle_rules', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' }, code: { type: 'text', notNull: true },
    available: { type: 'text', notNull: true }, vehicle_class: { type: 'text' }, duration_text: { type: 'text' }, maximum_days: { type: 'integer' }, event_limit: { type: 'integer' }, waiting_period_days: { type: 'integer' }, service_condition: { type: 'text' }, exclusions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, confidence: { type: 'numeric(5,4)', notNull: true },
  })
  pgm.addConstraint('policy_replacement_vehicle_rules', 'policy_replacement_vehicle_rules_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_replacement_vehicle_rules', 'policy_replacement_vehicle_rules_available_valid', { check: "available IN ('yes','no','conditional','unknown')" })
  pgm.addConstraint('policy_replacement_vehicle_rules', 'policy_replacement_vehicle_rules_numbers_valid', { check: '(maximum_days IS NULL OR maximum_days >= 0) AND (event_limit IS NULL OR event_limit >= 0) AND (waiting_period_days IS NULL OR waiting_period_days >= 0)' })
  pgm.addConstraint('policy_replacement_vehicle_rules', 'policy_replacement_vehicle_rules_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_exclusions', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' }, code: { type: 'text', notNull: true },
    original_wording: { type: 'text', notNull: true }, trigger_text: { type: 'text', notNull: true }, affected_coverage: { type: 'text' }, exception_to_exclusion: { type: 'text' }, required_documents: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, confidence: { type: 'numeric(5,4)', notNull: true },
  })
  pgm.addConstraint('policy_exclusions', 'policy_exclusions_code_unique', { unique: ['analysis_version_id', 'code'] })
  pgm.addConstraint('policy_exclusions', 'policy_exclusions_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_required_documents', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' }, code: { type: 'text', notNull: true }, description: { type: 'text', notNull: true }, trigger_text: { type: 'text' },
  })
  pgm.addConstraint('policy_required_documents', 'policy_required_documents_code_unique', { unique: ['analysis_version_id', 'code'] })

  pgm.createTable('policy_scenario_rules', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    rule_id: { type: 'text', notNull: true }, rule_version: { type: 'text', notNull: true }, scenario_type: { type: 'text', notNull: true }, trigger_text: { type: 'text', notNull: true }, conditions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }, coverage_outcome: { type: 'text', notNull: true }, coverage_code: { type: 'text' }, deductible_codes: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") }, limit_text: { type: 'text' }, exception_text: { type: 'text' }, required_documents: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") }, service_condition: { type: 'text' }, part_condition: { type: 'text' }, action_text: { type: 'text', notNull: true }, confidence: { type: 'numeric(5,4)', notNull: true }, human_approval_required: { type: 'boolean', notNull: true, default: true }, precedence: { type: 'integer', notNull: true }, effective_from: { type: 'date' }, effective_to: { type: 'date' },
  })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_id_unique', { unique: ['analysis_version_id', 'rule_id'] })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_type_valid', { check: `scenario_type IN ${SCENARIO_TYPES}` })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_outcome_valid', { check: "coverage_outcome IN ('covered','excluded','conditional','unknown')" })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_dates_valid', { check: 'effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from' })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_precedence_valid', { check: 'precedence BETWEEN 0 AND 10000' })
  pgm.addConstraint('policy_scenario_rules', 'policy_scenario_rules_confidence_valid', { check: 'confidence BETWEEN 0 AND 1' })

  pgm.createTable('policy_evidence_links', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    owner_type: { type: 'text', notNull: true }, owner_id: { type: 'uuid', notNull: true }, source_reference_id: { type: 'uuid', notNull: true, references: 'policy_source_references', onDelete: 'RESTRICT' }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_evidence_links', 'policy_evidence_links_owner_valid', { check: "owner_type IN ('coverage','deductible','service_rule','part_rule','replacement_vehicle_rule','exclusion','required_document','scenario_rule')" })
  pgm.addConstraint('policy_evidence_links', 'policy_evidence_links_unique', { unique: ['owner_type', 'owner_id', 'source_reference_id'] })
  pgm.createIndex('policy_evidence_links', ['analysis_version_id', 'owner_type', 'owner_id'])

  pgm.createTable('policy_conflicts', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true }, case_id: { type: 'uuid', notNull: true }, analysis_id: { type: 'uuid', notNull: true, references: 'policy_analyses', onDelete: 'CASCADE' }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'CASCADE' },
    conflict_type: { type: 'text', notNull: true }, affected_topic: { type: 'text', notNull: true }, source_a_id: { type: 'uuid', notNull: true, references: 'policy_source_references', onDelete: 'RESTRICT' }, source_b_id: { type: 'uuid', notNull: true, references: 'policy_source_references', onDelete: 'RESTRICT' }, explanation: { type: 'text', notNull: true }, severity: { type: 'text', notNull: true }, resolution_status: { type: 'text', notNull: true, default: 'open' }, resolved_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' }, resolved_at: { type: 'timestamptz' }, resolution_reason: { type: 'text' }, version: { type: 'integer', notNull: true, default: 1 }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_conflicts', 'policy_conflicts_resolution_valid', { check: "resolution_status IN ('open','control_required','resolved_source_a','resolved_source_b','resolved_manual','not_applicable')" })
  pgm.addConstraint('policy_conflicts', 'policy_conflicts_severity_valid', { check: "severity IN ('low','medium','high','critical')" })
  pgm.addConstraint('policy_conflicts', 'policy_conflicts_resolution_consistent', { check: `(resolution_status IN ('open','control_required') AND resolved_by_user_id IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL) OR (resolution_status NOT IN ('open','control_required') AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(resolution_reason)) > 0)` })
  pgm.addConstraint('policy_conflicts', 'policy_conflicts_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('policy_conflicts', 'policy_conflicts_distinct_sources', { check: 'source_a_id <> source_b_id' })
  pgm.createIndex('policy_conflicts', ['organization_id', 'case_id', 'resolution_status'])

  pgm.createTable('policy_scenario_evaluations', {
    id: { type: 'uuid', primaryKey: true }, organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' }, case_id: { type: 'uuid', notNull: true }, analysis_id: { type: 'uuid', notNull: true, references: 'policy_analyses', onDelete: 'RESTRICT' }, analysis_version_id: { type: 'uuid', notNull: true, references: 'policy_analysis_versions', onDelete: 'RESTRICT' }, policy_analysis_version: { type: 'integer', notNull: true }, scenario_type: { type: 'text', notNull: true }, rule_version: { type: 'text', notNull: true }, input_summary: { type: 'jsonb', notNull: true }, result_code: { type: 'text', notNull: true }, result_snapshot: { type: 'jsonb', notNull: true }, evaluated_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' }, request_id: { type: 'text' }, evaluated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('policy_scenario_evaluations', 'policy_scenario_evaluations_type_valid', { check: `scenario_type IN ${SCENARIO_TYPES}` })
  pgm.addConstraint('policy_scenario_evaluations', 'policy_scenario_evaluations_result_valid', { check: "result_code IN ('covered','excluded','conditional','control_required','unknown')" })
  pgm.createIndex('policy_scenario_evaluations', ['organization_id', 'case_id', 'evaluated_at'])

  // Her normalize analiz satiri analysisVersion tenant/case kimligiyle birlikte
  // baglanir; salt UUID FK ile baska organizasyon etiketi tasiyamaz.
  for (const table of ['policy_source_references','policy_coverages','policy_deductibles','policy_service_rules','policy_part_rules','policy_replacement_vehicle_rules','policy_exclusions','policy_required_documents','policy_scenario_rules','policy_evidence_links']) {
    pgm.addConstraint(table, `${table}_version_tenant_fk`, {
      foreignKeys: { columns: ['organization_id','case_id','analysis_version_id'], references: 'policy_analysis_versions (organization_id, case_id, id)', onDelete: 'CASCADE' },
    })
  }
  for (const table of ['policy_conflicts','policy_scenario_evaluations']) {
    pgm.addConstraint(table, `${table}_analysis_tenant_fk`, {
      foreignKeys: { columns: ['organization_id','case_id','analysis_id'], references: 'policy_analyses (organization_id, case_id, id)', onDelete: table === 'policy_conflicts' ? 'CASCADE' : 'RESTRICT' },
    })
    pgm.addConstraint(table, `${table}_version_tenant_fk`, {
      foreignKeys: { columns: ['organization_id','case_id','analysis_version_id'], references: 'policy_analysis_versions (organization_id, case_id, id)', onDelete: table === 'policy_conflicts' ? 'CASCADE' : 'RESTRICT' },
    })
  }
  pgm.addConstraint('policy_evidence_links', 'policy_evidence_links_source_tenant_fk', {
    foreignKeys: { columns: ['organization_id','case_id','source_reference_id'], references: 'policy_source_references (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  for (const side of ['a','b']) pgm.addConstraint('policy_conflicts', `policy_conflicts_source_${side}_tenant_fk`, {
    foreignKeys: { columns: ['organization_id','case_id',`source_${side}_id`], references: 'policy_source_references (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })

  // Casco + ready/verified source documentVersion DB seviyesinde zorlanir.
  pgm.createFunction('policy_analysis_source_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (SELECT 1 FROM cases c WHERE c.organization_id=NEW.organization_id AND c.id=NEW.case_id AND c.case_type='casco') THEN
      RAISE EXCEPTION 'policy analysis requires a casco case' USING ERRCODE='check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents d JOIN document_versions dv ON dv.document_id=d.id
      WHERE d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id AND d.id=NEW.source_document_id
        AND d.document_type='casco_policy' AND dv.id=NEW.source_document_version_id
        AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id
        AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'policy source is not a ready verified casco policy version' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END;`)
  for (const table of ['policy_analyses', 'policy_analysis_versions']) {
    pgm.createTrigger(table, `${table}_source_guard`, { when: 'BEFORE', operation: ['INSERT', 'UPDATE'], level: 'ROW', function: 'policy_analysis_source_guard' })
  }

  // Her madde kaynagi da ana kaynakla ayni tenant/case'e ait, ready ve
  // fiziksel olarak dogrulanmis documentVersion olmalidir.
  pgm.createFunction('policy_source_reference_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM policy_analysis_versions pav
      JOIN documents d ON d.id=NEW.document_id
      JOIN document_versions dv ON dv.id=NEW.document_version_id AND dv.document_id=d.id
      WHERE pav.id=NEW.analysis_version_id AND pav.organization_id=NEW.organization_id AND pav.case_id=NEW.case_id
        AND d.organization_id=NEW.organization_id AND d.case_id=NEW.case_id
        AND dv.organization_id=NEW.organization_id AND dv.case_id=NEW.case_id
        AND dv.status='ready' AND dv.hash_verified AND dv.size_verified AND dv.verified_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'policy evidence source is not a ready verified case document version' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_source_references', 'policy_source_references_source_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_source_reference_guard' })

  pgm.createFunction('policy_evidence_link_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM policy_source_references r
      WHERE r.id=NEW.source_reference_id AND r.analysis_version_id=NEW.analysis_version_id
        AND r.organization_id=NEW.organization_id AND r.case_id=NEW.case_id
    ) THEN
      RAISE EXCEPTION 'policy evidence link crosses analysis or tenant boundary' USING ERRCODE='foreign_key_violation';
    END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_evidence_links', 'policy_evidence_links_scope_guard', { when: 'BEFORE', operation: 'INSERT', level: 'ROW', function: 'policy_evidence_link_guard' })

  pgm.createFunction('policy_source_append_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    RAISE EXCEPTION 'policy evidence is append-only' USING ERRCODE='restrict_violation';
  END;`)
  for (const table of ['policy_source_references', 'policy_evidence_links', 'policy_scenario_evaluations']) {
    pgm.createTrigger(table, `${table}_append_only`, { when: 'BEFORE', operation: ['UPDATE', 'DELETE'], level: 'ROW', function: 'policy_source_append_guard' })
  }

  // Approved version yalniz superseded olabilir; baska alani degisemez.
  pgm.createFunction('policy_approved_version_guard', [], { returns: 'trigger', language: 'plpgsql' }, `BEGIN
    IF OLD.analysis_status='superseded' THEN
      RAISE EXCEPTION 'superseded policy analysis version is immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF OLD.analysis_status='approved' THEN
      IF NEW.analysis_status='superseded' AND NEW.is_active=false
         AND (to_jsonb(NEW) - 'analysis_status' - 'is_active') = (to_jsonb(OLD) - 'analysis_status' - 'is_active') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'approved policy analysis version is immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF NEW.analysis_status='approved' THEN
      IF NEW.source_completeness <> 'complete' OR NEW.human_approval_status <> 'approved'
         OR NEW.approved_by_user_id IS NULL OR NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'approved policy analysis requires complete source and human approval' USING ERRCODE='check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM policy_source_references r WHERE r.analysis_version_id=NEW.id) THEN
        RAISE EXCEPTION 'approved policy analysis requires evidence' USING ERRCODE='check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM policy_conflicts c WHERE c.analysis_version_id=NEW.id AND c.resolution_status IN ('open','control_required')) THEN
        RAISE EXCEPTION 'open policy conflicts block approval' USING ERRCODE='check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END;`)
  pgm.createTrigger('policy_analysis_versions', 'policy_analysis_versions_approved_guard', { when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'policy_approved_version_guard' })

  pgm.createFunction('policy_fact_approved_guard', [], { returns: 'trigger', language: 'plpgsql' }, `DECLARE v_id uuid; BEGIN
    v_id := CASE WHEN TG_OP='DELETE' THEN OLD.analysis_version_id ELSE NEW.analysis_version_id END;
    IF EXISTS (SELECT 1 FROM policy_analysis_versions v WHERE v.id=v_id AND v.analysis_status IN ('approved','superseded')) THEN
      RAISE EXCEPTION 'approved policy analysis facts are immutable' USING ERRCODE='restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END;`)
  for (const table of ['policy_coverages','policy_deductibles','policy_service_rules','policy_part_rules','policy_replacement_vehicle_rules','policy_exclusions','policy_required_documents','policy_scenario_rules']) {
    pgm.createTrigger(table, `${table}_approved_guard`, { when: 'BEFORE', operation: ['INSERT', 'UPDATE', 'DELETE'], level: 'ROW', function: 'policy_fact_approved_guard' })
  }
}

export function down(pgm) {
  for (const table of ['policy_coverages','policy_deductibles','policy_service_rules','policy_part_rules','policy_replacement_vehicle_rules','policy_exclusions','policy_required_documents','policy_scenario_rules']) {
    pgm.dropTrigger(table, `${table}_approved_guard`)
  }
  pgm.dropFunction('policy_fact_approved_guard', [])
  pgm.dropTrigger('policy_analysis_versions', 'policy_analysis_versions_approved_guard')
  pgm.dropFunction('policy_approved_version_guard', [])
  pgm.dropTrigger('policy_evidence_links', 'policy_evidence_links_scope_guard')
  pgm.dropFunction('policy_evidence_link_guard', [])
  pgm.dropTrigger('policy_source_references', 'policy_source_references_source_guard')
  pgm.dropFunction('policy_source_reference_guard', [])
  for (const table of ['policy_source_references', 'policy_evidence_links', 'policy_scenario_evaluations']) pgm.dropTrigger(table, `${table}_append_only`)
  pgm.dropFunction('policy_source_append_guard', [])
  for (const table of ['policy_analyses', 'policy_analysis_versions']) pgm.dropTrigger(table, `${table}_source_guard`)
  pgm.dropFunction('policy_analysis_source_guard', [])
  pgm.dropTable('policy_scenario_evaluations')
  pgm.dropTable('policy_conflicts')
  pgm.dropTable('policy_evidence_links')
  pgm.dropTable('policy_scenario_rules')
  pgm.dropTable('policy_required_documents')
  pgm.dropTable('policy_exclusions')
  pgm.dropTable('policy_replacement_vehicle_rules')
  pgm.dropTable('policy_part_rules')
  pgm.dropTable('policy_service_rules')
  pgm.dropTable('policy_deductibles')
  pgm.dropTable('policy_coverages')
  pgm.dropTable('policy_source_references')
  pgm.dropConstraint('policy_analyses', 'policy_analyses_current_version_fk')
  pgm.dropTable('policy_analysis_versions')
  pgm.dropTable('policy_analyses')
  pgm.dropConstraint('document_versions', 'document_versions_org_case_id_unique')
  pgm.dropConstraint('documents', 'documents_org_case_id_unique')
  pgm.dropConstraint('cases', 'cases_org_id_unique')
}
