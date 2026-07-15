import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import {
  MAX_POLICY_OCR_ELEMENTS_PER_PAGE,
  MAX_POLICY_OCR_IMAGE_PIXELS,
  MAX_POLICY_OCR_RAW_TEXT_LENGTH,
  MAX_POLICY_OCR_SOURCE_BYTES,
  MAX_POLICY_OCR_TOTAL_CHARACTERS,
  POLICY_OCR_ENGINE_NAME,
  POLICY_OCR_ENGINE_VERSION,
  POLICY_OCR_LANGUAGE_DATA_VERSION,
  POLICY_OCR_LOCATOR_VERSION,
  POLICY_OCR_NORMALIZATION_VERSION,
  POLICY_OCR_OFFSET_UNIT,
  POLICY_OCR_PREPROCESSING_VERSION,
  POLICY_OCR_QUALITY_VERSION,
  POLICY_OCR_RENDER_DPI,
  POLICY_OCR_RENDER_PROFILE_VERSIONS,
  buildPolicyOcrOutputHash,
  derivePolicyOcrCompositeStatus,
  derivePolicyOcrRunStatus,
  policyOcrLanguageDataHash,
  sha256Text,
  sliceByCodePoint,
  type PolicyOcrLanguageMode,
} from '@hasarbotu/domain'
import {
  policyOcrElementSchema,
  policyOcrPageSchema,
  policyOcrRunSchema,
  type PolicyOcrChunkRequest,
  type PolicyOcrElementsQuery,
  type PolicyOcrListQuery,
  type PolicyOcrPage,
  type PolicyOcrPageChunk,
  type PolicyOcrResultSummary,
  type PolicyOcrRun,
  type PolicyOcrRunCreateRequest,
  type PolicyOcrSourceReferenceRequest,
} from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction } from '../db/executor.js'

export type PolicyOcrStoreErrorCode =
  | 'not_found' | 'invalid_source' | 'version_conflict' | 'state_conflict'
  | 'idempotency_conflict' | 'invalid_chunk' | 'lease_conflict'

export class PolicyOcrStoreError extends Error {
  constructor(readonly code: PolicyOcrStoreErrorCode) { super(code) }
}

interface Actor { readonly organizationId:string; readonly actorUserId:string; readonly requestId:string }
interface AgentActor { readonly id:string; readonly organizationId:string }
interface Idem { readonly scope:string; readonly key:string; readonly requestHash:string }
interface CommandResult<T> { readonly status:number; readonly body:T; readonly replay:boolean }
interface RunRow extends Record<string, unknown> {
  id:string; case_id:string; document_id:string; document_version_id:string; text_extraction_id:string; ocr_version:number;
  status:PolicyOcrRun['status']; engine_name:'tesseract.js'; engine_version:'7.0.0'; language_data_version:'tessdata-4.0.0-full/1.0.0';
  language_data_hash:string; language_mode:PolicyOcrLanguageMode; render_profile:'standard'|'high_quality';
  render_profile_version:'policy-ocr-render-standard/1.0.0'|'policy-ocr-render-high-quality/1.0.0'; preprocessing_version:'policy-ocr-preprocessing/1.0.0';
  quality_version:'policy-ocr-quality/1.0.0'; normalization_version:'policy-ocr-normalization/1.0.0'; locator_version:'policy-ocr-locator/1.0.0'; offset_unit:'unicode_code_point'; source_hash:string; source_size:string;
  eligible_page_count:number; processed_page_count:number; ready_page_count:number; low_quality_page_count:number; empty_page_count:number;
  failed_page_count:number; block_count:number; line_count:number; word_count:number; normalized_character_count:number;
  mean_confidence:string|null; output_hash:string|null; failure_code:string|null; active_job_id:string|null; last_chunk_sequence:number;
  version:number; created_at:Date; started_at:Date|null; completed_at:Date|null; selected_page_numbers:number[];
}

const RUN_SELECT = 'SELECT * FROM document_ocr_runs'
function preprocessingConfig(renderProfile:'standard'|'high_quality') { return {
  renderDpi: POLICY_OCR_RENDER_DPI[renderProfile],
  grayscale: 'bt601_luminance',
  contrast: 'full_range',
  threshold: 'otsu',
  orientation: 'tesseract_rotate_auto',
  deskew: 'tesseract_rotate_auto',
} as const }

function run(row:RunRow):PolicyOcrRun{return policyOcrRunSchema.parse({
  id:row.id,caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,textExtractionId:row.text_extraction_id,
  ocrVersion:row.ocr_version,status:row.status,engineName:row.engine_name,engineVersion:row.engine_version,languageDataVersion:row.language_data_version,
  languageDataHash:row.language_data_hash,languageMode:row.language_mode,renderProfile:row.render_profile,renderProfileVersion:row.render_profile_version,preprocessingVersion:row.preprocessing_version,
  qualityVersion:row.quality_version,normalizationVersion:row.normalization_version,locatorVersion:row.locator_version,offsetUnit:row.offset_unit,sourceHash:row.source_hash,sourceSize:Number(row.source_size),
  eligiblePageCount:row.eligible_page_count,processedPageCount:row.processed_page_count,readyPageCount:row.ready_page_count,
  lowQualityPageCount:row.low_quality_page_count,emptyPageCount:row.empty_page_count,failedPageCount:row.failed_page_count,
  blockCount:row.block_count,lineCount:row.line_count,wordCount:row.word_count,normalizedCharacterCount:row.normalized_character_count,
  meanConfidence:row.mean_confidence===null?null:Number(row.mean_confidence),outputHash:row.output_hash,failureCode:row.failure_code,
  activeJobId:row.active_job_id,version:row.version,createdAt:row.created_at.toISOString(),startedAt:row.started_at?.toISOString()??null,
  completedAt:row.completed_at?.toISOString()??null,
})}

