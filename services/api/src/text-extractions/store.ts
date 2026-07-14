import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import {
  MAX_PDF_PAGE_COUNT,
  MAX_PDF_PAGE_TEXT_LENGTH,
  MAX_PDF_SOURCE_BYTES,
  MAX_PDF_TOTAL_TEXT_LENGTH,
  PDF_TEXT_NORMALIZATION_VERSION,
  PDF_TEXT_OFFSET_UNIT,
  PDF_TEXT_PARSER_NAME,
  PDF_TEXT_PARSER_VERSION,
  buildPdfExtractionOutputHash,
  normalizeExtractedPageText,
  sanitizeExtractedPageText,
  segmentNormalizedPdfText,
  sha256Text,
  sliceByCodePoint,
} from '@hasarbotu/domain'
import {
  pdfTextExtractionSchema,
  pdfTextPageSchema,
  pdfTextSegmentSchema,
  type PdfExtractionChunkRequest,
  type PdfExtractionResultSummary,
  type PdfTextExtraction,
  type PdfTextListQuery,
  type PdfTextPage,
  type PdfTextSegment,
  type PdfTextSegmentsQuery,
  type PdfTextSourceReferenceRequest,
} from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction } from '../db/executor.js'

export type TextExtractionStoreErrorCode = 'not_found'|'invalid_source'|'version_conflict'|'state_conflict'|'idempotency_conflict'|'invalid_chunk'|'lease_conflict'
export class TextExtractionStoreError extends Error { constructor(readonly code: TextExtractionStoreErrorCode) { super(code) } }
interface Actor { readonly organizationId:string;readonly actorUserId:string;readonly requestId:string }
interface Idem { readonly scope:string;readonly key:string;readonly requestHash:string }
interface CommandResult<T>{readonly status:number;readonly body:T;readonly replay:boolean}
interface TextExtractionStore {
  create(actor:Actor,params:{caseId:string;documentId:string;documentVersionId:string},idem:Idem):Promise<CommandResult<unknown>>
  list(organizationId:string,params:{caseId:string;documentId:string;documentVersionId:string}):Promise<readonly unknown[]|undefined>
  get(organizationId:string,caseId:string,extractionId:string):Promise<unknown|undefined>
  pages(organizationId:string,caseId:string,extractionId:string,query:PdfTextListQuery):Promise<{readonly items:readonly unknown[];readonly total:number}|undefined>
  segments(organizationId:string,caseId:string,extractionId:string,query:PdfTextSegmentsQuery):Promise<{readonly items:readonly unknown[];readonly total:number}|undefined>
  cancel(actor:Actor,caseId:string,extractionId:string,expectedVersion:number,idem:Idem):Promise<CommandResult<unknown>>
  sourceReference(actor:Actor,caseId:string,extractionId:string,input:PdfTextSourceReferenceRequest,idem:Idem):Promise<CommandResult<unknown>>
}

interface ExtractionRow extends Record<string, unknown> {
  id:string;case_id:string;document_id:string;document_version_id:string;extraction_version:number;status:PdfTextExtraction['status'];
  parser_name:'pdfjs-dist';parser_version:'6.1.200';normalization_version:'pdf-text-normalization/1.0.0';offset_unit:'unicode_code_point';
  source_hash:string;source_size:string;page_count:number;text_page_count:number;image_only_page_count:number;empty_page_count:number;
  failed_page_count:number;segment_count:number;raw_character_count:number;normalized_character_count:number;output_hash:string|null;
  failure_code:string|null;active_job_id:string|null;version:number;created_at:Date;started_at:Date|null;completed_at:Date|null;last_chunk_sequence:number;
}

