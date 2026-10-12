import { documentRuleConfigurationSchema } from '@hasarbotu/contracts'
import { defaultDocumentRequirementConfiguration, toOfficeDate, type DocumentRequirementRuleSet } from '@hasarbotu/domain'
import type { Queryable } from '../db/executor.js'

interface RuleRow {
  id: string;rule_set_id: string;version: string;effective_from: string | Date;effective_to: string | Date | null
  case_type: 'traffic' | 'casco';status: 'active' | 'retired';source_reference: string;requirements?: { configuration?: unknown }
}
const dateOnly = (value: string | Date) => typeof value === 'string' ? value.slice(0,10) : toOfficeDate(value)
export async function loadDocumentRequirementRules(exec: Queryable,organizationId: string,asOfDate: string) {
  const rows = (await exec.query(`SELECT DISTINCT ON (rs.case_type) rv.id,rs.id AS rule_set_id,rv.version,rv.effective_from::text,rv.effective_to::text,rs.case_type,rv.status,rv.source_reference,rv.requirements
    FROM document_rule_sets rs JOIN document_rule_versions rv ON rv.rule_set_id=rs.id
    WHERE rs.status='active' AND rv.status='active' AND (rs.organization_id=$1 OR rs.organization_id IS NULL)
    AND rv.effective_from<=$2::date AND (rv.effective_to IS NULL OR rv.effective_to>=$2::date)
    ORDER BY rs.case_type,(rs.organization_id IS NOT NULL) DESC,rv.effective_from DESC,rv.created_at DESC,rv.version DESC`,[organizationId,toOfficeDate(asOfDate)])).rows as RuleRow[]
  return new Map(rows.map((row) => {
    const configuration = row.requirements?.configuration === undefined ? defaultDocumentRequirementConfiguration(row.case_type) : documentRuleConfigurationSchema.parse(row.requirements.configuration)
    const rule: DocumentRequirementRuleSet = { ruleSetId: row.rule_set_id,version: row.version,effectiveFrom: dateOnly(row.effective_from),effectiveTo: row.effective_to === null ? null : dateOnly(row.effective_to),caseType: row.case_type,status: row.status,sourceReference: row.source_reference,configuration }
    return [row.case_type,{ versionId: row.id,rule }] as const
  }))
}
