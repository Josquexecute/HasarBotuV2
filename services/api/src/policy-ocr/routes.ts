import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  IDEMPOTENCY_KEY_HEADER,
  POLICY_OCR_CANCEL_ROUTE,
  POLICY_OCR_CANCEL_SCOPE,
  POLICY_OCR_CREATE_SCOPE,
  POLICY_OCR_ELEMENTS_ROUTE,
  POLICY_OCR_PAGES_ROUTE,
  POLICY_OCR_RETRY_ROUTE,
  POLICY_OCR_RETRY_SCOPE,
  POLICY_OCR_RUN_ROUTE,
  POLICY_OCR_RUNS_ROUTE,
  POLICY_OCR_SOURCE_REFERENCE_ROUTE,
  POLICY_OCR_SOURCE_REFERENCE_SCOPE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  policyOcrCreateParamsSchema,
  policyOcrElementsQuerySchema,
  policyOcrElementsResponseSchema,
  policyOcrListQuerySchema,
  policyOcrPagesResponseSchema,
  policyOcrRunCancelRequestSchema,
  policyOcrRunCreateRequestSchema,
  policyOcrRunParamsSchema,
  policyOcrRunResponseSchema,
  policyOcrRunRetryRequestSchema,
  policyOcrRunsResponseSchema,
  policyOcrSourceReferenceRequestSchema,
  policyOcrSourceReferenceResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createPolicyOcrStore, PolicyOcrStoreError } from './store.js'

const WRITE_ROLES=['admin','expert','case_manager'] as const
function idempotencyKey(request:FastifyRequest):string|undefined{const raw=request.headers[IDEMPOTENCY_KEY_HEADER];const parsed=idempotencyKeySchema.safeParse(Array.isArray(raw)?raw[0]:raw);return parsed.success?parsed.data:undefined}
function keyRequired(reply:FastifyReply,requestId:string){return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:{code:'validation_error',message:'Request validation failed.',fieldErrors:[{path:IDEMPOTENCY_KEY_HEADER,code:'idempotency_key_required',message:'Field value is not allowed.'}],requestId}}))}
function safeError(reply:FastifyReply,requestId:string,error:PolicyOcrStoreError){if(error.code==='not_found')return reply.code(404).send(failureBody('not_found','OCR record not found.',requestId));if(error.code==='invalid_source')return reply.code(400).send(failureBody('ocr_source_invalid','OCR source is not eligible.',requestId));if(error.code==='version_conflict')return reply.code(409).send(failureBody('ocr_stale','OCR version changed.',requestId));if(error.code==='idempotency_conflict')return reply.code(409).send(failureBody('idempotency_conflict','Idempotency key was used with a different request.',requestId));return reply.code(409).send(failureBody('ocr_conflict','OCR state does not permit this operation.',requestId))}
function numericQuery(raw:Record<string,unknown>){const value={...raw};for(const field of ['page','pageSize','pageNumber'])if(typeof value[field]==='string'&&/^\d+$/.test(value[field] as string))value[field]=Number(value[field]);return value}
function pageInfo(page:number,pageSize:number,totalItems:number){return{page,pageSize,totalItems,totalPages:Math.ceil(totalItems/pageSize)}}