function extraction(row:ExtractionRow):PdfTextExtraction{return pdfTextExtractionSchema.parse({
  id:row.id,caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,
  extractionVersion:row.extraction_version,status:row.status,parserName:row.parser_name,parserVersion:row.parser_version,
  normalizationVersion:row.normalization_version,offsetUnit:row.offset_unit,sourceHash:row.source_hash,sourceSize:Number(row.source_size),
  pageCount:row.page_count,textPageCount:row.text_page_count,imageOnlyPageCount:row.image_only_page_count,emptyPageCount:row.empty_page_count,
  failedPageCount:row.failed_page_count,segmentCount:row.segment_count,rawCharacterCount:row.raw_character_count,
  normalizedCharacterCount:row.normalized_character_count,outputHash:row.output_hash,failureCode:row.failure_code,activeJobId:row.active_job_id,
  version:row.version,createdAt:row.created_at.toISOString(),startedAt:row.started_at?.toISOString()??null,completedAt:row.completed_at?.toISOString()??null,
})}

function page(row:Record<string,unknown>):PdfTextPage{return pdfTextPageSchema.parse({id:row.id,extractionId:row.extraction_id,pageNumber:row.page_number,status:row.status,rawText:row.raw_text,normalizedText:row.normalized_text,rawTextHash:row.raw_text_hash,normalizedTextHash:row.normalized_text_hash,rawCharacterCount:row.raw_character_count,normalizedCharacterCount:row.normalized_character_count,segmentCount:row.segment_count})}
function segment(row:Record<string,unknown>):PdfTextSegment{return pdfTextSegmentSchema.parse({id:row.id,extractionId:row.extraction_id,pageId:row.page_id,pageNumber:row.page_number,segmentIndex:row.segment_index,type:row.segment_type,startOffset:row.start_offset,endOffset:row.end_offset,text:row.segment_text,textHash:row.text_hash})}

async function idempotent<T>(pool:pg.Pool,actor:Actor,caseId:string,idem:Idem,status:number,work:(client:pg.PoolClient)=>Promise<T>):Promise<CommandResult<T>>{
  const old=await findIdempotent(pool,actor.organizationId,idem.scope,idem.key);if(old!==undefined){if(old.requestHash!==idem.requestHash)throw new TextExtractionStoreError('idempotency_conflict');return{status:old.responseStatus,body:old.responseBody as T,replay:true}}
  return withTransaction(pool,async client=>{const raced=await findIdempotent(client,actor.organizationId,idem.scope,idem.key);if(raced!==undefined){if(raced.requestHash!==idem.requestHash)throw new TextExtractionStoreError('idempotency_conflict');return{status:raced.responseStatus,body:raced.responseBody as T,replay:true}}
    const body=await work(client);await insertIdempotent(client,{organizationId:actor.organizationId,scope:idem.scope,key:idem.key,requestHash:idem.requestHash,responseStatus:status,responseBody:body,caseId});return{status,body,replay:false}})
}

