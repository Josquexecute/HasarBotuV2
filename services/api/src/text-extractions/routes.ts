import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import {
  IDEMPOTENCY_KEY_HEADER,
  PDF_TEXT_EXTRACTIONS_ROUTE,
  PDF_TEXT_EXTRACTION_CANCEL_ROUTE,
  PDF_TEXT_EXTRACTION_CANCEL_SCOPE,
  PDF_TEXT_EXTRACTION_CREATE_SCOPE,
  PDF_TEXT_EXTRACTION_PAGES_ROUTE,
  PDF_TEXT_EXTRACTION_ROUTE,
  PDF_TEXT_EXTRACTION_SEGMENTS_ROUTE,
  PDF_TEXT_EXTRACTION_SOURCE_REFERENCE_ROUTE,
  PDF_TEXT_SOURCE_REFERENCE_SCOPE,
  failureEnvelopeSchema,
  idempotencyKeySchema,
  pdfTextCreateParamsSchema,
  pdfTextExtractionCancelRequestSchema,
  pdfTextExtractionCreateRequestSchema,
  pdfTextExtractionParamsSchema,
  pdfTextExtractionResponseSchema,
  pdfTextExtractionsResponseSchema,
  pdfTextListQuerySchema,
  pdfTextPagesResponseSchema,
  pdfTextSegmentsQuerySchema,
  pdfTextSegmentsResponseSchema,
  pdfTextSourceReferenceRequestSchema,
  pdfTextSourceReferenceResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { hashRequestBody } from '../db/idempotency.js'
import { failureBody } from '../errors/failure.js'
import { createTextExtractionStore, TextExtractionStoreError } from './store.js'

const WRITE_ROLES = ['admin','expert','case_manager'] as const
function key(request:FastifyRequest):string|undefined{const value=request.headers[IDEMPOTENCY_KEY_HEADER];const parsed=idempotencyKeySchema.safeParse(Array.isArray(value)?value[0]:value);return parsed.success?parsed.data:undefined}
function keyRequired(reply:FastifyReply,requestId:string){return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:{code:'validation_error',message:'Request validation failed.',fieldErrors:[{path:IDEMPOTENCY_KEY_HEADER,code:'idempotency_key_required',message:'Field value is not allowed.'}],requestId}}))}
function error(reply:FastifyReply,requestId:string,value:TextExtractionStoreError){if(value.code==='not_found')return reply.code(404).send(failureBody('not_found','Text extraction not found.',requestId));if(value.code==='invalid_source')return reply.code(400).send(failureBody('pdf_source_invalid','PDF source is not eligible.',requestId));if(value.code==='version_conflict')return reply.code(409).send(failureBody('pdf_extraction_stale','Text extraction version changed.',requestId));if(value.code==='idempotency_conflict')return reply.code(409).send(failureBody('idempotency_conflict','Idempotency key was used with a different request.',requestId));return reply.code(409).send(failureBody('pdf_extraction_conflict','Text extraction state does not permit this operation.',requestId))}
function query(raw:Record<string,unknown>){const out={...raw};for(const field of ['page','pageSize','pageNumber'])if(typeof out[field]==='string'&&/^\d+$/.test(out[field] as string))out[field]=Number(out[field]);return out}
function pageInfo(page:number,pageSize:number,totalItems:number){return{page,pageSize,totalItems,totalPages:Math.ceil(totalItems/pageSize)}}