function page(row:Record<string,unknown>):PolicyOcrPage{return policyOcrPageSchema.parse({
  id:row.id,ocrRunId:row.ocr_run_id,textPageId:row.text_page_id,pageNumber:row.page_number,status:row.status,languageMode:row.language_mode,
  imageWidth:row.image_width,imageHeight:row.image_height,renderDpi:row.render_dpi,rotationDegrees:row.rotation_degrees,
  deskewDegrees:Number(row.deskew_degrees),threshold:row.threshold_value,rawOcrText:row.raw_ocr_text,rawTextHash:row.raw_text_hash,normalizedText:row.normalized_text,normalizedTextHash:row.normalized_text_hash,
  normalizedCharacterCount:row.normalized_character_count,meanConfidence:Number(row.mean_confidence),minimumConfidence:Number(row.minimum_confidence),
  qualityStatus:row.quality_status,readingOrderQuality:row.reading_order_quality,compositeStatus:row.composite_status,qualityReasonCode:row.quality_reason_code,requiresHumanReview:row.requires_human_review,
  blockCount:row.block_count,lineCount:row.line_count,wordCount:row.word_count,lowConfidenceWordCount:row.low_confidence_word_count,unreadableRegionCount:row.unreadable_region_count,processingDurationMs:row.processing_duration_ms,
})}

function element(row:Record<string,unknown>){return policyOcrElementSchema.parse({
  id:row.id,ocrRunId:row.ocr_run_id,pageId:row.page_id,pageNumber:row.page_number,type:row.element_type,parentId:row.parent_id,
  elementIndex:row.element_index,readingOrder:row.reading_order,startOffset:row.start_offset,endOffset:row.end_offset,text:row.element_text,
  textHash:row.text_hash,confidence:Number(row.confidence),bbox:{x:row.bbox_x,y:row.bbox_y,width:row.bbox_width,height:row.bbox_height},sourceLayer:'ocr',
})}

async function idempotent<T>(pool:pg.Pool,actor:Actor,caseId:string,idem:Idem,status:number,work:(client:pg.PoolClient)=>Promise<T>):Promise<CommandResult<T>>{
  const existing=await findIdempotent(pool,actor.organizationId,idem.scope,idem.key)
  if(existing!==undefined){if(existing.requestHash!==idem.requestHash)throw new PolicyOcrStoreError('idempotency_conflict');return{status:existing.responseStatus,body:existing.responseBody as T,replay:true}}
  return withTransaction(pool,async client=>{const raced=await findIdempotent(client,actor.organizationId,idem.scope,idem.key)
    if(raced!==undefined){if(raced.requestHash!==idem.requestHash)throw new PolicyOcrStoreError('idempotency_conflict');return{status:raced.responseStatus,body:raced.responseBody as T,replay:true}}
    const body=await work(client);await insertIdempotent(client,{organizationId:actor.organizationId,scope:idem.scope,key:idem.key,requestHash:idem.requestHash,responseStatus:status,responseBody:body,caseId});return{status,body,replay:false}
  })
}

interface Source {
  readonly caseType:string; readonly documentType:string; readonly status:string; readonly verifiedAt:Date|null; readonly hashVerified:boolean; readonly sizeVerified:boolean;
  readonly contentHash:string; readonly byteSize:string; readonly storageRootKey:string; readonly relativePath:string; readonly extractionStatus:string;
  readonly extractionDocumentVersionId:string; readonly pages:readonly {readonly id:string;readonly pageNumber:number;readonly status:string}[]
}

async function source(exec:pg.PoolClient,organizationId:string,params:{caseId:string;documentId:string;documentVersionId:string},extractionId:string):Promise<Source>{
  const selected=await exec.query(`SELECT c.case_type,d.document_type,dv.status,dv.verified_at,dv.hash_verified,dv.size_verified,dv.content_hash,dv.byte_size,dv.storage_root_key,dv.relative_path,e.status extraction_status,e.document_version_id extraction_document_version_id
    FROM cases c JOIN documents d ON d.organization_id=c.organization_id AND d.case_id=c.id JOIN document_versions dv ON dv.organization_id=d.organization_id AND dv.case_id=d.case_id AND dv.document_id=d.id
    JOIN document_text_extractions e ON e.organization_id=dv.organization_id AND e.case_id=dv.case_id AND e.document_version_id=dv.id
    WHERE c.organization_id=$1 AND c.id=$2 AND d.id=$3 AND dv.id=$4 AND e.id=$5 FOR UPDATE`,[organizationId,params.caseId,params.documentId,params.documentVersionId,extractionId])
  const row=selected.rows[0] as Record<string,unknown>|undefined;if(row===undefined)throw new PolicyOcrStoreError('not_found')
  const pages=await exec.query(`SELECT id,page_number,status FROM document_text_extraction_pages WHERE organization_id=$1 AND case_id=$2 AND extraction_id=$3 ORDER BY page_number`,[organizationId,params.caseId,extractionId])
  return{caseType:String(row.case_type),documentType:String(row.document_type),status:String(row.status),verifiedAt:row.verified_at as Date|null,hashVerified:Boolean(row.hash_verified),sizeVerified:Boolean(row.size_verified),contentHash:String(row.content_hash),byteSize:String(row.byte_size),storageRootKey:String(row.storage_root_key),relativePath:String(row.relative_path),extractionStatus:String(row.extraction_status),extractionDocumentVersionId:String(row.extraction_document_version_id),pages:(pages.rows as Array<{id:string;page_number:number;status:string}>).map(item=>({id:item.id,pageNumber:item.page_number,status:item.status}))}
}

function eligiblePages(value:Source,requested:readonly number[]|undefined){
  const candidates=value.pages.filter(item=>item.status==='image_only')
  const selected=requested===undefined?candidates:candidates.filter(item=>requested.includes(item.pageNumber))
  if(requested!==undefined&&selected.length!==requested.length)throw new PolicyOcrStoreError('invalid_source')
  return [...selected].sort((left,right)=>left.pageNumber-right.pageNumber)
}

