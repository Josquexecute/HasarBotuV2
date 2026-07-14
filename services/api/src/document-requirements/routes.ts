import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { DOCUMENT_REQUIREMENTS_ROUTE, documentRequirementsParamsSchema, documentRequirementsResponseSchema, failureEnvelopeSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { evaluateDocumentRequirements, type CanonicalDocumentType, type DocumentMetadataStatus, type DocumentRequirementRuleSet } from '@hasarbotu/domain'
import { requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { failureBody } from '../errors/failure.js'
export interface DocumentRequirementsRoutesOptions { readonly pool: pg.Pool }
interface CaseRow { case_type: 'traffic'|'casco'; recourse_status: 'confirmed'|'not_confirmed'|'unknown' }
interface DocRow { id:string; document_type:CanonicalDocumentType; status:DocumentMetadataStatus; hash_verified:boolean; size_verified:boolean; verified_at:Date|null }
interface RuleRow { rule_set_id:string; version:string; effective_from:string|Date; effective_to:string|Date|null; case_type:'traffic'|'casco'; status:'active'|'retired'; source_reference:string }
function toDateOnly(value: string|Date): string { return typeof value==='string' ? value.slice(0,10) : value.toISOString().slice(0,10) }
export function registerDocumentRequirementsRoutes(app: FastifyInstance, options: DocumentRequirementsRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  app.get(DOCUMENT_REQUIREMENTS_ROUTE, async (request, reply) => {
    const requestId=String(request.id); const session=await requireSession(auth,request,reply); if (session===undefined) return
    const params=documentRequirementsParamsSchema.safeParse(request.params); if(!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const caseResult=await options.pool.query('SELECT case_type, recourse_status FROM cases WHERE organization_id=$1 AND id::text=$2',[session.user.organizationId,params.data.caseId]); const row=caseResult.rows[0] as CaseRow|undefined
    if(row===undefined) return reply.code(404).send(failureBody('not_found','Case not found.',requestId))
    const docs=await options.pool.query('SELECT dv.id,d.document_type,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id WHERE d.organization_id=$1 AND d.case_id::text=$2',[session.user.organizationId,params.data.caseId])
    const evaluatedAt=new Date().toISOString()
    const ruleResult=await options.pool.query(`SELECT rs.id AS rule_set_id,rv.version,rv.effective_from,rv.effective_to,rs.case_type,rv.status,rv.source_reference FROM document_rule_sets rs JOIN document_rule_versions rv ON rv.rule_set_id=rs.id WHERE rs.case_type=$1 AND rs.status='active' AND rv.status='active' AND rv.effective_from <= $2::date AND (rv.effective_to IS NULL OR rv.effective_to >= $2::date) ORDER BY rv.effective_from DESC,rv.version DESC LIMIT 1`,[row.case_type,evaluatedAt])
    const ruleRow=ruleResult.rows[0] as RuleRow|undefined
    if(ruleRow===undefined) throw new Error('active_document_rule_version_not_found')
    const ruleSet: DocumentRequirementRuleSet={ruleSetId:ruleRow.rule_set_id,version:ruleRow.version,effectiveFrom:toDateOnly(ruleRow.effective_from),effectiveTo:ruleRow.effective_to===null?null:toDateOnly(ruleRow.effective_to),caseType:ruleRow.case_type,status:ruleRow.status,sourceReference:ruleRow.source_reference}
    const evaluation=evaluateDocumentRequirements({caseType:row.case_type,recourseStatus:row.recourse_status,documents:(docs.rows as DocRow[]).map((d)=>({id:d.id,canonicalDocumentType:d.document_type,status:d.status,hashVerified:d.hash_verified,sizeVerified:d.size_verified,verifiedAt:d.verified_at?.toISOString()??null}))},evaluatedAt,ruleSet)
    const missingCount=evaluation.requirements.filter((item)=>item.status==='missing').length; const controlRequiredCount=evaluation.requirements.filter((item)=>item.status==='control_required').length
    const overallStatus=missingCount>0?'missing':controlRequiredCount>0?'control_required':'present'
    return documentRequirementsResponseSchema.parse({caseId:params.data.caseId,caseType:row.case_type,ruleSetVersion:evaluation.ruleSet.version,overallStatus,requirements:evaluation.requirements,alternativeGroups:evaluation.alternativeGroups,missingCount,controlRequiredCount,evaluatedAt})
  })
}
