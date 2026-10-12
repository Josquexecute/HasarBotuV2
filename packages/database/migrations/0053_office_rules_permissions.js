export const shorthands = undefined
export function up(pgm) {
  pgm.addColumn('document_rule_sets',{ organization_id: { type: 'uuid',references: 'organizations',onDelete: 'RESTRICT' } })
  pgm.dropConstraint('document_rule_sets','document_rule_sets_code_case_type_unique')
  pgm.sql('ALTER TABLE document_rule_sets ADD CONSTRAINT document_rule_sets_org_code_type_unique UNIQUE NULLS NOT DISTINCT (organization_id,code,case_type)')
  pgm.createTable('organization_role_policies',{
    organization_id: { type: 'uuid',primaryKey: true,references: 'organizations',onDelete: 'RESTRICT' },
    version: { type: 'integer',notNull: true },permissions: { type: 'jsonb',notNull: true },updated_at: { type: 'timestamptz',notNull: true,default: pgm.func('now()') },
  })
  pgm.addConstraint('organization_role_policies','organization_role_policies_valid',{ check: "version>0 AND jsonb_typeof(permissions)='object'" })
}
export function down(pgm) {
  pgm.dropTable('organization_role_policies')
  pgm.dropConstraint('document_rule_sets','document_rule_sets_org_code_type_unique')
  // Existing tenant policies must be reconciled before downgrade; duplicates fail closed.
  pgm.addConstraint('document_rule_sets','document_rule_sets_code_case_type_unique',{ unique: ['code','case_type'] })
  pgm.dropColumn('document_rule_sets','organization_id')
}