async function insertRun(exec:pg.PoolClient,actor:Actor,params:{caseId:string;documentId:string;documentVersionId:string},input:PolicyOcrRunCreateRequest,sourceValue:Source,pages:readonly {readonly id:string;readonly pageNumber:number;readonly status:string}[]){
  const next=await exec.query('SELECT coalesce(max(ocr_version),0)::int+1 n FROM document_ocr_runs WHERE document_version_id=$1',[params.documentVersionId]);const ocrVersion=(next.rows[0] as{n:number}).n
  const runId=uuidv7(),jobId=uuidv7(),dataHash=policyOcrLanguageDataHash(input.languageMode),numbers=pages.map(item=>item.pageNumber)
  const renderProfileVersion=POLICY_OCR_RENDER_PROFILE_VERSIONS[input.renderProfile]
  await exec.query(`INSERT INTO document_ocr_runs(id,organization_id,case_id,document_id,document_version_id,text_extraction_id,ocr_version,status,engine_name,engine_version,language_data_version,language_data_hash,language_mode,render_profile,render_profile_version,preprocessing_version,preprocessing_config,quality_version,normalization_version,locator_version,offset_unit,source_hash,source_size,eligible_page_count,selected_page_numbers,created_by_user_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,[runId,actor.organizationId,params.caseId,params.documentId,params.documentVersionId,input.textExtractionId,ocrVersion,POLICY_OCR_ENGINE_NAME,POLICY_OCR_ENGINE_VERSION,POLICY_OCR_LANGUAGE_DATA_VERSION,dataHash,input.languageMode,input.renderProfile,renderProfileVersion,POLICY_OCR_PREPROCESSING_VERSION,JSON.stringify(preprocessingConfig(input.renderProfile)),POLICY_OCR_QUALITY_VERSION,POLICY_OCR_NORMALIZATION_VERSION,POLICY_OCR_LOCATOR_VERSION,POLICY_OCR_OFFSET_UNIT,sourceValue.contentHash,sourceValue.byteSize,pages.length,numbers,actor.actorUserId,actor.requestId])
  const payload={kind:'policy_ocr',ocrRunId:runId,ocrRunVersion:1,textExtractionId:input.textExtractionId,storageRootKey:sourceValue.storageRootKey,relativePath:sourceValue.relativePath,declaredHash:sourceValue.contentHash,declaredSize:Number(sourceValue.byteSize),languageMode:input.languageMode,languageDataVersion:POLICY_OCR_LANGUAGE_DATA_VERSION,languageDataHash:dataHash,engineVersion:POLICY_OCR_ENGINE_VERSION,renderProfile:input.renderProfile,renderProfileVersion,preprocessingVersion:POLICY_OCR_PREPROCESSING_VERSION,qualityVersion:POLICY_OCR_QUALITY_VERSION,normalizationVersion:POLICY_OCR_NORMALIZATION_VERSION,locatorVersion:POLICY_OCR_LOCATOR_VERSION,renderDpi:POLICY_OCR_RENDER_DPI[input.renderProfile],eligiblePages:pages.map(item=>({textPageId:item.id,pageNumber:item.pageNumber,sourcePageStatus:item.status as 'image_only'|'text'})),maxSourceBytes:MAX_POLICY_OCR_SOURCE_BYTES,maxImagePixels:MAX_POLICY_OCR_IMAGE_PIXELS,maxPageCharacters:MAX_POLICY_OCR_RAW_TEXT_LENGTH,maxTotalCharacters:MAX_POLICY_OCR_TOTAL_CHARACTERS,maxElementsPerPage:MAX_POLICY_OCR_ELEMENTS_PER_PAGE,timeoutMs:300_000,workerMemoryMb:512}
  await exec.query(`INSERT INTO jobs(id,organization_id,type,target_type,target_id,target_version,payload,max_attempts) VALUES($1,$2,'ocr_policy_pages','document_ocr_run',$3,1,$4::jsonb,3)`,[jobId,actor.organizationId,runId,JSON.stringify(payload)])
  const updated=await exec.query('UPDATE document_ocr_runs SET active_job_id=$2 WHERE id=$1 RETURNING *',[runId,jobId])
  await createAuditService().record(exec,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_page_ocr.requested',entityType:'document_ocr_run',entityId:runId,details:{caseId:params.caseId,documentId:params.documentId,documentVersionId:params.documentVersionId,textExtractionId:input.textExtractionId,jobId,ocrVersion,engineVersion:POLICY_OCR_ENGINE_VERSION,languageDataVersion:POLICY_OCR_LANGUAGE_DATA_VERSION,languageDataHash:dataHash,languageMode:input.languageMode,renderProfileVersion,preprocessingVersion:POLICY_OCR_PREPROCESSING_VERSION,qualityVersion:POLICY_OCR_QUALITY_VERSION,locatorVersion:POLICY_OCR_LOCATOR_VERSION,eligiblePageCount:pages.length}})
  return run(updated.rows[0] as RunRow)
}

export interface PolicyOcrStore {
  create(actor:Actor,params:{caseId:string;documentId:string;documentVersionId:string},input:PolicyOcrRunCreateRequest,idem:Idem):Promise<CommandResult<unknown>>
  list(organizationId:string,params:{caseId:string;documentId:string;documentVersionId:string}):Promise<readonly unknown[]|undefined>
  get(organizationId:string,caseId:string,ocrRunId:string):Promise<unknown|undefined>
  pages(organizationId:string,caseId:string,ocrRunId:string,query:PolicyOcrListQuery):Promise<{readonly items:readonly unknown[];readonly total:number}|undefined>
  elements(organizationId:string,caseId:string,ocrRunId:string,query:PolicyOcrElementsQuery):Promise<{readonly items:readonly unknown[];readonly total:number}|undefined>
  cancel(actor:Actor,caseId:string,ocrRunId:string,expectedVersion:number,idem:Idem):Promise<CommandResult<unknown>>
  retry(actor:Actor,caseId:string,ocrRunId:string,expectedVersion:number,idem:Idem):Promise<CommandResult<unknown>>
  sourceReference(actor:Actor,caseId:string,ocrRunId:string,input:PolicyOcrSourceReferenceRequest,idem:Idem):Promise<CommandResult<unknown>>
}

export function createPolicyOcrStore(pool:pg.Pool):PolicyOcrStore{return{
  async create(actor,params,input,idem){return idempotent(pool,actor,params.caseId,idem,201,async client=>{const s=await source(client,actor.organizationId,params,input.textExtractionId)
    if(s.caseType!=='casco'||s.documentType!=='casco_policy'||s.status!=='ready'||s.verifiedAt===null||!s.hashVerified||!s.sizeVerified||s.extractionDocumentVersionId!==params.documentVersionId||!['partial','ocr_required'].includes(s.extractionStatus)||Number(s.byteSize)>MAX_POLICY_OCR_SOURCE_BYTES)throw new PolicyOcrStoreError('invalid_source')
    const pages=eligiblePages(s,input.pageNumbers);if(pages.length===0)throw new PolicyOcrStoreError('invalid_source')
    const prior=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND document_version_id=$2 AND text_extraction_id=$3 AND language_mode=$4 AND render_profile=$5 AND selected_page_numbers=$6::integer[] ORDER BY ocr_version DESC LIMIT 1`,[actor.organizationId,params.documentVersionId,input.textExtractionId,input.languageMode,input.renderProfile,pages.map(item=>item.pageNumber)])
    if(prior.rows[0]!==undefined)return{ocrRun:run(prior.rows[0] as RunRow)}
    return{ocrRun:await insertRun(client,actor,params,input,s,pages)}
  })},
  async list(organizationId,params){const exists=await pool.query('SELECT 1 FROM document_versions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND id=$4',[organizationId,params.caseId,params.documentId,params.documentVersionId]);if((exists.rowCount??0)===0)return undefined;const rows=await pool.query(`${RUN_SELECT} WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND document_version_id=$4 ORDER BY ocr_version DESC`,[organizationId,params.caseId,params.documentId,params.documentVersionId]);return(rows.rows as RunRow[]).map(run)},
  async get(organizationId,caseId,ocrRunId){const selected=await pool.query(`${RUN_SELECT} WHERE organization_id=$1 AND case_id=$2 AND id=$3`,[organizationId,caseId,ocrRunId]);const row=selected.rows[0] as RunRow|undefined;return row===undefined?undefined:run(row)},
  async pages(organizationId,caseId,ocrRunId,query){const exists=await pool.query('SELECT 1 FROM document_ocr_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',[organizationId,caseId,ocrRunId]);if((exists.rowCount??0)===0)return undefined;const offset=(query.page-1)*query.pageSize;const selected=await pool.query('SELECT *,count(*) OVER() total_count FROM document_ocr_pages WHERE organization_id=$1 AND case_id=$2 AND ocr_run_id=$3 ORDER BY page_number LIMIT $4 OFFSET $5',[organizationId,caseId,ocrRunId,query.pageSize,offset]);return{items:selected.rows.map(page),total:Number((selected.rows[0] as{total_count?:string}|undefined)?.total_count??0)}},
  async elements(organizationId,caseId,ocrRunId,query){const exists=await pool.query('SELECT 1 FROM document_ocr_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',[organizationId,caseId,ocrRunId]);if((exists.rowCount??0)===0)return undefined;const values:unknown[]=[organizationId,caseId,ocrRunId],filters=['organization_id=$1','case_id=$2','ocr_run_id=$3'];if(query.pageNumber!==undefined){values.push(query.pageNumber);filters.push(`page_number=$${values.length}`)}
    const tables=query.type===undefined?['block','line','word']:[query.type];const unions=tables.map(type=>`SELECT id,ocr_run_id,page_id,page_number,'${type}' element_type,${type==='block'?'NULL::uuid':type==='line'?'block_id':'line_id'} parent_id,element_index,reading_order,start_offset,end_offset,element_text,text_hash,confidence,bbox_x,bbox_y,bbox_width,bbox_height FROM document_ocr_${type}s WHERE ${filters.join(' AND ')}`).join(' UNION ALL ')
    values.push(query.pageSize,(query.page-1)*query.pageSize);const selected=await pool.query(`SELECT *,count(*) OVER() total_count FROM (${unions}) e ORDER BY page_number,reading_order,element_type LIMIT $${values.length-1} OFFSET $${values.length}`,values);return{items:selected.rows.map(element),total:Number((selected.rows[0] as{total_count?:string}|undefined)?.total_count??0)}},
  async cancel(actor,caseId,ocrRunId,expectedVersion,idem){return idempotent(pool,actor,caseId,idem,200,async client=>{const selected=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,[actor.organizationId,caseId,ocrRunId]);const row=selected.rows[0] as RunRow|undefined;if(row===undefined)throw new PolicyOcrStoreError('not_found');if(row.version!==expectedVersion)throw new PolicyOcrStoreError('version_conflict');if(row.status!=='queued')throw new PolicyOcrStoreError('state_conflict');await client.query("UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND status='pending'",[row.active_job_id]);const changed=await client.query("UPDATE document_ocr_runs SET status='cancelled',completed_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[row.id]);await createAuditService().record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_page_ocr.cancelled',entityType:'document_ocr_run',entityId:row.id,details:{caseId,documentId:row.document_id,documentVersionId:row.document_version_id,ocrVersion:row.ocr_version}});return{ocrRun:run(changed.rows[0] as RunRow)}})},
  async retry(actor,caseId,ocrRunId,expectedVersion,idem){return idempotent(pool,actor,caseId,idem,201,async client=>{const selected=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,[actor.organizationId,caseId,ocrRunId]);const row=selected.rows[0] as RunRow|undefined;if(row===undefined)throw new PolicyOcrStoreError('not_found');if(row.version!==expectedVersion)throw new PolicyOcrStoreError('version_conflict');if(!['failed','partial','low_confidence','control_required'].includes(row.status)||row.render_profile!=='standard')throw new PolicyOcrStoreError('state_conflict');const params={caseId,documentId:row.document_id,documentVersionId:row.document_version_id};const s=await source(client,actor.organizationId,params,row.text_extraction_id);const pages=eligiblePages(s,row.selected_page_numbers);if(pages.length===0)throw new PolicyOcrStoreError('invalid_source');const prior=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND document_version_id=$2 AND text_extraction_id=$3 AND source_hash=$4 AND language_mode=$5 AND render_profile='high_quality' AND selected_page_numbers=$6::integer[] ORDER BY ocr_version DESC LIMIT 1`,[actor.organizationId,row.document_version_id,row.text_extraction_id,s.contentHash,row.language_mode,row.selected_page_numbers]);if(prior.rows[0]!==undefined)return{ocrRun:run(prior.rows[0] as RunRow)};const created=await insertRun(client,actor,params,{textExtractionId:row.text_extraction_id,languageMode:row.language_mode,renderProfile:'high_quality',pageNumbers:row.selected_page_numbers},s,pages);await createAuditService().record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_page_ocr.requested',entityType:'document_ocr_run',entityId:created.id,details:{caseId,previousOcrRunId:row.id,ocrVersion:created.ocrVersion,renderProfile:'high_quality',eligiblePageCount:created.eligiblePageCount,retry:true}});return{ocrRun:created}})},
  async sourceReference(actor,caseId,ocrRunId,input,idem){return idempotent(pool,actor,caseId,idem,201,async client=>{const selected=await client.query(`SELECT r.document_id,r.document_version_id,r.status run_status,r.engine_version,r.language_data_version,r.locator_version,p.*,b.start_offset block_start,b.end_offset block_end,b.bbox_x block_bbox_x,b.bbox_y block_bbox_y,b.bbox_width block_bbox_width,b.bbox_height block_bbox_height,l.block_id line_block_id,l.start_offset line_start,l.end_offset line_end,l.bbox_x line_bbox_x,l.bbox_y line_bbox_y,l.bbox_width line_bbox_width,l.bbox_height line_bbox_height,w.block_id word_block_id,w.line_id word_line_id,w.start_offset word_start,w.end_offset word_end,w.bbox_x word_bbox_x,w.bbox_y word_bbox_y,w.bbox_width word_bbox_width,w.bbox_height word_bbox_height
      FROM document_ocr_runs r JOIN document_ocr_pages p ON p.ocr_run_id=r.id LEFT JOIN document_ocr_blocks b ON b.id=$5 LEFT JOIN document_ocr_lines l ON l.id=$6 LEFT JOIN document_ocr_words w ON w.id=$7
      WHERE r.organization_id=$1 AND r.case_id=$2 AND r.id=$3 AND p.id=$4`,[actor.organizationId,caseId,ocrRunId,input.pageId,input.blockId,input.lineId,input.wordId]);const row=selected.rows[0] as Record<string,unknown>|undefined
    if(row===undefined||!['ready','partial','low_confidence','control_required'].includes(String(row.run_status))||!['accepted_candidate','partial','low_confidence','control_required'].includes(String(row.status)))throw new PolicyOcrStoreError('invalid_source');const text=String(row.normalized_text);if(input.endOffset>Array.from(text).length)throw new PolicyOcrStoreError('invalid_source')
    const within=(start:unknown,end:unknown)=>typeof start==='number'&&typeof end==='number'&&start<=input.startOffset&&end>=input.endOffset
    if(input.blockId!==null&&!within(row.block_start,row.block_end))throw new PolicyOcrStoreError('invalid_source');if(input.lineId!==null&&(row.line_block_id!==input.blockId||!within(row.line_start,row.line_end)))throw new PolicyOcrStoreError('invalid_source');if(input.wordId!==null&&(row.word_block_id!==input.blockId||row.word_line_id!==input.lineId||!within(row.word_start,row.word_end)))throw new PolicyOcrStoreError('invalid_source')
    const excerpt=sliceByCodePoint(text,input.startOffset,input.endOffset);if(excerpt.trim().length===0)throw new PolicyOcrStoreError('invalid_source');const confidence=Math.min(input.confidence,Number(row.mean_confidence)/100)
    const chosen=input.wordId!==null?{x:row.word_bbox_x,y:row.word_bbox_y,width:row.word_bbox_width,height:row.word_bbox_height}:input.lineId!==null?{x:row.line_bbox_x,y:row.line_bbox_y,width:row.line_bbox_width,height:row.line_bbox_height}:input.blockId!==null?{x:row.block_bbox_x,y:row.block_bbox_y,width:row.block_bbox_width,height:row.block_bbox_height}:{x:0,y:0,width:row.image_width,height:row.image_height};const bbox={x:Number(chosen.x),y:Number(chosen.y),width:Number(chosen.width),height:Number(chosen.height)}
    const sourceReference={sourceKey:input.sourceKey,documentId:String(row.document_id),documentVersionId:String(row.document_version_id),pageNumber:Number(row.page_number),sectionHeading:input.sectionHeading,clauseIdentifier:input.clauseIdentifier,rawExcerpt:excerpt,locator:`ocr:${ocrRunId}:page:${String(row.page_number)}`,sourceType:input.sourceType,confidence,extractionLocator:null,ocrLocator:{ocrRunId,pageId:input.pageId,blockId:input.blockId,lineId:input.lineId,wordId:input.wordId,startOffset:input.startOffset,endOffset:input.endOffset,engineVersion:row.engine_version,languageDataVersion:row.language_data_version,locatorVersion:row.locator_version,qualityStatus:row.quality_status,readingOrderQuality:row.reading_order_quality,bbox}}
    await createAuditService().record(client,{organizationId:actor.organizationId,actorUserId:actor.actorUserId,requestId:actor.requestId,action:'document_page_ocr_source_reference.created',entityType:'document_ocr_run',entityId:ocrRunId,details:{caseId,documentId:row.document_id,documentVersionId:row.document_version_id,pageNumber:row.page_number,qualityStatus:row.quality_status,readingOrderQuality:row.reading_order_quality,requiresHumanReview:row.requires_human_review,excerptHash:sha256Text(excerpt)}});return{sourceReference}
  })},
}}

function validateChunkPage(input:PolicyOcrPageChunk,runRow:RunRow):void{
  if(!runRow.selected_page_numbers.includes(input.pageNumber)||input.rawTextHash!==sha256Text(input.rawOcrText)||input.normalizedTextHash!==sha256Text(input.normalizedText)||Array.from(input.rawOcrText).length>MAX_POLICY_OCR_RAW_TEXT_LENGTH||Array.from(input.normalizedText).length>MAX_POLICY_OCR_RAW_TEXT_LENGTH||input.imageWidth*input.imageHeight>MAX_POLICY_OCR_IMAGE_PIXELS)throw new PolicyOcrStoreError('invalid_chunk')
  const elements=[...input.elements].sort((left,right)=>left.elementIndex-right.elementIndex)
  if(elements.some((item,index)=>item.elementIndex!==index||item.endOffset>Array.from(input.normalizedText).length||item.textHash!==sha256Text(sliceByCodePoint(input.normalizedText,item.startOffset,item.endOffset))||item.bbox.x+item.bbox.width>input.imageWidth||item.bbox.y+item.bbox.height>input.imageHeight))throw new PolicyOcrStoreError('invalid_chunk')
  const map=new Map(elements.map(item=>[item.elementIndex,item]));for(const item of elements){if(item.type==='block'&&item.parentIndex!==null)throw new PolicyOcrStoreError('invalid_chunk');if(item.type==='line'&&(item.parentIndex===null||map.get(item.parentIndex)?.type!=='block'))throw new PolicyOcrStoreError('invalid_chunk');if(item.type==='word'&&(item.parentIndex===null||map.get(item.parentIndex)?.type!=='line'))throw new PolicyOcrStoreError('invalid_chunk')}
  const count=(type:string)=>elements.filter(item=>item.type===type).length;if(count('block')>MAX_POLICY_OCR_ELEMENTS_PER_PAGE||input.status==='accepted_candidate'&&input.qualityStatus!=='high'||input.status==='low_confidence'&&input.qualityStatus!=='low'||input.qualityStatus==='high'&&input.requiresHumanReview||input.qualityStatus!=='high'&&!input.requiresHumanReview||input.lowConfidenceWordCount>count('word'))throw new PolicyOcrStoreError('invalid_chunk')
}

export async function acceptPolicyOcrChunk(pool:pg.Pool,agent:AgentActor,jobId:string,input:PolicyOcrChunkRequest):Promise<{readonly acceptedPageCount:number}>{return withTransaction(pool,async client=>{
  const jobResult=await client.query('SELECT target_id,target_version,status,leased_by_agent_id,lease_expires_at FROM jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE',[jobId,agent.organizationId]);const job=jobResult.rows[0] as{target_id:string;target_version:number;status:string;leased_by_agent_id:string|null;lease_expires_at:Date|null}|undefined
  if(job===undefined)throw new PolicyOcrStoreError('not_found');if(job.status!=='leased'||job.leased_by_agent_id!==agent.id||job.lease_expires_at===null||job.lease_expires_at.getTime()<Date.now())throw new PolicyOcrStoreError('lease_conflict');if(job.target_id!==input.ocrRunId||job.target_version!==input.ocrRunVersion)throw new PolicyOcrStoreError('version_conflict')
  const selected=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[agent.organizationId,input.ocrRunId]);const row=selected.rows[0] as RunRow|undefined;if(row===undefined)throw new PolicyOcrStoreError('not_found');if(!['rendering','preprocessing','recognizing','normalizing','validating'].includes(row.status)||row.version!==input.ocrRunVersion||row.active_job_id!==jobId)throw new PolicyOcrStoreError('version_conflict')
  for(const item of input.pages)validateChunkPage(item,row)
  if(input.sequence<=row.last_chunk_sequence){for(const item of input.pages){const old=await client.query('SELECT status,normalized_text_hash,block_count,line_count,word_count FROM document_ocr_pages WHERE ocr_run_id=$1 AND page_number=$2',[row.id,item.pageNumber]);const value=old.rows[0] as Record<string,unknown>|undefined;const count=(type:string)=>item.elements.filter(e=>e.type===type).length;if(value===undefined||value.status!==item.status||value.normalized_text_hash!==item.normalizedTextHash||value.block_count!==count('block')||value.line_count!==count('line')||value.word_count!==count('word'))throw new PolicyOcrStoreError('invalid_chunk')}return{acceptedPageCount:input.pages.length}}
  if(input.sequence!==row.last_chunk_sequence+1)throw new PolicyOcrStoreError('invalid_chunk')
  for(const item of input.pages){const sourcePageResult=await client.query('SELECT status,normalized_text FROM document_text_extraction_pages WHERE organization_id=$1 AND case_id=$2 AND extraction_id=$3 AND id=$4',[agent.organizationId,row.case_id,row.text_extraction_id,item.textPageId]);const sourcePage=sourcePageResult.rows[0] as{status:string;normalized_text:string}|undefined;if(sourcePage===undefined||!['image_only','text'].includes(sourcePage.status)||(sourcePage.status==='image_only'&&item.compositeStatus!=='ocr_only')||(sourcePage.status==='text'&&item.compositeStatus!=='control_required'))throw new PolicyOcrStoreError('invalid_chunk');const compositeStatus=derivePolicyOcrCompositeStatus({sourcePageStatus:sourcePage.status as'image_only'|'text',pdfNormalizedText:sourcePage.normalized_text,ocrNormalizedText:item.normalizedText});const duplicate=await client.query('SELECT 1 FROM document_ocr_pages WHERE ocr_run_id=$1 AND page_number=$2',[row.id,item.pageNumber]);if((duplicate.rowCount??0)!==0)throw new PolicyOcrStoreError('invalid_chunk');const pageId=uuidv7();const blocks=item.elements.filter(e=>e.type==='block'),lines=item.elements.filter(e=>e.type==='line'),words=item.elements.filter(e=>e.type==='word')
    await client.query(`INSERT INTO document_ocr_pages(id,organization_id,case_id,ocr_run_id,text_page_id,page_number,status,language_mode,image_width,image_height,render_dpi,rotation_degrees,deskew_degrees,threshold_value,raw_ocr_text,raw_text_hash,normalized_text,normalized_text_hash,normalized_character_count,mean_confidence,minimum_confidence,quality_status,reading_order_quality,composite_status,quality_reason_code,requires_human_review,block_count,line_count,word_count,low_confidence_word_count,unreadable_region_count,processing_duration_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,[pageId,agent.organizationId,row.case_id,row.id,item.textPageId,item.pageNumber,item.status,item.languageMode,item.imageWidth,item.imageHeight,item.renderDpi,item.rotationDegrees,item.deskewDegrees,item.threshold,item.rawOcrText,item.rawTextHash,item.normalizedText,item.normalizedTextHash,Array.from(item.normalizedText).length,item.meanConfidence,item.minimumConfidence,item.qualityStatus,item.readingOrderQuality,compositeStatus,item.qualityReasonCode,item.requiresHumanReview,blocks.length,lines.length,words.length,item.lowConfidenceWordCount,item.unreadableRegionCount,item.processingDurationMs])
    const ids=new Map<number,string>();for(const value of blocks)ids.set(value.elementIndex,uuidv7());for(const value of lines)ids.set(value.elementIndex,uuidv7());for(const value of words)ids.set(value.elementIndex,uuidv7());const insert=async(table:string,value:(typeof item.elements)[number],extra:readonly unknown[])=>{const text=sliceByCodePoint(item.normalizedText,value.startOffset,value.endOffset);await client.query(`INSERT INTO ${table}(id,organization_id,case_id,ocr_run_id,page_id,page_number,element_index,reading_order,start_offset,end_offset,element_text,text_hash,confidence,bbox_x,bbox_y,bbox_width,bbox_height${table==='document_ocr_lines'?',block_id':table==='document_ocr_words'?',block_id,line_id':''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17${extra.map((_,index)=>`,$${18+index}`).join('')})`,[ids.get(value.elementIndex),agent.organizationId,row.case_id,row.id,pageId,item.pageNumber,value.elementIndex,value.readingOrder,value.startOffset,value.endOffset,text,value.textHash,value.confidence,value.bbox.x,value.bbox.y,value.bbox.width,value.bbox.height,...extra])}
    for(const value of blocks)await insert('document_ocr_blocks',value,[]);for(const value of lines){const blockId=ids.get(value.parentIndex!);if(blockId===undefined)throw new PolicyOcrStoreError('invalid_chunk');await insert('document_ocr_lines',value,[blockId])}for(const value of words){const line=item.elements.find(e=>e.elementIndex===value.parentIndex&&e.type==='line');const lineId=ids.get(value.parentIndex!);const blockId=line?.parentIndex===null||line===undefined?undefined:ids.get(line.parentIndex);if(lineId===undefined||blockId===undefined)throw new PolicyOcrStoreError('invalid_chunk');await insert('document_ocr_words',value,[blockId,lineId])}
  }
  await client.query('UPDATE document_ocr_runs SET last_chunk_sequence=$2,updated_at=now() WHERE id=$1',[row.id,input.sequence]);return{acceptedPageCount:input.pages.length}
})}

export interface AgentOcrApplyResult {readonly metadataResult:string;readonly errorCode:string|null;readonly auditAction:string;readonly jobStatus:'succeeded'|'failed'}
export async function finalizePolicyOcr(client:pg.PoolClient,context:{organizationId:string;agentId:string;requestId:string},job:{id:string;target_id:string;target_version:number},result:PolicyOcrResultSummary|undefined):Promise<AgentOcrApplyResult>{
  const selected=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[context.organizationId,job.target_id]);const row=selected.rows[0] as RunRow|undefined;if(row===undefined)return{metadataResult:'missing',errorCode:'ocr_run_missing',auditAction:'job.verification_failed',jobStatus:'failed'}
  if(['ready','partial','low_confidence','control_required'].includes(row.status))return{metadataResult:row.status,errorCode:null,auditAction:'job.verified',jobStatus:'succeeded'}
  if(!['rendering','preprocessing','recognizing','normalizing','validating'].includes(row.status)||row.version!==job.target_version||row.active_job_id!==job.id||result===undefined||result.ocrRunId!==row.id||result.ocrRunVersion!==row.version||result.engineVersion!==row.engine_version||result.languageDataVersion!==row.language_data_version||result.languageDataHash!==row.language_data_hash||result.renderProfileVersion!==row.render_profile_version||result.preprocessingVersion!==row.preprocessing_version||result.qualityVersion!==row.quality_version||result.normalizationVersion!==row.normalization_version||result.locatorVersion!==row.locator_version||result.sourceHash!==row.source_hash||result.sourceSize!==Number(row.source_size))return{metadataResult:'stale',errorCode:'ocr_result_mismatch',auditAction:'job.verification_failed',jobStatus:'failed'}
  const pages=await client.query('SELECT page_number,status,normalized_text_hash,quality_status,block_count,line_count,word_count,normalized_character_count,mean_confidence FROM document_ocr_pages WHERE ocr_run_id=$1 ORDER BY page_number',[row.id]);const items=pages.rows as Array<{page_number:number;status:string;normalized_text_hash:string;quality_status:string;block_count:number;line_count:number;word_count:number;normalized_character_count:number;mean_confidence:string}>
  const count=(status:string)=>items.filter(item=>item.status===status).length,blockCount=items.reduce((s,i)=>s+i.block_count,0),lineCount=items.reduce((s,i)=>s+i.line_count,0),wordCount=items.reduce((s,i)=>s+i.word_count,0),characterCount=items.reduce((s,i)=>s+i.normalized_character_count,0),processed=items.length
  const outputHash=buildPolicyOcrOutputHash(items.map(item=>({pageNumber:item.page_number,status:item.status as never,normalizedTextHash:item.normalized_text_hash,qualityStatus:item.quality_status as never,blockCount:item.block_count,lineCount:item.line_count,wordCount:item.word_count})))
  const readyCount=count('accepted_candidate'),lowQualityCount=count('partial')+count('low_confidence')+count('control_required'),emptyCount=count('unreadable'),failedCount=count('failed')+count('unsupported')
  const status=derivePolicyOcrRunStatus({eligiblePageCount:row.eligible_page_count,readyPageCount:readyCount,lowQualityPageCount:lowQualityCount,emptyPageCount:emptyCount,failedPageCount:failedCount});const mean=items.length===0?null:Math.round(items.reduce((s,i)=>s+Number(i.mean_confidence),0)/items.length*1000)/1000
  const matches=processed===row.eligible_page_count&&items.every(item=>row.selected_page_numbers.includes(item.page_number))&&status===result.status&&processed===result.processedPageCount&&readyCount===result.readyPageCount&&lowQualityCount===result.lowQualityPageCount&&emptyCount===result.emptyPageCount&&failedCount===result.failedPageCount&&blockCount===result.blockCount&&lineCount===result.lineCount&&wordCount===result.wordCount&&characterCount===result.normalizedCharacterCount&&mean===result.meanConfidence&&outputHash===result.outputHash
  if(!matches)return{metadataResult:'failed',errorCode:'ocr_summary_mismatch',auditAction:'job.verification_failed',jobStatus:'failed'}
  await client.query(`UPDATE document_ocr_runs SET status=$2,processed_page_count=$3,ready_page_count=$4,low_quality_page_count=$5,empty_page_count=$6,failed_page_count=$7,block_count=$8,line_count=$9,word_count=$10,normalized_character_count=$11,mean_confidence=$12,output_hash=$13,failure_code=NULL,completed_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[row.id,status,processed,readyCount,lowQualityCount,emptyCount,failedCount,blockCount,lineCount,wordCount,characterCount,mean,outputHash])
  await createAuditService().record(client,{organizationId:context.organizationId,requestId:context.requestId,action:status==='ready'?'document_page_ocr.completed':status==='partial'?'document_page_ocr.partial':status==='low_confidence'?'document_page_ocr.low_confidence':'document_page_ocr.control_required',entityType:'document_ocr_run',entityId:row.id,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,textExtractionId:row.text_extraction_id,jobId:job.id,agentId:context.agentId,ocrVersion:row.ocr_version,status,engineVersion:row.engine_version,languageDataVersion:row.language_data_version,languageDataHash:row.language_data_hash,renderProfileVersion:row.render_profile_version,preprocessingVersion:row.preprocessing_version,qualityVersion:row.quality_version,locatorVersion:row.locator_version,eligiblePageCount:row.eligible_page_count,processedPageCount:processed,readyPageCount:readyCount,lowQualityPageCount:lowQualityCount,failedPageCount:failedCount,blockCount,lineCount,wordCount,outputHash}})
  return{metadataResult:status,errorCode:null,auditAction:'job.verified',jobStatus:'succeeded'}
}

export async function markPolicyOcrStarted(client:pg.PoolClient,organizationId:string,ocrRunId:string,jobId:string,agentId:string):Promise<void>{const changed=await client.query("UPDATE document_ocr_runs SET status='rendering',started_at=coalesce(started_at,now()),failure_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND active_job_id=$3 AND status IN ('queued','rendering') RETURNING case_id,document_id,document_version_id,ocr_version",[organizationId,ocrRunId,jobId]);const row=changed.rows[0] as Record<string,unknown>|undefined;if(row!==undefined)await createAuditService().record(client,{organizationId,action:'document_page_ocr.started',entityType:'document_ocr_run',entityId:ocrRunId,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,ocrVersion:row.ocr_version,jobId,agentId}})}

export async function markPolicyOcrFailure(client:pg.PoolClient,context:{organizationId:string;agentId:string;requestId:string},job:{id:string;target_id:string;attempt_count:number;max_attempts:number},errorCode:string,terminal:boolean):Promise<void>{const selected=await client.query(`${RUN_SELECT} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[context.organizationId,job.target_id]);const row=selected.rows[0] as RunRow|undefined;if(row===undefined||['ready','partial','low_confidence','control_required','failed','cancelled','stale','superseded'].includes(row.status))return;if(terminal||job.attempt_count>=job.max_attempts){await client.query("UPDATE document_ocr_runs SET status='failed',failure_code=$2,completed_at=now(),version=version+1,updated_at=now() WHERE id=$1",[row.id,errorCode]);await createAuditService().record(client,{organizationId:context.organizationId,requestId:context.requestId,action:errorCode==='network_access_blocked'?'document_page_ocr.network_attempt_blocked':'document_page_ocr.failed',entityType:'document_ocr_run',entityId:row.id,details:{caseId:row.case_id,documentId:row.document_id,documentVersionId:row.document_version_id,ocrVersion:row.ocr_version,jobId:job.id,agentId:context.agentId,errorCode,attempt:job.attempt_count}})}else await client.query("UPDATE document_ocr_runs SET status='queued',failure_code=$2,updated_at=now() WHERE id=$1",[row.id,errorCode])}
