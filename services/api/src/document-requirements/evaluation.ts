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
export interface VerifiedWorkspaceMove {
  readonly source: { readonly storageRootKey: string; readonly relativePath: string }
  readonly destination: { readonly storageRootKey: string; readonly relativePath: string }
}
/** Paket 15 motorunun API ve lifecycle tarafindan ortak, salt-okunur kullanimi. */
export async function evaluateCaseDocumentRequirements(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  evaluatedAt: string,
  verifiedMove?: VerifiedWorkspaceMove,
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
  if (verifiedMove) {
    // A recovered manifest proves the source bytes reached this exact destination.
    // Keep source observations immutable and let any destination observation take precedence.
    const moved = await exec.query<DocRow>(
      `SELECT o.id,o.document_type,
         CASE o.status WHEN 'approved' THEN 'ready' WHEN 'rejected' THEN 'missing' ELSE 'pending' END AS status,
         true AS hash_verified,true AS size_verified,o.observed_at AS verified_at
       FROM tracked_files f JOIN document_observations o ON o.file_id=f.id AND o.revision=f.revision
       JOIN case_locations l ON l.organization_id=f.organization_id AND l.case_id=f.case_id
       WHERE f.organization_id=$1 AND f.case_id::text=$2 AND f.storage_root_key=$3
         AND left(f.relative_path,length($4::text)+1)=$4::text||'/' AND f.available AND o.document_type IS NOT NULL
         AND l.storage_root_key=$5 AND l.relative_path=$6
         AND NOT EXISTS(SELECT 1 FROM tracked_files destination
           WHERE destination.organization_id=f.organization_id AND destination.case_id=f.case_id
             AND destination.storage_root_key=$5
             AND destination.relative_path=$6::text||substr(f.relative_path,length($4::text)+1))`,
      [organizationId, caseId, verifiedMove.source.storageRootKey, verifiedMove.source.relativePath,
        verifiedMove.destination.storageRootKey, verifiedMove.destination.relativePath],
    )
    docs.rows.push(...moved.rows)
  }
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
