import { sha256Text } from './pdf-text-extraction.js'

export const POLICY_AI_BUNDLE_SCHEMA_VERSION = 'policy-ai-source-bundle/1.0.0' as const
export const POLICY_AI_PROMPT_TEMPLATE_VERSION = 'policy-ai-extraction/1.0.0' as const
export const POLICY_AI_OUTPUT_SCHEMA_VERSION = 'policy-ai-candidates/1.0.0' as const
export const POLICY_AI_PROVIDER_IDS = ['deterministic-success','deterministic-invalid-schema','deterministic-timeout','deterministic-failure','deterministic-prompt-injection-attempt','openai-responses'] as const
export const POLICY_AI_RUN_STATUSES = ['planned','provider_disabled','budget_blocked','running','validating','review_required','failed','stale','cancelled','superseded'] as const
export const POLICY_AI_CANDIDATE_CATEGORIES = ['policy_identity','coverage','deductible','service_rule','part_rule','replacement_vehicle','assistance','valuation','exclusion','required_document','special_condition'] as const
export const POLICY_AI_VALIDATION_STATUSES = ['validated','control_required','rejected_evidence'] as const
export const POLICY_AI_CONFLICT_STATUSES = ['none','duplicate','conflict_detected','control_required'] as const
export const POLICY_AI_SOURCE_QUALITIES = ['high','medium','low','control_required'] as const
export const POLICY_AI_SOURCE_COMPLETENESS = ['complete','partial','control_required','unknown'] as const
export const POLICY_AI_HUMAN_REVIEW_STATUSES = ['pending','control_required'] as const
export const POLICY_AI_REVIEW_ACTIONS = ['accepted','edited','rejected','control_required'] as const
export const POLICY_AI_REVIEW_SCHEMA_VERSION = 'policy-ai-human-review/1.0.0' as const
export const POLICY_AI_PROMOTION_SCHEMA_VERSION = 'policy-ai-promotion/1.0.0' as const
export const POLICY_AI_SOURCE_TYPES = ['pdf_text','ocr'] as const
export const POLICY_AI_MAX_ANCHOR_TEXT = 4_000
export const POLICY_AI_MAX_BUNDLE_ITEMS = 200
export const POLICY_AI_MAX_INPUT_CHARACTERS = 200_000
export const POLICY_AI_MAX_CANDIDATES = 100
export const POLICY_AI_MAX_NORMALIZED_DEPTH = 4
export const POLICY_AI_MAX_NORMALIZED_PROPERTIES = 20
export const POLICY_AI_MAX_NORMALIZED_LIST_ITEMS = 20

export type PolicyAiProviderId=(typeof POLICY_AI_PROVIDER_IDS)[number]
export type PolicyAiRunStatus=(typeof POLICY_AI_RUN_STATUSES)[number]
export type PolicyAiCandidateCategory=(typeof POLICY_AI_CANDIDATE_CATEGORIES)[number]
export type PolicyAiValidationStatus=(typeof POLICY_AI_VALIDATION_STATUSES)[number]
export type PolicyAiConflictStatus=(typeof POLICY_AI_CONFLICT_STATUSES)[number]
export type PolicyAiSourceQuality=(typeof POLICY_AI_SOURCE_QUALITIES)[number]
export type PolicyAiSourceCompleteness=(typeof POLICY_AI_SOURCE_COMPLETENESS)[number]
export type PolicyAiSourceType=(typeof POLICY_AI_SOURCE_TYPES)[number]
export type PolicyAiReviewAction=(typeof POLICY_AI_REVIEW_ACTIONS)[number]

export interface PolicyAiSourceBundleItem {
  readonly sourceAnchorId:string
  readonly sourceType:PolicyAiSourceType
  readonly documentVersionId:string
  readonly extractionId:string
  readonly sourceItemId:string
  readonly pageNumber:number
  readonly text:string
  readonly textHash:string
  readonly sourceQuality:PolicyAiSourceQuality
  readonly warnings:readonly string[]
  readonly historicalSelected:boolean
}

export interface PolicyAiCandidateInput {
  readonly candidateId:string
  readonly category:PolicyAiCandidateCategory
  readonly canonicalField:string
  readonly normalizedValue:unknown
  readonly originalValue:string
  readonly conditions:readonly string[]
  readonly exceptions:readonly string[]
  readonly sourceAnchorIds:readonly string[]
  readonly providerConfidence:number
}