export function createTextExtractionStore(pool:pg.Pool):TextExtractionStore{const audit=createAuditService();return{
  async create(actor:Actor,params:{caseId:string;documentId:string;documentVersionId:string},idem:Idem){return idempotent(pool,actor,params.caseId,idem,201,async client=>{
    const source=await client.query(`SELECT c.case_type,d.document_type,dv.mime_type,dv.extension,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at,dv.content_hash,dv.byte_size,dv.storage_root_key,dv.relative_path
      FROM cases c JOIN documents d ON d.organization_id=c.organization_id AND d.case_id=c.id JOIN document_versions dv ON dv.document_id=d.id AND dv.organization_id=d.organization_id AND dv.case_id=d.case_id
      WHERE c.organization_id=$1 AND c.id=$2 AND d.id=$3 AND dv.id=$4 FOR UPDATE`,[actor.organizationId,params.caseId,params.documentId,params.documentVersionId])
    const s=source.rows[0] as {case_type:string;document_type:string;mime_type:string;extension:string|null;status:string;hash_verified:boolean;size_verified:boolean;verified_at:Date|null;content_hash:string;byte_size:string;storage_root_key:string;relative_path:string}|undefined
    if(s===undefined)throw new TextExtractionStoreError('not_found')
    if(s.case_type!=='casco'||s.document_type!=='casco_policy'||s.mime_type!=='application/pdf'||s.extension!=='pdf'||s.status!=='ready'||!s.hash_verified||!s.size_verified||s.verified_at===null||Number(s.byte_size)>MAX_PDF_SOURCE_BYTES)throw new TextExtractionStoreError('invalid_source')
    const prior=await client.query(`SELECT * FROM document_text_extractions WHERE organization_id=$1 AND document_version_id=$2 AND parser_name=$3 AND parser_version=$4 AND normalization_version=$5`,[actor.organizationId,params.documentVersionId,PDF_TEXT_PARSER_NAME,PDF_TEXT_PARSER_VERSION,PDF_TEXT_NORMALIZATION_VERSION])
    if(prior.rows[0]!==undefined)return{extraction:extraction(prior.rows[0] as ExtractionRow)}
    const next=await client.query('SELECT coalesce(max(extraction_version),0)::int+1 AS n FROM document_text_extractions WHERE document_version_id=$1',[params.documentVersionId]);const extractionVersion=(next.rows[0] as{n:number}).n
    const extractionId=uuidv7(),jobId=uuidv7()
    await client.query(`INSERT INTO document_text_extractions
      (id,organization_id,case_id,document_id,document_version_id,extraction_version,status,parser_name,parser_version,normalization_version,offset_unit,source_hash,source_size,created_by_user_id,request_id)
      VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10,$11,$12,$13,$14)`,[extractionId,actor.organizationId,params.caseId,params.documentId,params.documentVersionId,extractionVersion,PDF_TEXT_PARSER_NAME,PDF_TEXT_PARSER_VERSION,PDF_TEXT_NORMALIZATION_VERSION,PDF_TEXT_OFFSET_UNIT,s.content_hash,s.byte_size,actor.actorUserId,actor.requestId])
    const payload={kind:'pdf_text_extraction',extractionId,extractionVersion:1,storageRootKey:s.storage_root_key,relativePath:s.relative_path,declaredHash:s.content_hash,declaredSize:Number(s.byte_size),parserVersion:PDF_TEXT_PARSER_VERSION,normalizationVersion:PDF_TEXT_NORMALIZATION_VERSION,maxSourceBytes:MAX_PDF_SOURCE_BYTES,maxPages:MAX_PDF_PAGE_COUNT,maxPageCharacters:MAX_PDF_PAGE_TEXT_LENGTH,maxTotalCharacters:MAX_PDF_TOTAL_TEXT_LENGTH,timeoutMs:30_000,workerMemoryMb:192}
    await client.query(`INSERT INTO jobs(id,organization_id,type,target_type,target_id,target_version,payload,max_attempts)VALUES($1,$2,'extract_pdf_text','document_text_extraction',$3,1,$4::jsonb,3)`,[jobId,actor.organizationId,extractionId,JSON.stringify(payload)])
    const updated=await client.query('UPDATE document_text_extractions SET active_job_id=$2 WHERE id=$1 RETURNING *',[extractionId,jobId])
    await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_text.extraction_queued',entityType:'document_text_extraction',entityId:extractionId,details:{caseId:params.caseId,documentId:params.documentId,documentVersionId:params.documentVersionId,extractionVersion,parserName:PDF_TEXT_PARSER_NAME,parserVersion:PDF_TEXT_PARSER_VERSION,normalizationVersion:PDF_TEXT_NORMALIZATION_VERSION,jobId}})
    return{extraction:extraction(updated.rows[0] as ExtractionRow)}
  })},
  async list(organizationId:string,params:{caseId:string;documentId:string;documentVersionId:string}){const exists=await pool.query('SELECT 1 FROM document_versions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND id=$4',[organizationId,params.caseId,params.documentId,params.documentVersionId]);if((exists.rowCount??0)===0)return undefined;const rows=await pool.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND document_version_id=$4 ORDER BY extraction_version DESC',[organizationId,params.caseId,params.documentId,params.documentVersionId]);return rows.rows.map(row=>extraction(row as ExtractionRow))},
  async get(organizationId:string,caseId:string,extractionId:string){const row=await pool.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND case_id=$2 AND id=$3',[organizationId,caseId,extractionId]);return row.rows[0]===undefined?undefined:extraction(row.rows[0] as ExtractionRow)},
  async pages(organizationId:string,caseId:string,extractionId:string,query:PdfTextListQuery){const exists=await pool.query('SELECT 1 FROM document_text_extractions WHERE organization_id=$1 AND case_id=$2 AND id=$3',[organizationId,caseId,extractionId]);if((exists.rowCount??0)===0)return undefined;const count=await pool.query('SELECT count(*)::int n FROM document_text_extraction_pages WHERE extraction_id=$1',[extractionId]);const rows=await pool.query('SELECT * FROM document_text_extraction_pages WHERE extraction_id=$1 ORDER BY page_number OFFSET $2 LIMIT $3',[extractionId,(query.page-1)*query.pageSize,query.pageSize]);return{items:rows.rows.map(page),total:(count.rows[0] as{n:number}).n}},
  async segments(organizationId:string,caseId:string,extractionId:string,query:PdfTextSegmentsQuery){const exists=await pool.query('SELECT 1 FROM document_text_extractions WHERE organization_id=$1 AND case_id=$2 AND id=$3',[organizationId,caseId,extractionId]);if((exists.rowCount??0)===0)return undefined;const values:unknown[]=[extractionId];let filter='extraction_id=$1';if(query.pageNumber!==undefined){values.push(query.pageNumber);filter+=' AND page_number=$2'}const count=await pool.query(`SELECT count(*)::int n FROM document_text_extraction_segments WHERE ${filter}`,values);values.push((query.page-1)*query.pageSize,query.pageSize);const offsetIndex=values.length-1,limitIndex=values.length;const rows=await pool.query(`SELECT * FROM document_text_extraction_segments WHERE ${filter} ORDER BY page_number,segment_index OFFSET $${offsetIndex} LIMIT $${limitIndex}`,values);return{items:rows.rows.map(segment),total:(count.rows[0] as{n:number}).n}},
  async cancel(actor:Actor,caseId:string,extractionId:string,expectedVersion:number,idem:Idem){return idempotent(pool,actor,caseId,idem,200,async client=>{const selected=await client.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',[actor.organizationId,caseId,extractionId]);const row=selected.rows[0] as ExtractionRow|undefined;if(row===undefined)throw new TextExtractionStoreError('not_found');if(row.version!==expectedVersion)throw new TextExtractionStoreError('version_conflict');if(row.status!=='queued')throw new TextExtractionStoreError('state_conflict');await client.query("UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND status='pending'",[row.active_job_id]);const changed=await client.query("UPDATE document_text_extractions SET status='cancelled',completed_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[extractionId]);await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_text.extraction_cancelled',entityType:'document_text_extraction',entityId:extractionId,details:{caseId,documentId:row.document_id,documentVersionId:row.document_version_id,jobId:row.active_job_id}});return{extraction:extraction(changed.rows[0] as ExtractionRow)}})},
  async sourceReference(actor:Actor,caseId:string,extractionId:string,input:PdfTextSourceReferenceRequest,idem:Idem){return idempotent(pool,actor,caseId,idem,200,async client=>{const selected=await client.query(`SELECT e.document_id,e.document_version_id,e.status,p.id page_id,p.page_number,p.status page_status,p.normalized_text
      FROM document_text_extractions e JOIN document_text_extraction_pages p ON p.extraction_id=e.id WHERE e.organization_id=$1 AND e.case_id=$2 AND e.id=$3 AND p.id=$4`,[actor.organizationId,caseId,extractionId,input.pageId]);const row=selected.rows[0] as{document_id:string;document_version_id:string;status:string;page_id:string;page_number:number;page_status:string;normalized_text:string}|undefined;if(row===undefined)throw new TextExtractionStoreError('not_found');if(!['ready','partial'].includes(row.status)||row.page_status!=='text')throw new TextExtractionStoreError('state_conflict');const length=Array.from(row.normalized_text).length;if(input.endOffset>length)throw new TextExtractionStoreError('invalid_source');if(input.segmentId!==null){const segmentResult=await client.query('SELECT start_offset,end_offset FROM document_text_extraction_segments WHERE organization_id=$1 AND case_id=$2 AND extraction_id=$3 AND page_id=$4 AND id=$5',[actor.organizationId,caseId,extractionId,input.pageId,input.segmentId]);const s=segmentResult.rows[0] as{start_offset:number;end_offset:number}|undefined;if(s===undefined||s.start_offset>input.startOffset||s.end_offset<input.endOffset)throw new TextExtractionStoreError('invalid_source')}
    const rawExcerpt=sliceByCodePoint(row.normalized_text,input.startOffset,input.endOffset);if(rawExcerpt.trim().length===0)throw new TextExtractionStoreError('invalid_source');const sourceReference={sourceKey:input.sourceKey,documentId:row.document_id,documentVersionId:row.document_version_id,pageNumber:row.page_number,sectionHeading:input.sectionHeading,clauseIdentifier:input.clauseIdentifier,rawExcerpt,locator:`pdftext:v1:${extractionId}:${row.page_number}:${input.startOffset}:${input.endOffset}`,sourceType:input.sourceType,confidence:input.confidence,extractionLocator:{extractionId,pageId:input.pageId,segmentId:input.segmentId,startOffset:input.startOffset,endOffset:input.endOffset}}
    await audit.record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_text.source_reference_created',entityType:'document_text_extraction',entityId:extractionId,details:{caseId,documentId:row.document_id,documentVersionId:row.document_version_id,pageNumber:row.page_number,pageId:input.pageId,segmentId:input.segmentId,startOffset:input.startOffset,endOffset:input.endOffset,excerptHash:sha256Text(rawExcerpt)}});return{sourceReference}})},
}}

function assertPageChunk(pageInput:PdfExtractionChunkRequest['pages'][number]):ReturnType<typeof segmentNormalizedPdfText>{
  const raw=sanitizeExtractedPageText(pageInput.rawText);const normalized=normalizeExtractedPageText(raw)
  if(raw!==pageInput.rawText||normalized!==pageInput.normalizedText||sha256Text(raw)!==pageInput.rawTextHash||sha256Text(normalized)!==pageInput.normalizedTextHash)throw new TextExtractionStoreError('invalid_chunk')
  const expected=pageInput.status==='text'?segmentNormalizedPdfText(normalized):[]
  if((pageInput.status==='text')!==(normalized.length>0)||(['image_only','empty','failed','skipped'].includes(pageInput.status)&&normalized.length!==0)||expected.length!==pageInput.segments.length)throw new TextExtractionStoreError('invalid_chunk')
  for(let index=0;index<expected.length;index+=1){const left=expected[index]!,right=pageInput.segments[index]!;if(left.segmentIndex!==right.segmentIndex||left.type!==right.type||left.startOffset!==right.startOffset||left.endOffset!==right.endOffset||left.textHash!==right.textHash)throw new TextExtractionStoreError('invalid_chunk')}
  return expected
}

export async function acceptPdfExtractionChunk(pool:pg.Pool,agent:{id:string;organizationId:string},jobId:string,input:PdfExtractionChunkRequest):Promise<{acceptedPageCount:number}>{return withTransaction(pool,async client=>{
  const job=await client.query(`SELECT target_id,target_version,status,leased_by_agent_id,lease_expires_at FROM jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[jobId,agent.organizationId]);const j=job.rows[0] as{target_id:string;target_version:number;status:string;leased_by_agent_id:string|null;lease_expires_at:Date|null}|undefined
  if(j===undefined)throw new TextExtractionStoreError('not_found');if(j.status!=='leased'||j.leased_by_agent_id!==agent.id||j.lease_expires_at===null||j.lease_expires_at.getTime()<Date.now())throw new TextExtractionStoreError('lease_conflict');if(j.target_id!==input.extractionId||j.target_version!==input.extractionVersion)throw new TextExtractionStoreError('version_conflict')
  const selected=await client.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND id=$2 FOR UPDATE',[agent.organizationId,input.extractionId]);const row=selected.rows[0] as ExtractionRow|undefined;if(row===undefined)throw new TextExtractionStoreError('not_found');if(row.status!=='processing'||row.version!==input.extractionVersion||row.active_job_id!==jobId)throw new TextExtractionStoreError('version_conflict')
  const expectedPages=input.pages.map(item=>({input:item,segments:assertPageChunk(item)}))
  if(input.sequence<=row.last_chunk_sequence){for(const item of expectedPages){const old=await client.query('SELECT status,raw_text_hash,normalized_text_hash,segment_count FROM document_text_extraction_pages WHERE extraction_id=$1 AND page_number=$2',[input.extractionId,item.input.pageNumber]);const p=old.rows[0] as{status:string;raw_text_hash:string;normalized_text_hash:string;segment_count:number}|undefined;if(p===undefined||p.status!==item.input.status||p.raw_text_hash!==item.input.rawTextHash||p.normalized_text_hash!==item.input.normalizedTextHash||p.segment_count!==item.segments.length)throw new TextExtractionStoreError('invalid_chunk')}return{acceptedPageCount:input.pages.length}}
  if(input.sequence!==row.last_chunk_sequence+1)throw new TextExtractionStoreError('invalid_chunk')
  for(const item of expectedPages){const pageId=uuidv7();await client.query(`INSERT INTO document_text_extraction_pages(id,organization_id,case_id,extraction_id,page_number,status,raw_text,normalized_text,raw_text_hash,normalized_text_hash,raw_character_count,normalized_character_count,segment_count)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[pageId,agent.organizationId,row.case_id,row.id,item.input.pageNumber,item.input.status,item.input.rawText,item.input.normalizedText,item.input.rawTextHash,item.input.normalizedTextHash,Array.from(item.input.rawText).length,Array.from(item.input.normalizedText).length,item.segments.length]);for(const s of item.segments)await client.query(`INSERT INTO document_text_extraction_segments(id,organization_id,case_id,extraction_id,page_id,page_number,segment_index,segment_type,start_offset,end_offset,segment_text,text_hash)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[uuidv7(),agent.organizationId,row.case_id,row.id,pageId,item.input.pageNumber,s.segmentIndex,s.type,s.startOffset,s.endOffset,s.text,s.textHash])}
  await client.query('UPDATE document_text_extractions SET last_chunk_sequence=$2,updated_at=now() WHERE id=$1',[row.id,input.sequence]);return{acceptedPageCount:input.pages.length}
})}

export interface AgentExtractionApplyResult{readonly metadataResult:string;readonly errorCode:string|null;readonly auditAction:string;readonly jobStatus:'succeeded'|'failed'}
export async function finalizePdfExtraction(client:pg.PoolClient,context:{organizationId:string;agentId:string;requestId:string},job:{id:string;target_id:string;target_version:number},result:PdfExtractionResultSummary|undefined):Promise<AgentExtractionApplyResult>{
  const audit=createAuditService();const selected=await client.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND id=$2 FOR UPDATE',[context.organizationId,job.target_id]);const row=selected.rows[0] as ExtractionRow|undefined
  if(row===undefined)return{metadataResult:'missing',errorCode:'extraction_missing',auditAction:'job.verification_failed',jobStatus:'failed'}
  if(['ready','partial','ocr_required'].includes(row.status))return{metadataResult:row.status,errorCode:null,auditAction:'job.verified',jobStatus:'succeeded'}
  if(row.status!=='processing'||row.version!==job.target_version||row.active_job_id!==job.id||result===undefined||result.extractionId!==row.id||result.extractionVersion!==row.version||result.parserVersion!==row.parser_version||result.normalizationVersion!==row.normalization_version||result.sourceHash!==row.source_hash||result.sourceSize!==Number(row.source_size))return{metadataResult:'stale',errorCode:'extraction_result_mismatch',auditAction:'job.verification_failed',jobStatus:'failed'}
  const pages=await client.query('SELECT page_number,status,raw_text_hash,normalized_text_hash,segment_count,raw_character_count,normalized_character_count FROM document_text_extraction_pages WHERE extraction_id=$1 ORDER BY page_number',[row.id]);const items=pages.rows as Array<{page_number:number;status:string;raw_text_hash:string;normalized_text_hash:string;segment_count:number;raw_character_count:number;normalized_character_count:number}>
  const pageNumbers=items.map(item=>item.page_number);const consecutive=pageNumbers.length===result.pageCount&&pageNumbers.every((value,index)=>value===index+1)
  const count=(status:string)=>items.filter(item=>item.status===status).length;const segmentCount=items.reduce((sum,item)=>sum+item.segment_count,0);const rawCount=items.reduce((sum,item)=>sum+item.raw_character_count,0);const normalizedCount=items.reduce((sum,item)=>sum+item.normalized_character_count,0);const outputHash=buildPdfExtractionOutputHash(items.map(item=>({pageNumber:item.page_number,status:item.status as never,rawTextHash:item.raw_text_hash,normalizedTextHash:item.normalized_text_hash,segmentCount:item.segment_count})))
  if(!consecutive||count('text')!==result.textPageCount||count('image_only')!==result.imageOnlyPageCount||count('empty')!==result.emptyPageCount||count('failed')!==result.failedPageCount||segmentCount!==result.segmentCount||rawCount!==result.rawCharacterCount||normalizedCount!==result.normalizedCharacterCount||outputHash!==result.outputHash)return{metadataResult:'failed',errorCode:'extraction_summary_mismatch',auditAction:'job.verification_failed',jobStatus:'failed'}
  await client.query(`UPDATE document_text_extractions SET status=$2,page_count=$3,text_page_count=$4,image_only_page_count=$5,empty_page_count=$6,failed_page_count=$7,segment_count=$8,raw_character_count=$9,normalized_character_count=$10,output_hash=$11,failure_code=NULL,completed_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[row.id,result.status,result.pageCount,result.textPageCount,result.imageOnlyPageCount,result.emptyPageCount,result.failedPageCount,result.segmentCount,result.rawCharacterCount,result.normalizedCharacterCount,result.outputHash])
  await audit.record(client,{organizationId:context.organizationId,requestId:context.requestId,action:result.status==='ocr_required'?'document_text.ocr_required':result.status==='partial'?'document_text.extraction_partial':'document_text.extraction_completed',entityType:'document_text_extraction',entityId:row.id,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,jobId:job.id,agentId:context.agentId,status:result.status,parserVersion:result.parserVersion,normalizationVersion:result.normalizationVersion,pageCount:result.pageCount,textPageCount:result.textPageCount,imageOnlyPageCount:result.imageOnlyPageCount,failedPageCount:result.failedPageCount,segmentCount:result.segmentCount,outputHash:result.outputHash}})
  return{metadataResult:result.status,errorCode:null,auditAction:'job.verified',jobStatus:'succeeded'}
}

export async function markPdfExtractionStarted(client:pg.PoolClient,organizationId:string,extractionId:string,jobId:string,agentId:string):Promise<void>{const changed=await client.query("UPDATE document_text_extractions SET status='processing',started_at=coalesce(started_at,now()),failure_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND active_job_id=$3 AND status IN ('queued','processing') RETURNING case_id,document_id,document_version_id",[organizationId,extractionId,jobId]);const row=changed.rows[0] as{case_id:string;document_id:string;document_version_id:string}|undefined;if(row!==undefined)await createAuditService().record(client,{organizationId,action:'document_text.extraction_started',entityType:'document_text_extraction',entityId:extractionId,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,jobId,agentId}})}

export async function markPdfExtractionFailure(client:pg.PoolClient,context:{organizationId:string;agentId:string;requestId:string},job:{id:string;target_id:string;attempt_count:number;max_attempts:number},errorCode:string,terminal:boolean):Promise<void>{const selected=await client.query('SELECT * FROM document_text_extractions WHERE organization_id=$1 AND id=$2 FOR UPDATE',[context.organizationId,job.target_id]);const row=selected.rows[0] as ExtractionRow|undefined;if(row===undefined||['ready','partial','ocr_required','failed','cancelled','stale'].includes(row.status))return;if(terminal||job.attempt_count>=job.max_attempts){await client.query("UPDATE document_text_extractions SET status='failed',failure_code=$2,completed_at=now(),version=version+1,updated_at=now() WHERE id=$1",[row.id,errorCode]);await createAuditService().record(client,{organizationId:context.organizationId,requestId:context.requestId,action:'document_text.extraction_failed',entityType:'document_text_extraction',entityId:row.id,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,jobId:job.id,agentId:context.agentId,errorCode,attempt:job.attempt_count}})}else await client.query("UPDATE document_text_extractions SET status='queued',failure_code=$2,updated_at=now() WHERE id=$1",[row.id,errorCode])}
