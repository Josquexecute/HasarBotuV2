import {describe,expect,it} from 'vitest'
import {POLICY_AI_MAX_CANDIDATES} from '@hasarbotu/domain'
import {policyAiBundleSchema,policyAiCancelRequestSchema,policyAiCandidateReviewRequestSchema,policyAiNormalizedValueSchema,policyAiPlanRequestSchema,policyAiPrivacySchema,policyAiPromotionRequestSchema,policyAiProviderOutputSchema,policyAiStartRequestSchema} from '../src/index.js'
const id='018f1f7b-7a80-7000-8000-000000000001',hash='a'.repeat(64)
describe('policy AI contracts',()=>{
  it('plan kaynaklarını strict ve benzersiz doğrular',()=>{expect(policyAiPlanRequestSchema.parse({providerId:'deterministic-success',sources:[{sourceType:'pdf_text',extractionId:id,segmentId:id}]}).allowHistorical).toBe(false);expect(()=>policyAiPlanRequestSchema.parse({providerId:'deterministic-success',sources:[{sourceType:'pdf_text',extractionId:id,segmentId:id},{sourceType:'pdf_text',extractionId:id,segmentId:id}]})).toThrow();expect(()=>policyAiPlanRequestSchema.parse({providerId:'deterministic-success',sources:[{sourceType:'pdf_text',extractionId:id,segmentId:id,absolutePath:'P:\\x'}]})).toThrow()})
  it('gerçek provider ve PII/retention özetini strict doğrular',()=>{expect(policyAiPlanRequestSchema.parse({providerId:'openai-responses',sources:[{sourceType:'pdf_text',extractionId:id,segmentId:id}]}).providerId).toBe('openai-responses');expect(policyAiPrivacySchema.parse({externalProvider:true,policyVersion:'policy-ai-pii-redaction/1.0.0',outboundPayloadHash:hash,outboundInputCharacters:42,redactedValueCount:2,redactedCategories:['email','name'],retentionMode:'store_false',pricingVersion:'configured-token-pricing/1.0.0'}).redactedValueCount).toBe(2);expect(()=>policyAiPrivacySchema.parse({externalProvider:true,policyVersion:'x',outboundPayloadHash:hash,outboundInputCharacters:42,redactedValueCount:1,redactedCategories:['secret'],retentionMode:'store_false',pricingVersion:'x'})).toThrow()})
  it('start version ve bundle hash ister',()=>{expect(policyAiStartRequestSchema.parse({expectedVersion:1,expectedSourceBundleHash:hash}).expectedSourceBundleHash).toBe(hash);expect(()=>policyAiStartRequestSchema.parse({expectedVersion:1})).toThrow()})
  it('start/cancel optimistic version ve bundle hash sınırlarını doğrular',()=>{expect(policyAiCancelRequestSchema.parse({expectedVersion:1})).toEqual({expectedVersion:1});expect(()=>policyAiCancelRequestSchema.parse({expectedVersion:1,absolutePath:'P:\\x'})).toThrow()})
  it('structured output unknown alan, enum, NaN ve sınırsız listeyi reddeder',()=>{const base={schemaVersion:'policy-ai-candidates/1.0.0',candidates:[{candidateId:'c1',category:'deductible',canonicalField:'deductible.conditional',normalizedValue:{percentage:10},originalValue:'%10',conditions:[],exceptions:[],sourceAnchorIds:[hash],providerConfidence:.8}]};expect(policyAiProviderOutputSchema.parse(base).candidates).toHaveLength(1);expect(()=>policyAiProviderOutputSchema.parse({...base,unexpected:true})).toThrow();expect(()=>policyAiProviderOutputSchema.parse({...base,candidates:[{...base.candidates[0],category:'guess'}]})).toThrow();expect(()=>policyAiProviderOutputSchema.parse({...base,candidates:[{...base.candidates[0],providerConfidence:Number.NaN}]})).toThrow();expect(()=>policyAiProviderOutputSchema.parse({...base,candidates:Array.from({length:POLICY_AI_MAX_CANDIDATES+1},(_,index)=>({...base.candidates[0],candidateId:`c-${index}`}))})).toThrow()})
  it('duplicate candidateId değerini strict provider schema aşamasında reddeder',()=>{const candidate={candidateId:'same',category:'deductible',canonicalField:'deductible.conditional',normalizedValue:{percentage:10},originalValue:'%10',conditions:[],exceptions:[],sourceAnchorIds:[hash],providerConfidence:.8};expect(()=>policyAiProviderOutputSchema.parse({schemaVersion:'policy-ai-candidates/1.0.0',candidates:[candidate,{...candidate,normalizedValue:{percentage:20}}]})).toThrow()})
  it('normalizedValue derinlik, property ve liste sınırlarını uygular',()=>{
    expect(policyAiNormalizedValueSchema.safeParse({a:{b:{c:{d:'value'}}}}).success).toBe(true)
    expect(policyAiNormalizedValueSchema.safeParse({a:{b:{c:{d:{e:'too-deep'}}}}}).success).toBe(false)
    expect(policyAiNormalizedValueSchema.safeParse(Object.fromEntries(Array.from({length:21},(_,index)=>[`key${index}`,index]))).success).toBe(false)
    expect(policyAiNormalizedValueSchema.safeParse(Array.from({length:21},(_,index)=>index)).success).toBe(false)
  })
  it('bundle completeness ve eksik/OCR gereken sayfa preview alanlarını taşır',()=>{
    const bundle={id,sourceBundleHash:hash,bundleSchemaVersion:'policy-ai-source-bundle/1.0.0',documentVersionIds:[id],inputCharacters:12,sourceCount:1,completeness:'partial',missingPages:[2],ocrRequiredPages:[3],qualityWarnings:['OCR_REQUIRED'],createdAt:'2026-07-14T12:00:00.000Z',items:[{sourceAnchorId:hash,sourceType:'pdf_text',documentId:id,documentVersionId:id,extractionId:id,sourceItemId:id,pageNumber:1,boundedExcerpt:'sentetik metin',textHash:hash,sourceQuality:'medium',warnings:[],historicalSelected:false}]}
    expect(policyAiBundleSchema.parse(bundle)).toMatchObject({completeness:'partial',missingPages:[2],ocrRequiredPages:[3]})
  })
  it('insan review eylemlerini strict ve ilk karar icin version sifirla dogrular',()=>{
    expect(policyAiCandidateReviewRequestSchema.parse({action:'accepted',expectedReviewVersion:0})).toEqual({action:'accepted',expectedReviewVersion:0,reason:null})
    expect(()=>policyAiCandidateReviewRequestSchema.parse({action:'edited',expectedReviewVersion:0,reason:'Duzeltildi'})).toThrow()
    expect(()=>policyAiCandidateReviewRequestSchema.parse({action:'rejected',expectedReviewVersion:0})).toThrow()
  })
  it('promotion acik onay ve tam optimistic target identity ister',()=>{
    expect(policyAiPromotionRequestSchema.parse({confirmed:true,expectedRunVersion:2,expectedReviewSetHash:hash})).toMatchObject({expectedAnalysisId:null,expectedAnalysisVersion:null})
    expect(()=>policyAiPromotionRequestSchema.parse({confirmed:false,expectedRunVersion:2,expectedReviewSetHash:hash})).toThrow()
    expect(()=>policyAiPromotionRequestSchema.parse({confirmed:true,expectedRunVersion:2,expectedReviewSetHash:hash,expectedAnalysisId:id})).toThrow()
  })
})