function canonical(value:unknown):string {
  if(value===null)return 'null'
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new Error('non_finite_number')
    return JSON.stringify(value)
  }
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`
  if(typeof value==='object'){
    const entries=Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b,'en'))
    return `{${entries.map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  throw new Error('unsupported_canonical_value')
}

export function buildPolicyAiSourceBundleHash(items:readonly PolicyAiSourceBundleItem[]):string {
  const ordered=[...items].sort((a,b)=>a.sourceAnchorId.localeCompare(b.sourceAnchorId,'en'))
  return sha256Text(canonical({bundleSchemaVersion:POLICY_AI_BUNDLE_SCHEMA_VERSION,items:ordered}))
}

const INJECTION_PATTERNS:readonly RegExp[]=[
  /(?:ignore|forget)\s+(?:all\s+)?previous\s+instructions?/iu,
  /(?:önceki|yukarıdaki)\s+talimatlar[ıi]\s+unut/iu,
  /(?:system|sistem)\s+(?:prompt|talimat)/iu,
  /(?:call|invoke|çağır)\s+(?:a\s+)?(?:tool|araç)/iu,
  /https?:\/\//iu,
]

export function detectPolicyAiPromptInjection(text:string):readonly string[]{
  const warnings:string[]=[]
  for(const [index,pattern] of INJECTION_PATTERNS.entries())if(pattern.test(text))warnings.push(`untrusted_instruction_pattern_${index+1}`)
  return warnings
}

export interface PolicyAiBudgetFacts {readonly enabled:boolean;readonly providerAllowed:boolean;readonly monthlyBudgetMinor:number;readonly perRequestBudgetMinor:number;readonly monthlyHardStop:boolean;readonly currentMonthCostMinor:number;readonly estimatedCostMinor:number}
export type PolicyAiBudgetDecision={readonly allowed:true;readonly code:'allowed'}|{readonly allowed:false;readonly code:'AI_PROVIDER_DISABLED'|'AI_BUDGET_EXCEEDED'}
export function evaluatePolicyAiBudget(facts:PolicyAiBudgetFacts):PolicyAiBudgetDecision{
  for(const value of [facts.monthlyBudgetMinor,facts.perRequestBudgetMinor,facts.currentMonthCostMinor,facts.estimatedCostMinor])if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid_budget_minor')
  if(!facts.enabled||!facts.providerAllowed)return {allowed:false,code:'AI_PROVIDER_DISABLED'}
  if(facts.estimatedCostMinor>facts.perRequestBudgetMinor)return {allowed:false,code:'AI_BUDGET_EXCEEDED'}
  if(facts.monthlyHardStop&&facts.currentMonthCostMinor+facts.estimatedCostMinor>facts.monthlyBudgetMinor)return {allowed:false,code:'AI_BUDGET_EXCEEDED'}
  return {allowed:true,code:'allowed'}
}

function comparableText(value:string):string{return value.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/\s+/gu,' ').trim()}
function isLetterOrNumber(value:string|undefined):boolean{return value!==undefined&&/[\p{L}\p{N}]/u.test(value)}
function containsBoundedEvidence(haystack:string,needle:string):boolean{
  if(needle.length===0)return false
  let offset=haystack.indexOf(needle)
  while(offset>=0){
    const before=offset===0?undefined:haystack[offset-1]
    const afterIndex=offset+needle.length
    const after=afterIndex>=haystack.length?undefined:haystack[afterIndex]
    const startsWithWord=isLetterOrNumber(needle[0])
    const endsWithWord=isLetterOrNumber(needle[needle.length-1])
    if((!startsWithWord||!isLetterOrNumber(before))&&(!endsWithWord||!isLetterOrNumber(after)))return true
    offset=haystack.indexOf(needle,offset+1)
  }
  return false
}
function evidenceTokens(value:unknown,output:string[]=[]):string[]{if(typeof value==='number'&&Number.isFinite(value))output.push(String(value));else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value))output.push(value);else if(Array.isArray(value))for(const item of value)evidenceTokens(item,output);else if(value!==null&&typeof value==='object')for(const item of Object.values(value as Record<string,unknown>))evidenceTokens(item,output);return output}

