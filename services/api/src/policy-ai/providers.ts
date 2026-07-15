import {POLICY_AI_OUTPUT_SCHEMA_VERSION,type PolicyAiProviderId} from '@hasarbotu/domain'

export interface PolicyAiProviderSource {readonly sourceAnchorId:string;readonly text:string;readonly sourceQuality:'high'|'medium'|'low'|'control_required';readonly warnings:readonly string[]}
export interface PolicyAiProviderRequest {readonly systemContract:{readonly promptTemplateVersion:string;readonly instruction:string};readonly outputContract:{readonly schemaVersion:string;readonly maximumCandidates:number};readonly sourceBundle:{readonly sourceBundleHash:string;readonly sources:readonly PolicyAiProviderSource[]}}
export interface PolicyAiProviderUsage {readonly inputCharacters:number;readonly outputCharacters:number;readonly estimatedCostMinor:number;readonly actualCostMinor:number}
export interface PolicyAiProviderResponse {readonly output:unknown;readonly usage:PolicyAiProviderUsage}
export interface PolicyAiProviderDescriptor {readonly providerId:PolicyAiProviderId;readonly providerVersion:string;readonly modelId:string;readonly capabilities:readonly string[];readonly maximumInputCharacters:number;readonly maximumOutputSize:number;estimateCostMinor(inputCharacters:number):number}
export interface PolicyAiProviderAdapter {readonly descriptor:PolicyAiProviderDescriptor;execute(request:PolicyAiProviderRequest,signal:AbortSignal):Promise<PolicyAiProviderResponse>}
export interface PolicyAiProviderRegistry {get(providerId:PolicyAiProviderId):PolicyAiProviderAdapter|undefined}

const REQUIRED_CAPABILITIES=['structured_output','source_anchors'] as const
export function isPolicyAiProviderDescriptorCompatible(descriptor:PolicyAiProviderDescriptor,expected?:{readonly providerId:PolicyAiProviderId;readonly providerVersion:string;readonly modelId:string;readonly inputCharacters:number}):boolean{
  if(!REQUIRED_CAPABILITIES.every(capability=>descriptor.capabilities.includes(capability)))return false
  if(!Number.isSafeInteger(descriptor.maximumInputCharacters)||descriptor.maximumInputCharacters<1||descriptor.maximumInputCharacters>200_000||!Number.isSafeInteger(descriptor.maximumOutputSize)||descriptor.maximumOutputSize<1||descriptor.maximumOutputSize>1_000_000)return false
  if(expected===undefined)return true
  return descriptor.providerId===expected.providerId&&descriptor.providerVersion===expected.providerVersion&&descriptor.modelId===expected.modelId&&expected.inputCharacters<=descriptor.maximumInputCharacters
}

class DeterministicProvider implements PolicyAiProviderAdapter {
  readonly descriptor:PolicyAiProviderDescriptor
  calls=0
  constructor(readonly kind:PolicyAiProviderId){this.descriptor={providerId:kind,providerVersion:'deterministic/1.0.0',modelId:'local-fixture-v1',capabilities:['structured_output','source_anchors'],maximumInputCharacters:200_000,maximumOutputSize:100_000,estimateCostMinor:(characters)=>Math.max(1,Math.ceil(characters/10_000))}}
  async execute(request:PolicyAiProviderRequest,signal:AbortSignal):Promise<PolicyAiProviderResponse>{
    this.calls+=1
    if(this.kind==='deterministic-timeout')return await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('provider_timeout')),{once:true})})
    if(this.kind==='deterministic-failure')throw new Error('provider_failed')
    if(this.kind==='deterministic-invalid-schema'){const output={schemaVersion:POLICY_AI_OUTPUT_SCHEMA_VERSION,candidates:[{category:'not-valid'}],raw:'must-not-persist'};return {output,usage:this.usage(request,JSON.stringify(output).length)}}
    const first=request.sourceBundle.sources[0]
    if(first===undefined)return {output:{schemaVersion:POLICY_AI_OUTPUT_SCHEMA_VERSION,candidates:[]},usage:this.usage(request,10)}
    if(this.kind==='deterministic-prompt-injection-attempt'){const output={schemaVersion:POLICY_AI_OUTPUT_SCHEMA_VERSION,candidates:[{candidateId:'injection-1',category:'special_condition',canonicalField:'special.injection',normalizedValue:'ignored',originalValue:'ignored',conditions:[],exceptions:[],sourceAnchorIds:['f'.repeat(64)],providerConfidence:1}]};return {output,usage:this.usage(request,JSON.stringify(output).length)}}
    const candidates:Array<Record<string,unknown>>=[]
    const add=(id:string,category:string,field:string,value:unknown,original:string,source=first)=>candidates.push({candidateId:id,category,canonicalField:field,normalizedValue:value,originalValue:original,conditions:[],exceptions:[],sourceAnchorIds:[source.sourceAnchorId],providerConfidence:.86})
    for(const source of request.sourceBundle.sources){const lower=source.text.toLocaleLowerCase('tr-TR')
      if(lower.includes('%10'))add('deductible-10','deductible','deductible.conditional',{percentage:10},'%10',source)
      if(lower.includes('muafiyetsiz'))add('deductible-none','deductible','deductible.general','none','muafiyetsiz',source)
      if(lower.includes('anlaşmasız servis'))add('service-uncontracted','service_rule','service.uncontracted','control_required','anlaşmasız servis',source)
      if(lower.includes('orijinal parça'))add('part-original','part_rule','part.allowed','original','orijinal parça',source)
      if(lower.includes('ikame araç'))add('replacement-vehicle','replacement_vehicle','replacement_vehicle.available',true,'ikame araç',source)
    }
    if(candidates.length===0){const original=first.text.slice(0,Math.min(40,first.text.length)).trim();if(original.length>0)add('special-1','special_condition','special.unclassified','control_required',original)}
    const output={schemaVersion:POLICY_AI_OUTPUT_SCHEMA_VERSION,candidates}
    return {output,usage:this.usage(request,JSON.stringify(output).length)}
  }
  private usage(request:PolicyAiProviderRequest,outputCharacters:number):PolicyAiProviderUsage{const inputCharacters=request.sourceBundle.sources.reduce((sum,item)=>sum+item.text.length,0);const cost=this.descriptor.estimateCostMinor(inputCharacters);return{inputCharacters,outputCharacters,estimatedCostMinor:cost,actualCostMinor:cost}}
}

export interface DeterministicPolicyAiProviderRegistry extends PolicyAiProviderRegistry {getCallCount(providerId:PolicyAiProviderId):number}
export function createDeterministicPolicyAiProviderRegistry():DeterministicPolicyAiProviderRegistry {const map=new Map<PolicyAiProviderId,DeterministicProvider>();for(const id of ['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt'] as const)map.set(id,new DeterministicProvider(id));return{get:id=>map.get(id),getCallCount:id=>map.get(id)?.calls??0}}

export async function executePolicyAiProvider(adapter:PolicyAiProviderAdapter,request:PolicyAiProviderRequest,timeoutMs:number):Promise<PolicyAiProviderResponse>{const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('provider_timeout'))},timeoutMs)});try{return await Promise.race([adapter.execute(request,controller.signal),deadline])}finally{if(timeout!==undefined)clearTimeout(timeout)}}