export function registerPolicyOcrRoutes(app:FastifyInstance,options:{readonly pool:pg.Pool}):void{const auth=createAuthStore(options.pool),store=createPolicyOcrStore(options.pool)
  app.post(POLICY_OCR_RUNS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=policyOcrCreateParamsSchema.safeParse(request.params),body=policyOcrRunCreateRequestSchema.safeParse(request.body??{});if(!params.success||!body.success){const issue=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(issue,requestId)}))}const key=idempotencyKey(request);if(key===undefined)return keyRequired(reply,requestId);try{const result=await store.create({organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},params.data,body.data,{scope:POLICY_OCR_CREATE_SCOPE,key,requestHash:hashRequestBody({params:params.data,body:body.data})});return reply.code(result.status).send(policyOcrRunResponseSchema.parse(result.body))}catch(error){if(error instanceof PolicyOcrStoreError)return safeError(reply,requestId,error);throw error}})
  app.get(POLICY_OCR_RUNS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=policyOcrCreateParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}));const items=await store.list(session.user.organizationId,params.data);if(items===undefined)return reply.code(404).send(failureBody('not_found','OCR source not found.',requestId));return policyOcrRunsResponseSchema.parse({items})})
  app.get(POLICY_OCR_RUN_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=policyOcrRunParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}));const value=await store.get(session.user.organizationId,params.data.caseId,params.data.ocrRunId);if(value===undefined)return reply.code(404).send(failureBody('not_found','OCR record not found.',requestId));return policyOcrRunResponseSchema.parse({ocrRun:value})})
  app.get(POLICY_OCR_PAGES_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=policyOcrRunParamsSchema.safeParse(request.params),query=policyOcrListQuerySchema.safeParse(numericQuery(request.query as Record<string,unknown>));if(!params.success||!query.success){const issue=(!params.success?params.error:!query.success?query.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(issue,requestId)}))}const result=await store.pages(session.user.organizationId,params.data.caseId,params.data.ocrRunId,query.data);if(result===undefined)return reply.code(404).send(failureBody('not_found','OCR record not found.',requestId));return policyOcrPagesResponseSchema.parse({items:result.items,pageInfo:pageInfo(query.data.page,query.data.pageSize,result.total)})})
  app.get(POLICY_OCR_ELEMENTS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=policyOcrRunParamsSchema.safeParse(request.params),query=policyOcrElementsQuerySchema.safeParse(numericQuery(request.query as Record<string,unknown>));if(!params.success||!query.success){const issue=(!params.success?params.error:!query.success?query.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(issue,requestId)}))}const result=await store.elements(session.user.organizationId,params.data.caseId,params.data.ocrRunId,query.data);if(result===undefined)return reply.code(404).send(failureBody('not_found','OCR record not found.',requestId));return policyOcrElementsResponseSchema.parse({items:result.items,pageInfo:pageInfo(query.data.page,query.data.pageSize,result.total)})})
  app.post(POLICY_OCR_CANCEL_ROUTE,async(request,reply)=>command(request,reply,'cancel'))
  app.post(POLICY_OCR_RETRY_ROUTE,async(request,reply)=>command(request,reply,'retry'))
  async function command(request:FastifyRequest,reply:FastifyReply,kind:'cancel'|'retry'){const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=policyOcrRunParamsSchema.safeParse(request.params),body=(kind==='cancel'?policyOcrRunCancelRequestSchema:policyOcrRunRetryRequestSchema).safeParse(request.body);if(!params.success||!body.success){const issue=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(issue,requestId)}))}const key=idempotencyKey(request);if(key===undefined)return keyRequired(reply,requestId);try{const actor={organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},idem={scope:kind==='cancel'?POLICY_OCR_CANCEL_SCOPE:POLICY_OCR_RETRY_SCOPE,key,requestHash:hashRequestBody({params:params.data,body:body.data})};const result=kind==='cancel'?await store.cancel(actor,params.data.caseId,params.data.ocrRunId,body.data.expectedVersion,idem):await store.retry(actor,params.data.caseId,params.data.ocrRunId,body.data.expectedVersion,idem);return reply.code(result.status).send(policyOcrRunResponseSchema.parse(result.body))}catch(error){if(error instanceof PolicyOcrStoreError)return safeError(reply,requestId,error);throw error}}
  app.post(POLICY_OCR_SOURCE_REFERENCE_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=policyOcrRunParamsSchema.safeParse(request.params),body=policyOcrSourceReferenceRequestSchema.safeParse(request.body);if(!params.success||!body.success){const issue=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(issue,requestId)}))}const key=idempotencyKey(request);if(key===undefined)return keyRequired(reply,requestId);try{const result=await store.sourceReference({organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},params.data.caseId,params.data.ocrRunId,body.data,{scope:POLICY_OCR_SOURCE_REFERENCE_SCOPE,key,requestHash:hashRequestBody({params:params.data,body:body.data})});return reply.code(result.status).send(policyOcrSourceReferenceResponseSchema.parse(result.body))}catch(error){if(error instanceof PolicyOcrStoreError)return safeError(reply,requestId,error);throw error}})
}