export interface PolicyAiEvidenceValidation {readonly status:PolicyAiValidationStatus;readonly sourceQuality:PolicyAiSourceQuality;readonly reason:string}
export function validatePolicyAiCandidateEvidence(candidate:PolicyAiCandidateInput,items:readonly PolicyAiSourceBundleItem[]):PolicyAiEvidenceValidation{
  const map=new Map(items.map(item=>[item.sourceAnchorId,item]))
  if(candidate.sourceAnchorIds.length===0||new Set(candidate.sourceAnchorIds).size!==candidate.sourceAnchorIds.length)return {status:'rejected_evidence',sourceQuality:'control_required',reason:'source_anchor_required'}
  const sources=candidate.sourceAnchorIds.map(id=>map.get(id))
  if(sources.some(item=>item===undefined))return {status:'rejected_evidence',sourceQuality:'control_required',reason:'source_anchor_invalid'}
  const resolved=sources as PolicyAiSourceBundleItem[]
  const evidence=resolved.map(item=>comparableText(item.text))
  const originalValue=comparableText(candidate.originalValue)
  if(originalValue.length===0||!evidence.some(item=>containsBoundedEvidence(item,originalValue)))return {status:'rejected_evidence',sourceQuality:'control_required',reason:'original_value_not_found'}
  if(evidenceTokens(candidate.normalizedValue).some(token=>!evidence.some(item=>containsBoundedEvidence(item,comparableText(token)))))return {status:'rejected_evidence',sourceQuality:'control_required',reason:'normalized_numeric_or_date_not_found'}
  const sourceQuality=resolved.some(item=>item.sourceQuality==='control_required')?'control_required':resolved.some(item=>item.sourceQuality==='low')?'low':resolved.some(item=>item.sourceQuality==='medium')?'medium':'high'
  if(sourceQuality==='low'||sourceQuality==='control_required')return {status:'control_required',sourceQuality,reason:'source_quality_requires_control'}
  if(resolved.some(item=>item.historicalSelected))return {status:'control_required',sourceQuality:'control_required',reason:'historical_source_requires_control'}
  if(resolved.some(item=>item.warnings.length>0))return {status:'control_required',sourceQuality:'control_required',reason:'source_warning_requires_control'}
  return {status:'validated',sourceQuality,reason:'evidence_matched'}
}

export interface PolicyAiConflictProposal {readonly leftCandidateId:string;readonly rightCandidateId:string;readonly status:Exclude<PolicyAiConflictStatus,'none'>;readonly reason:string}
export function detectPolicyAiCandidateConflicts(candidates:readonly PolicyAiCandidateInput[]):readonly PolicyAiConflictProposal[]{
  const result:PolicyAiConflictProposal[]=[]
  const ordered=[...candidates].sort((left,right)=>left.candidateId.localeCompare(right.candidateId,'en'))
  for(let leftIndex=0;leftIndex<ordered.length;leftIndex+=1){
    const left=ordered[leftIndex]
    if(left===undefined)continue
    for(let rightIndex=leftIndex+1;rightIndex<ordered.length;rightIndex+=1){
      const right=ordered[rightIndex]
      if(right===undefined||left.canonicalField!==right.canonicalField)continue
      const sameValue=canonical(left.normalizedValue)===canonical(right.normalizedValue)
      if(!sameValue){result.push({leftCandidateId:left.candidateId,rightCandidateId:right.candidateId,status:'conflict_detected',reason:'same_field_different_value'});continue}
      const sameCategory=left.category===right.category
      const sameConditions=canonical([...left.conditions].sort())===canonical([...right.conditions].sort())
      const sameExceptions=canonical([...left.exceptions].sort())===canonical([...right.exceptions].sort())
      const sameSources=canonical([...left.sourceAnchorIds].sort())===canonical([...right.sourceAnchorIds].sort())
      if(sameCategory&&sameConditions&&sameExceptions&&sameSources)result.push({leftCandidateId:left.candidateId,rightCandidateId:right.candidateId,status:'duplicate',reason:'same_field_same_value_same_context'})
      else result.push({leftCandidateId:left.candidateId,rightCandidateId:right.candidateId,status:'control_required',reason:sameConditions&&sameExceptions?'same_field_same_value_different_source':'same_field_same_value_different_context'})
    }
  }
  const deductibles=ordered.filter(item=>item.category==='deductible')
  const generalNone=deductibles.find(item=>item.canonicalField==='deductible.general'&&item.normalizedValue==='none')
  if(generalNone!==undefined)for(const conditional of deductibles.filter(item=>item.canonicalField==='deductible.conditional'))result.push({leftCandidateId:generalNone.candidateId,rightCandidateId:conditional.candidateId,status:'control_required',reason:'general_no_deductible_does_not_override_conditional'})
  return result
}

