import {
  documentRequirementsResponseSchema,
  type DocumentRequirementsResponse,
} from '@hasarbotu/contracts'
import {
  evaluateDocumentRequirements,
  type CanonicalDocumentType,
  type DocumentMetadataStatus,
} from '@hasarbotu/domain'
import type { Queryable } from '../db/executor.js'
import { loadDocumentRequirementRules } from './rules.js'
import { requireCaseType } from '../cases/classification.js'

interface CaseRow { case_type: 'traffic' | 'casco' | null; recourse_status: 'confirmed' | 'not_confirmed' | 'unknown' }
interface DocRow { id: string; document_type: CanonicalDocumentType; status: DocumentMetadataStatus; hash_verified: boolean; size_verified: boolean; verified_at: Date | null }
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
  const caseType = requireCaseType(row.case_type)
  const docs = await exec.query(
    `SELECT d.id,d.document_type,d.status,d.hash_verified,d.size_verified,d.verified_at
     FROM tracking_requirement_documents d
     WHERE d.organization_id=$1 AND d.case_id::text=$2`,
    [organizationId, caseId],
  )
  const ruleSet = (await loadDocumentRequirementRules(exec,organizationId,evaluatedAt)).get(caseType)?.rule
  if (!ruleSet) throw new Error('active_document_rule_version_not_found')
  const evaluation = evaluateDocumentRequirements({
    caseType,
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
    caseType,
    ruleSetVersion: evaluation.ruleSet.version,
    overallStatus: missingCount > 0 ? 'missing' : controlRequiredCount > 0 ? 'control_required' : 'present',
    requirements: evaluation.requirements,
    alternativeGroups: evaluation.alternativeGroups,
    missingCount,
    controlRequiredCount,
    evaluatedAt,
  })
}
