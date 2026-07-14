import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  IDEMPOTENCY_KEY_HEADER,
  POLICY_ANALYSES_ROUTE,
  POLICY_ANALYSIS_APPROVE_ROUTE,
  POLICY_ANALYSIS_APPROVE_SCOPE,
  POLICY_ANALYSIS_CREATE_SCOPE,
  POLICY_ANALYSIS_REJECT_ROUTE,
  POLICY_ANALYSIS_REJECT_SCOPE,
  POLICY_ANALYSIS_ROUTE,
  POLICY_ANALYSIS_VERSION_SCOPE,
  POLICY_ANALYSIS_VERSIONS_ROUTE,
  POLICY_CONFLICT_RESOLVE_ROUTE,
  POLICY_CONFLICT_RESOLVE_SCOPE,
  POLICY_CONFLICTS_ROUTE,
  POLICY_SCENARIO_EVALUATE_ROUTE,
  POLICY_SCENARIO_EVALUATE_SCOPE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  policyAnalysesListResponseSchema,
  policyAnalysisApprovalRequestSchema,
  policyAnalysisCreateRequestSchema,
  policyAnalysisParamsSchema,
  policyAnalysisRejectRequestSchema,
  policyAnalysisResponseSchema,
  policyAnalysisVersionCreateRequestSchema,
  policyAnalysisVersionsResponseSchema,
  policyCaseParamsSchema,
  policyConflictParamsSchema,
  policyConflictResolutionRequestSchema,
  policyConflictsResponseSchema,
  policyScenarioEvaluateRequestSchema,
  policyScenarioEvaluationResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody, isIdempotencyRace } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createPolicyAnalysisStore, PolicyStoreError } from './store.js'

export interface PolicyAnalysisRoutesOptions { readonly pool: pg.Pool }
const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const APPROVAL_ROLES = ['admin', 'expert'] as const

function parseKey(request: { headers: Record<string, unknown> }): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER]
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw)
  return parsed.success ? parsed.data : undefined
}
function sendKeyRequired(reply: FastifyReply, requestId: string): void {
  void reply.code(400).send(failureEnvelopeSchema.parse({ ok:false,error:{code:'validation_error',message:'Request validation failed.',fieldErrors:[{path:IDEMPOTENCY_KEY_HEADER,code:'idempotency_key_required',message:'Field value is not allowed.'}],requestId} }))
}
function sendStoreError(reply: FastifyReply, requestId: string, error: PolicyStoreError) {
  if (error.code === 'not_found') return reply.code(404).send(failureBody('not_found', 'Policy analysis not found.', requestId))
  if (error.code === 'wrong_case_type' || error.code === 'invalid_source' || error.code === 'invalid_insurer') {
    return reply.code(400).send(failureBody('policy_source_invalid', 'Policy source or case is not eligible for analysis.', requestId))
  }
  if (error.code === 'version_conflict') return reply.code(409).send(failureBody('policy_analysis_stale', 'Policy analysis version changed.', requestId))
  if (error.code === 'idempotency_conflict') return reply.code(409).send(failureBody('idempotency_conflict', 'Idempotency key was used with a different request.', requestId))
  return reply.code(409).send(failureBody('policy_analysis_conflict', 'Policy analysis state does not permit this operation.', requestId))
}