export interface PolicyAiReviewFact {
  readonly candidateId:string
  readonly reviewVersion:number
  readonly action:PolicyAiReviewAction
  readonly normalizedValue:unknown
  readonly originalValue:string
  readonly conditions:readonly string[]
  readonly exceptions:readonly string[]
  readonly sourceAnchorIds:readonly string[]
}

export function buildPolicyAiReviewSetHash(runId:string,reviews:readonly PolicyAiReviewFact[]):string {
  const ordered=[...reviews].sort((left,right)=>left.candidateId.localeCompare(right.candidateId,'en'))
  return sha256Text(canonical({schemaVersion:POLICY_AI_REVIEW_SCHEMA_VERSION,runId,reviews:ordered}))
}

export type PolicyAiReviewDecision=
  | {readonly allowed:true;readonly evidence:PolicyAiEvidenceValidation}
  | {readonly allowed:false;readonly code:'candidate_evidence_rejected'|'edited_evidence_rejected'}

export function evaluatePolicyAiHumanReview(
  original:PolicyAiCandidateInput,
  action:PolicyAiReviewAction,
  reviewed:PolicyAiCandidateInput,
  sources:readonly PolicyAiSourceBundleItem[],
  originalValidationStatus:PolicyAiValidationStatus,
):PolicyAiReviewDecision {
  if(action==='rejected'||action==='control_required')return {allowed:true,evidence:{status:'control_required',sourceQuality:'control_required',reason:'human_review_decision'}}
  if(originalValidationStatus==='rejected_evidence')return {allowed:false,code:'candidate_evidence_rejected'}
  const evidence=validatePolicyAiCandidateEvidence(reviewed,sources)
  if(evidence.status==='rejected_evidence')return {allowed:false,code:action==='edited'?'edited_evidence_rejected':'candidate_evidence_rejected'}
  if(action==='accepted'&&canonical({normalizedValue:reviewed.normalizedValue,originalValue:reviewed.originalValue,conditions:reviewed.conditions,exceptions:reviewed.exceptions})!==canonical({normalizedValue:original.normalizedValue,originalValue:original.originalValue,conditions:original.conditions,exceptions:original.exceptions}))return {allowed:false,code:'edited_evidence_rejected'}
  return {allowed:true,evidence}
}

export interface PolicyAiPromotionReadiness {
  readonly canPromote:boolean
  readonly acceptedCount:number
  readonly editedCount:number
  readonly rejectedCount:number
  readonly controlRequiredCount:number
  readonly pendingCount:number
  readonly blockers:readonly ('AI_REVIEW_PENDING'|'AI_NO_APPROVED_CANDIDATE')[]
}

export function evaluatePolicyAiPromotionReadiness(candidateIds:readonly string[],reviews:readonly PolicyAiReviewFact[]):PolicyAiPromotionReadiness {
  const latest=new Map<string,PolicyAiReviewFact>()
  for(const review of reviews){
    const current=latest.get(review.candidateId)
    if(current===undefined||review.reviewVersion>current.reviewVersion)latest.set(review.candidateId,review)
  }
  const actions=candidateIds.map(candidateId=>latest.get(candidateId)?.action)
  const acceptedCount=actions.filter(action=>action==='accepted').length
  const editedCount=actions.filter(action=>action==='edited').length
  const rejectedCount=actions.filter(action=>action==='rejected').length
  const controlRequiredCount=actions.filter(action=>action==='control_required').length
  const pendingCount=actions.filter(action=>action===undefined).length
  const blockers:('AI_REVIEW_PENDING'|'AI_NO_APPROVED_CANDIDATE')[]=[]
  if(pendingCount>0)blockers.push('AI_REVIEW_PENDING')
  if(acceptedCount+editedCount===0)blockers.push('AI_NO_APPROVED_CANDIDATE')
  return {canPromote:blockers.length===0,acceptedCount,editedCount,rejectedCount,controlRequiredCount,pendingCount,blockers}
}
