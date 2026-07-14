/** Paket 15 — sürümlü, salt-okunur evrak gereksinimi kural temeli. */
export const shorthands = undefined
export function up(pgm) {
  pgm.addColumn('cases', { recourse_status: { type: 'text', notNull: true, default: 'unknown' } })
  pgm.addConstraint('cases', 'cases_recourse_status_valid', { check: "recourse_status IN ('confirmed','not_confirmed','unknown')" })
  pgm.createTable('document_rule_sets', { id:{type:'uuid',primaryKey:true}, code:{type:'text',notNull:true}, case_type:{type:'text',notNull:true}, status:{type:'text',notNull:true}, source_reference:{type:'text',notNull:true}, created_at:{type:'timestamptz',notNull:true,default:pgm.func('now()')} })
  pgm.addConstraint('document_rule_sets','document_rule_sets_code_case_type_unique',{unique:['code','case_type']})
  pgm.addConstraint('document_rule_sets','document_rule_sets_case_type_valid',{check:"case_type IN ('traffic','casco')"})
  pgm.addConstraint('document_rule_sets','document_rule_sets_status_valid',{check:"status IN ('active','retired')"})
  pgm.createTable('document_rule_versions', { id:{type:'uuid',primaryKey:true}, rule_set_id:{type:'uuid',notNull:true,references:'document_rule_sets',onDelete:'RESTRICT'}, version:{type:'text',notNull:true}, effective_from:{type:'date',notNull:true}, effective_to:{type:'date'}, conditions:{type:'jsonb',notNull:true}, requirements:{type:'jsonb',notNull:true}, source_reference:{type:'text',notNull:true}, status:{type:'text',notNull:true}, created_at:{type:'timestamptz',notNull:true,default:pgm.func('now()')} })
  pgm.addConstraint('document_rule_versions','document_rule_versions_unique',{unique:['rule_set_id','version']})
  pgm.addConstraint('document_rule_versions','document_rule_versions_range',{check:'effective_to IS NULL OR effective_to >= effective_from'})
  pgm.addConstraint('document_rule_versions','document_rule_versions_status_valid',{check:"status IN ('active','retired')"})
  pgm.addConstraint('document_rule_versions','document_rule_versions_conditions_object',{check:"jsonb_typeof(conditions) = 'object'"})
  pgm.addConstraint('document_rule_versions','document_rule_versions_requirements_object',{check:"jsonb_typeof(requirements) = 'object'"})
  pgm.createTable('document_rule_evaluations', { id:{type:'uuid',primaryKey:true}, organization_id:{type:'uuid',notNull:true,references:'organizations',onDelete:'RESTRICT'}, case_id:{type:'uuid',notNull:true,references:'cases',onDelete:'CASCADE'}, rule_version_id:{type:'uuid',notNull:true,references:'document_rule_versions',onDelete:'RESTRICT'}, input_facts:{type:'jsonb',notNull:true}, evaluated_at:{type:'timestamptz',notNull:true}, evaluated_by_user_id:{type:'uuid',references:'users',onDelete:'SET NULL'}, audit_event_id:{type:'uuid',references:'audit_events',onDelete:'SET NULL'} })
  pgm.createTable('document_rule_evaluation_items', { id:{type:'uuid',primaryKey:true}, evaluation_id:{type:'uuid',notNull:true,references:'document_rule_evaluations',onDelete:'CASCADE'}, requirement_code:{type:'text',notNull:true}, result:{type:'jsonb',notNull:true} })
  pgm.addConstraint('document_rule_evaluation_items','document_rule_evaluation_items_unique',{unique:['evaluation_id','requirement_code']})
  pgm.addConstraint('document_rule_evaluation_items','document_rule_evaluation_items_result_object',{check:"jsonb_typeof(result) = 'object'"})
  pgm.createIndex('document_rule_evaluations',['organization_id','case_id','evaluated_at'])
  pgm.createIndex('document_rule_evaluation_items',['evaluation_id','requirement_code'])
  pgm.sql("INSERT INTO document_rule_sets (id,code,case_type,status,source_reference) VALUES ('019f5f00-0000-7000-8000-000000000001','document-requirements-tr-canonical','traffic','active','DOMAIN_RULES.md#evrak'),('019f5f00-0000-7000-8000-000000000002','document-requirements-tr-canonical','casco','active','DOMAIN_RULES.md#evrak')")
  pgm.sql("INSERT INTO document_rule_versions (id,rule_set_id,version,effective_from,conditions,requirements,source_reference,status) VALUES ('019f5f00-0000-7000-8000-000000000011','019f5f00-0000-7000-8000-000000000001','2026.07.14.1','2026-07-14','{}'::jsonb,'{}'::jsonb,'DOMAIN_RULES.md#evrak','active'),('019f5f00-0000-7000-8000-000000000012','019f5f00-0000-7000-8000-000000000002','2026.07.14.1','2026-07-14','{}'::jsonb,'{}'::jsonb,'DOMAIN_RULES.md#evrak','active')")
}
export function down(pgm) { pgm.dropTable('document_rule_evaluation_items'); pgm.dropTable('document_rule_evaluations'); pgm.dropTable('document_rule_versions'); pgm.dropTable('document_rule_sets'); pgm.dropConstraint('cases','cases_recourse_status_valid'); pgm.dropColumn('cases','recourse_status') }