export function registerTextExtractionRoutes(app:FastifyInstance,options:{readonly pool:pg.Pool}):void{const auth=createAuthStore(options.pool),store=createTextExtractionStore(options.pool)
  app.post(PDF_TEXT_EXTRACTIONS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=pdfTextCreateParamsSchema.safeParse(request.params),body=pdfTextExtractionCreateRequestSchema.safeParse(request.body??{});if(!params.success||!body.success){const zod=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(zod,requestId)}))}const idempotencyKey=key(request);if(idempotencyKey===undefined)return keyRequired(reply,requestId);try{const result=await store.create({organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},params.data,{scope:PDF_TEXT_EXTRACTION_CREATE_SCOPE,key:idempotencyKey,requestHash:hashRequestBody({params:params.data,body:body.data})});return reply.code(result.status).send(pdfTextExtractionResponseSchema.parse(result.body))}catch(value){if(value instanceof TextExtractionStoreError)return error(reply,requestId,value);throw value}})
  app.get(PDF_TEXT_EXTRACTIONS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=pdfTextCreateParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}));const items=await store.list(session.user.organizationId,params.data);if(items===undefined)return reply.code(404).send(failureBody('not_found','PDF source not found.',requestId));return pdfTextExtractionsResponseSchema.parse({items})})
  app.get(PDF_TEXT_EXTRACTION_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=pdfTextExtractionParamsSchema.safeParse(request.params);if(!params.success)return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}));const extraction=await store.get(session.user.organizationId,params.data.caseId,params.data.extractionId);if(extraction===undefined)return reply.code(404).send(failureBody('not_found','Text extraction not found.',requestId));return pdfTextExtractionResponseSchema.parse({extraction})})
  app.get(PDF_TEXT_EXTRACTION_PAGES_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=pdfTextExtractionParamsSchema.safeParse(request.params),parsed=pdfTextListQuerySchema.safeParse(query(request.query as Record<string,unknown>));if(!params.success||!parsed.success){const zod=(!params.success?params.error:!parsed.success?parsed.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(zod,requestId)}))}const result=await store.pages(session.user.organizationId,params.data.caseId,params.data.extractionId,parsed.data);if(result===undefined)return reply.code(404).send(failureBody('not_found','Text extraction not found.',requestId));return pdfTextPagesResponseSchema.parse({items:result.items,pageInfo:pageInfo(parsed.data.page,parsed.data.pageSize,result.total)})})
  app.get(PDF_TEXT_EXTRACTION_SEGMENTS_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireSession(auth,request,reply);if(session===undefined)return;const params=pdfTextExtractionParamsSchema.safeParse(request.params),parsed=pdfTextSegmentsQuerySchema.safeParse(query(request.query as Record<string,unknown>));if(!params.success||!parsed.success){const zod=(!params.success?params.error:!parsed.success?parsed.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(zod,requestId)}))}const result=await store.segments(session.user.organizationId,params.data.caseId,params.data.extractionId,parsed.data);if(result===undefined)return reply.code(404).send(failureBody('not_found','Text extraction not found.',requestId));return pdfTextSegmentsResponseSchema.parse({items:result.items,pageInfo:pageInfo(parsed.data.page,parsed.data.pageSize,result.total)})})
  app.post(PDF_TEXT_EXTRACTION_CANCEL_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=pdfTextExtractionParamsSchema.safeParse(request.params),body=pdfTextExtractionCancelRequestSchema.safeParse(request.body);if(!params.success||!body.success){const zod=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(zod,requestId)}))}const idempotencyKey=key(request);if(idempotencyKey===undefined)return keyRequired(reply,requestId);try{const result=await store.cancel({organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},params.data.caseId,params.data.extractionId,body.data.expectedVersion,{scope:PDF_TEXT_EXTRACTION_CANCEL_SCOPE,key:idempotencyKey,requestHash:hashRequestBody({params:params.data,body:body.data})});return reply.code(result.status).send(pdfTextExtractionResponseSchema.parse(result.body))}catch(value){if(value instanceof TextExtractionStoreError)return error(reply,requestId,value);throw value}})
  app.post(PDF_TEXT_EXTRACTION_SOURCE_REFERENCE_ROUTE,async(request,reply)=>{const requestId=String(request.id),session=await requireAnyRole(auth,request,reply,WRITE_ROLES);if(session===undefined)return;const params=pdfTextExtractionParamsSchema.safeParse(request.params),body=pdfTextSourceReferenceRequestSchema.safeParse(request.body);if(!params.success||!body.success){const zod=(!params.success?params.error:!body.success?body.error:undefined)!;return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(zod,requestId)}))}const idempotencyKey=key(request);if(idempotencyKey===undefined)return keyRequired(reply,requestId);try{const result=await store.sourceReference({organizationId:session.user.organizationId,actorUserId:session.user.id,requestId},params.data.caseId,params.data.extractionId,body.data,{scope:PDF_TEXT_SOURCE_REFERENCE_SCOPE,key:idempotencyKey,requestHash:hashRequestBody({params:params.data,body:body.data})});return reply.code(result.status).send(pdfTextSourceReferenceResponseSchema.parse(result.body))}catch(value){if(value instanceof TextExtractionStoreError)return error(reply,requestId,value);throw value}})
}
