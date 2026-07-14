import {
  documentRequirementsResponseSchema,
  type DocumentRequirementsResponse,
} from '@hasarbotu/contracts'
import {
  evaluateDocumentRequirements,
  type CanonicalDocumentType,
  type DocumentMetadataStatus,
  type DocumentRequirementRuleSet,
} from '@hasarbotu/domain'
import type { Queryable } from '../db/executor.js'

interface CaseRow { case_type: 'traffic' | 'casco'; recourse_status: 'confirmed' | 'not_confirmed' | 'unknown' }
interface DocRow { id: string; document_type: CanonicalDocumentType; status: DocumentMetadataStatus; hash_verified: boolean; size_verified: boolean; verified_at: Date | null }
interface RuleRow { rule_set_id: string; version: string; effective_from: string | Date; effective_to: string | Date | null; case_type: 'traffic' | 'casco'; status: 'active' | 'retired'; source_reference: string }

function dateOnly(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

/** Paket 15 motorunun API ve lifecycle tarafindan ortak, salt-okunur kullanimi. */
export async function evaluateCaseDocumentRequirements(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  evaluatedAt: string,
): Promise<DocumentRequirementsResponse | undefined> {
  const caseResult = await exec.query(
    'SELECT case_type,recourse_status FROM cases WHERE organization_id=$1 AND id::text=$2',
    [organizationId, caseId],
  )
  const row = caseResult.rows[0] as CaseRow | undefined
  if (row === undefined) return undefined
  const docs = await exec.query(
    `SELECT dv.id,d.document_type,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at
     FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id
     WHERE d.organization_id=$1 AND d.case_id::text=$2`,
    [organizationId, caseId],
  )
  const ruleResult = await exec.query(
    `SELECT rs.id AS rule_set_id,rv.version,rv.effective_from,rv.effective_to,rs.case_type,rv.status,rv.source_reference
     FROM document_rule_sets rs JOIN document_rule_versions rv ON rv.rule_set_id=rs.id
     WHERE rs.case_type=$1 AND rs.status='active' AND rv.status='active'
       AND rv.effective_from <= $2::date AND (rv.effective_to IS NULL OR rv.effective_to >= $2::date)
     ORDER BY rv.effective_from DESC,rv.version DESC LIMIT 1`,
    [row.case_type, evaluatedAt],
  )
  const ruleRow = ruleResult.rows[0] as RuleRow | undefined
  if (ruleRow === undefined) throw new Error('active_document_rule_version_not_found')
  const ruleSet: DocumentRequirementRuleSet = {
    ruleSetId: ruleRow.rule_set_id,
    version: ruleRow.version,
    effectiveFrom: dateOnly(ruleRow.effective_from),
    effectiveTo: ruleRow.effective_to === null ? null : dateOnly(ruleRow.effective_to),
    caseType: ruleRow.case_type,
    status: ruleRow.status,
    sourceReference: ruleRow.source_reference,
  }
  const evaluation = evaluateDocumentRequirements({
    caseType: row.case_type,
    recourseStatus: row.recourse_status,
    documents: (docs.rows as DocRow[]).map((document) => ({
      id: document.id,
      canonicalDocumentType: document.document_type,
      status: document.status,
      hashVerified: document.hash_verified,
      sizeVerified: document.size_verified,
      verifiedAt: document.verified_at?.toISOString() ?? null,
    })),
  }, evaluatedAt, ruleSet)
  const missingCount = evaluation.requirements.filter((item) => item.status === 'missing').length
  const controlRequiredCount = evaluation.requirements.filter((item) => item.status === 'control_required').length
  return documentRequirementsResponseSchema.parse({
    caseId,
    caseType: row.case_type,
    ruleSetVersion: evaluation.ruleSet.version,
    overallStatus: missingCount > 0 ? 'missing' : controlRequiredCount > 0 ? 'control_required' : 'present',
    requirements: evaluation.requirements,
    alternativeGroups: evaluation.alternativeGroups,
    missingCount,
    controlRequiredCount,
    evaluatedAt,
  })
}