export function registerPolicyAnalysisRoutes(app: FastifyInstance, options: PolicyAnalysisRoutesOptions): void {
  const auth = createAuthStore(options.pool); const store = createPolicyAnalysisStore(options.pool)
  const actor = (session: { user: { organizationId: string; id: string } }, request: FastifyRequest) => ({ organizationId:session.user.organizationId,actorUserId:session.user.id,requestId:String(request.id) })
  const idem = (scope:string,key:string,body:unknown) => ({ scope,key,requestHash:hashRequestBody(body) })

  app.get(POLICY_ANALYSES_ROUTE, async(request,reply)=>{
    const requestId=String(request.id);const session=await requireSession(auth,request,reply);if(session===undefined)return
    const params=policyCaseParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const items=await store.list(session.user.organizationId,params.data.caseId);if(items===undefined)return reply.code(404).send(failureBody('not_found','Case not found.',requestId))
    return policyAnalysesListResponseSchema.parse({items})
  })
  app.get(POLICY_ANALYSIS_ROUTE, async(request,reply)=>{
    const requestId=String(request.id);const session=await requireSession(auth,request,reply);if(session===undefined)return
    const params=policyAnalysisParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const analysis=await store.find(session.user.organizationId,params.data.caseId,params.data.analysisId);if(analysis===undefined)return reply.code(404).send(failureBody('not_found','Policy analysis not found.',requestId))
    return policyAnalysisResponseSchema.parse({analysis})
  })
  app.get(POLICY_ANALYSIS_VERSIONS_ROUTE, async(request,reply)=>{
    const requestId=String(request.id);const session=await requireSession(auth,request,reply);if(session===undefined)return
    const params=policyAnalysisParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const versions=await store.versions(session.user.organizationId,params.data.caseId,params.data.analysisId);if(versions===undefined)return reply.code(404).send(failureBody('not_found','Policy analysis not found.',requestId))
    return policyAnalysisVersionsResponseSchema.parse({versions})
  })
  app.get(POLICY_CONFLICTS_ROUTE, async(request,reply)=>{
    const requestId=String(request.id);const session=await requireSession(auth,request,reply);if(session===undefined)return
    const params=policyCaseParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const items=await store.conflicts(session.user.organizationId,params.data.caseId);if(items===undefined)return reply.code(404).send(failureBody('not_found','Case not found.',requestId));return policyConflictsResponseSchema.parse({items})
  })

  async function command(request:FastifyRequest,reply:FastifyReply,kind:'create'|'version'|'approve'|'reject'|'resolve'|'evaluate'){
    const requestId=String(request.id);const roles=kind==='approve'||kind==='reject'||kind==='resolve'?APPROVAL_ROLES:WRITE_ROLES
    const session=await requireAnyRole(auth,request,reply,roles);if(session===undefined)return
    const key=parseKey(request as {headers:Record<string,unknown>});if(key===undefined)return sendKeyRequired(reply,requestId)
    const paramSchema=kind==='resolve'?policyConflictParamsSchema:kind==='evaluate'||kind==='create'?policyCaseParamsSchema:policyAnalysisParamsSchema
    const params=paramSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const schema=kind==='create'?policyAnalysisCreateRequestSchema:kind==='version'?policyAnalysisVersionCreateRequestSchema:kind==='approve'?policyAnalysisApprovalRequestSchema:kind==='reject'?policyAnalysisRejectRequestSchema:kind==='resolve'?policyConflictResolutionRequestSchema:policyScenarioEvaluateRequestSchema
    const body=schema.safeParse(request.body);if(!body.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(body.error,requestId)}))
    const scope=kind==='create'?POLICY_ANALYSIS_CREATE_SCOPE:kind==='version'?POLICY_ANALYSIS_VERSION_SCOPE:kind==='approve'?POLICY_ANALYSIS_APPROVE_SCOPE:kind==='reject'?POLICY_ANALYSIS_REJECT_SCOPE:kind==='resolve'?POLICY_CONFLICT_RESOLVE_SCOPE:POLICY_SCENARIO_EVALUATE_SCOPE
    const caseId=(params.data as {caseId:string}).caseId;const context=idem(scope,key,{kind,caseId,...body.data})
    const run=()=>kind==='create'?store.create(actor(session,request),caseId,body.data as never,context)
      :kind==='version'?store.createVersion(actor(session,request),caseId,(params.data as unknown as {analysisId:string}).analysisId,body.data as never,context)
      :kind==='approve'?store.approve(actor(session,request),caseId,(params.data as unknown as {analysisId:string}).analysisId,body.data as never,context)
      :kind==='reject'?store.reject(actor(session,request),caseId,(params.data as unknown as {analysisId:string}).analysisId,body.data as never,context)
      :kind==='resolve'?store.resolveConflict(actor(session,request),caseId,(params.data as unknown as {conflictId:string}).conflictId,body.data as never,context)
      :store.evaluate(actor(session,request),caseId,body.data as never,context)
    try{
      let result
      try{result=await run()}catch(error){if(!isIdempotencyRace(error))throw error;result=await run()}
      const response=kind==='evaluate'?policyScenarioEvaluationResponseSchema.parse(result.body):policyAnalysisResponseSchema.parse(result.body)
      return reply.code(result.status).send(response)
    }catch(error){if(error instanceof PolicyStoreError)return sendStoreError(reply,requestId,error);throw error}
  }
  app.post(POLICY_ANALYSES_ROUTE,async(request,reply)=>command(request,reply,'create'))
  app.post(POLICY_ANALYSIS_VERSIONS_ROUTE,async(request,reply)=>command(request,reply,'version'))
  app.post(POLICY_ANALYSIS_APPROVE_ROUTE,async(request,reply)=>command(request,reply,'approve'))
  app.post(POLICY_ANALYSIS_REJECT_ROUTE,async(request,reply)=>command(request,reply,'reject'))
  app.post(POLICY_CONFLICT_RESOLVE_ROUTE,async(request,reply)=>command(request,reply,'resolve'))
  app.post(POLICY_SCENARIO_EVALUATE_ROUTE,async(request,reply)=>command(request,reply,'evaluate'))
}
