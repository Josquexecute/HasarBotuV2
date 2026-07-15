import {z} from 'zod'
import {MAX_PDF_PAGE_COUNT,POLICY_AI_BUNDLE_SCHEMA_VERSION,POLICY_AI_CANDIDATE_CATEGORIES,POLICY_AI_CONFLICT_STATUSES,POLICY_AI_HUMAN_REVIEW_STATUSES,POLICY_AI_MAX_ANCHOR_TEXT,POLICY_AI_MAX_BUNDLE_ITEMS,POLICY_AI_MAX_CANDIDATES,POLICY_AI_MAX_NORMALIZED_DEPTH,POLICY_AI_MAX_NORMALIZED_LIST_ITEMS,POLICY_AI_MAX_NORMALIZED_PROPERTIES,POLICY_AI_OUTPUT_SCHEMA_VERSION,POLICY_AI_PII_CATEGORIES,POLICY_AI_PROMOTION_SCHEMA_VERSION,POLICY_AI_PROMPT_TEMPLATE_VERSION,POLICY_AI_PROVIDER_IDS,POLICY_AI_REVIEW_ACTIONS,POLICY_AI_REVIEW_SCHEMA_VERSION,POLICY_AI_RUN_STATUSES,POLICY_AI_SOURCE_COMPLETENESS,POLICY_AI_SOURCE_QUALITIES,POLICY_AI_SOURCE_TYPES,POLICY_AI_VALIDATION_STATUSES} from '@hasarbotu/domain'
import {caseIdSchema,entityVersionSchema,idSchema,utcDateTimeSchema} from '../../common/primitives.js'
import {pageInfoSchema} from '../../common/pagination.js'
import {sha256HexSchema} from '../documents/dto.js'

export const policyAiAnchorIdSchema=sha256HexSchema
const safeCodeSchema=z.string().regex(/^[A-Z0-9_]{1,64}$/)
const shortText=z.string().trim().min(1).max(500)
const jsonPrimitive=z.union([z.string().max(2_000),z.number().finite(),z.boolean(),z.null()])
export const policyAiCandidateIdSchema=z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/)
const providerFactSchema=z.string().trim().min(1).max(80)
const normalizedKeySchema=z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/)
const MAX_POLICY_AI_CONFLICTS=(POLICY_AI_MAX_CANDIDATES*(POLICY_AI_MAX_CANDIDATES-1))/2+POLICY_AI_MAX_CANDIDATES
const MAX_POLICY_AI_USAGE_ITEMS=1_000

function createNormalizedValueSchema(depth:number):z.ZodType<unknown>{
  if(depth>=POLICY_AI_MAX_NORMALIZED_DEPTH)return jsonPrimitive
  const child=createNormalizedValueSchema(depth+1)
  const record=z.record(normalizedKeySchema,child).superRefine((value,context)=>{if(Object.keys(value).length>POLICY_AI_MAX_NORMALIZED_PROPERTIES)context.addIssue({code:'custom',message:'too_many_keys'})}).meta({maxProperties:POLICY_AI_MAX_NORMALIZED_PROPERTIES,'x-hasarbotu-runtime-validation':`max-object-properties-${POLICY_AI_MAX_NORMALIZED_PROPERTIES}`})
  return z.union([jsonPrimitive,z.array(child).max(POLICY_AI_MAX_NORMALIZED_LIST_ITEMS),record])
}
export const policyAiNormalizedValueSchema=createNormalizedValueSchema(0)

export const policyAiProviderOutputCandidateSchema=z.strictObject({candidateId:policyAiCandidateIdSchema,category:z.enum(POLICY_AI_CANDIDATE_CATEGORIES),canonicalField:z.string().regex(/^[a-z0-9_.-]{1,120}$/),normalizedValue:policyAiNormalizedValueSchema,originalValue:z.string().trim().min(1).max(1_000),conditions:z.array(shortText).max(20),exceptions:z.array(shortText).max(20),sourceAnchorIds:z.array(policyAiAnchorIdSchema).min(1).max(20),providerConfidence:z.number().finite().min(0).max(1)})
const policyAiProviderCandidatesSchema=z.array(policyAiProviderOutputCandidateSchema).max(POLICY_AI_MAX_CANDIDATES).superRefine((candidates,context)=>{const seen=new Set<string>();for(const [index,candidate] of candidates.entries()){if(seen.has(candidate.candidateId))context.addIssue({code:'custom',path:[index,'candidateId'],message:'duplicate_candidate_id'});seen.add(candidate.candidateId)}}).meta({'x-hasarbotu-runtime-validation':'unique-candidate-id'})
export const policyAiProviderOutputSchema=z.strictObject({schemaVersion:z.literal(POLICY_AI_OUTPUT_SCHEMA_VERSION),candidates:policyAiProviderCandidatesSchema})

export const policyAiSourceItemSchema=z.strictObject({sourceAnchorId:policyAiAnchorIdSchema,sourceType:z.enum(POLICY_AI_SOURCE_TYPES),documentId:idSchema,documentVersionId:idSchema,extractionId:idSchema,sourceItemId:idSchema,pageNumber:z.number().int().min(1).max(MAX_PDF_PAGE_COUNT),boundedExcerpt:z.string().min(1).max(POLICY_AI_MAX_ANCHOR_TEXT),textHash:sha256HexSchema,sourceQuality:z.enum(POLICY_AI_SOURCE_QUALITIES),warnings:z.array(safeCodeSchema).max(20),historicalSelected:z.boolean()})
const policyAiPageListSchema=z.array(z.number().int().min(1).max(MAX_PDF_PAGE_COUNT)).max(MAX_PDF_PAGE_COUNT)
export const policyAiBundleSchema=z.strictObject({id:idSchema,sourceBundleHash:sha256HexSchema,bundleSchemaVersion:z.literal(POLICY_AI_BUNDLE_SCHEMA_VERSION),documentVersionIds:z.array(idSchema).min(1).max(POLICY_AI_MAX_BUNDLE_ITEMS),inputCharacters:z.number().int().nonnegative(),sourceCount:z.number().int().nonnegative(),completeness:z.enum(POLICY_AI_SOURCE_COMPLETENESS),missingPages:policyAiPageListSchema,ocrRequiredPages:policyAiPageListSchema,qualityWarnings:z.array(safeCodeSchema).max(100),createdAt:utcDateTimeSchema,items:z.array(policyAiSourceItemSchema).max(POLICY_AI_MAX_BUNDLE_ITEMS)})
export const policyAiBudgetPreviewSchema=z.strictObject({enabled:z.boolean(),providerAvailable:z.boolean(),providerAllowed:z.boolean(),estimatedCostMinor:z.number().int().nonnegative(),currentMonthCostMinor:z.number().int().nonnegative(),monthlyBudgetMinor:z.number().int().nonnegative(),perRequestBudgetMinor:z.number().int().nonnegative(),allowed:z.boolean(),reasonCode:safeCodeSchema.nullable()})
export const policyAiPrivacySchema=z.strictObject({externalProvider:z.boolean(),policyVersion:z.string().min(1).max(80),outboundPayloadHash:sha256HexSchema.nullable(),outboundInputCharacters:z.number().int().positive(),redactedValueCount:z.number().int().nonnegative(),redactedCategories:z.array(z.enum(POLICY_AI_PII_CATEGORIES)).max(POLICY_AI_PII_CATEGORIES.length),retentionMode:z.enum(['local_only','store_false']),pricingVersion:z.string().min(1).max(80)})
export const policyAiRunSchema=z.strictObject({id:idSchema,caseId:caseIdSchema,status:z.enum(POLICY_AI_RUN_STATUSES),providerId:z.enum(POLICY_AI_PROVIDER_IDS),providerVersion:z.string().min(1).max(80),modelId:z.string().min(1).max(80),promptTemplateVersion:z.literal(POLICY_AI_PROMPT_TEMPLATE_VERSION),outputSchemaVersion:z.literal(POLICY_AI_OUTPUT_SCHEMA_VERSION),sourceBundleHash:sha256HexSchema,sourceBundleId:idSchema,candidateCount:z.number().int().nonnegative(),conflictCount:z.number().int().nonnegative(),controlRequiredCount:z.number().int().nonnegative(),inputCharacters:z.number().int().nonnegative(),estimatedCostMinor:z.number().int().nonnegative(),actualCostMinor:z.number().int().nonnegative().nullable(),safeErrorCode:safeCodeSchema.nullable(),version:entityVersionSchema,createdAt:utcDateTimeSchema,startedAt:utcDateTimeSchema.nullable(),completedAt:utcDateTimeSchema.nullable(),privacy:policyAiPrivacySchema,budget:policyAiBudgetPreviewSchema,bundle:policyAiBundleSchema})
export const policyAiCandidateReviewSchema=z.strictObject({schemaVersion:z.literal(POLICY_AI_REVIEW_SCHEMA_VERSION),runId:idSchema,candidateId:policyAiCandidateIdSchema,reviewVersion:z.number().int().min(1),action:z.enum(POLICY_AI_REVIEW_ACTIONS),normalizedValue:policyAiNormalizedValueSchema,originalValue:z.string().trim().min(1).max(1_000),conditions:z.array(shortText).max(20),exceptions:z.array(shortText).max(20),sourceAnchorIds:z.array(policyAiAnchorIdSchema).min(1).max(20),reason:z.string().trim().min(1).max(500).nullable(),evidenceStatus:z.enum(POLICY_AI_VALIDATION_STATUSES),reviewedByUserId:idSchema,reviewedAt:utcDateTimeSchema})
export const policyAiCandidateSchema=z.strictObject({candidateId:policyAiCandidateIdSchema,category:z.enum(POLICY_AI_CANDIDATE_CATEGORIES),canonicalField:z.string().regex(/^[a-z0-9_.-]{1,120}$/),normalizedValue:policyAiNormalizedValueSchema,originalValue:z.string().trim().min(1).max(1_000),conditions:z.array(shortText).max(20),exceptions:z.array(shortText).max(20),sourceAnchorIds:z.array(policyAiAnchorIdSchema).min(1).max(20),providerConfidence:z.number().finite().min(0).max(1),sourceQuality:z.enum(POLICY_AI_SOURCE_QUALITIES),validationStatus:z.enum(POLICY_AI_VALIDATION_STATUSES),conflictStatus:z.enum(POLICY_AI_CONFLICT_STATUSES),humanReviewStatus:z.enum(POLICY_AI_HUMAN_REVIEW_STATUSES),providerId:z.enum(POLICY_AI_PROVIDER_IDS),providerVersion:providerFactSchema,modelId:providerFactSchema,promptTemplateVersion:z.literal(POLICY_AI_PROMPT_TEMPLATE_VERSION),outputSchemaVersion:z.literal(POLICY_AI_OUTPUT_SCHEMA_VERSION),review:policyAiCandidateReviewSchema.nullable().default(null)})
export const policyAiConflictSchema=z.strictObject({id:idSchema,leftCandidateId:policyAiCandidateIdSchema,rightCandidateId:policyAiCandidateIdSchema,status:z.enum(POLICY_AI_CONFLICT_STATUSES).exclude(['none']),reason:safeCodeSchema})
export const policyAiPromotionPreviewSchema=z.strictObject({schemaVersion:z.literal(POLICY_AI_PROMOTION_SCHEMA_VERSION),runId:idSchema,runVersion:entityVersionSchema,reviewSetHash:sha256HexSchema,totalCandidateCount:z.number().int().nonnegative(),acceptedCount:z.number().int().nonnegative(),editedCount:z.number().int().nonnegative(),rejectedCount:z.number().int().nonnegative(),controlRequiredCount:z.number().int().nonnegative(),pendingCount:z.number().int().nonnegative(),promotableCount:z.number().int().nonnegative(),sourceCount:z.number().int().nonnegative(),conflictCount:z.number().int().nonnegative(),preservedConflictCount:z.number().int().nonnegative(),canPromote:z.boolean(),blockers:z.array(safeCodeSchema).max(20),warnings:z.array(safeCodeSchema).max(20),targetAnalysisId:idSchema.nullable(),targetAnalysisVersion:entityVersionSchema.nullable(),nextAnalysisVersion:z.number().int().min(1)})
export const policyAiPromotionSchema=z.strictObject({id:idSchema,schemaVersion:z.literal(POLICY_AI_PROMOTION_SCHEMA_VERSION),runId:idSchema,reviewSetHash:sha256HexSchema,analysisId:idSchema,analysisVersionId:idSchema,analysisVersion:z.number().int().min(1),promotedCandidateCount:z.number().int().min(1),preservedConflictCount:z.number().int().nonnegative(),promotedByUserId:idSchema,promotedAt:utcDateTimeSchema})
export const policyAiRunResponseSchema=z.strictObject({run:policyAiRunSchema})
export const policyAiRunsResponseSchema=z.strictObject({items:z.array(policyAiRunSchema.omit({bundle:true,budget:true})).max(100)})
export const policyAiCandidatesResponseSchema=z.strictObject({items:z.array(policyAiCandidateSchema).max(POLICY_AI_MAX_CANDIDATES),conflicts:z.array(policyAiConflictSchema).max(MAX_POLICY_AI_CONFLICTS),pageInfo:pageInfoSchema})
export const policyAiCandidateReviewResponseSchema=z.strictObject({review:policyAiCandidateReviewSchema})
export const policyAiPromotionPreviewResponseSchema=z.strictObject({preview:policyAiPromotionPreviewSchema})
export const policyAiPromotionResponseSchema=z.strictObject({promotion:policyAiPromotionSchema})
export const policyAiUsageItemSchema=z.strictObject({runId:idSchema,caseId:caseIdSchema,providerId:z.enum(POLICY_AI_PROVIDER_IDS),modelId:providerFactSchema,inputCharacters:z.number().int().nonnegative(),outputCharacters:z.number().int().nonnegative(),inputTokens:z.number().int().nonnegative().nullable(),outputTokens:z.number().int().nonnegative().nullable(),pricingVersion:providerFactSchema,estimatedCostMinor:z.number().int().nonnegative(),actualCostMinor:z.number().int().nonnegative().nullable(),status:z.enum(['provider_disabled','budget_blocked','completed','failed','cancelled']),safeErrorCode:safeCodeSchema.nullable(),startedAt:utcDateTimeSchema,completedAt:utcDateTimeSchema.nullable()})
export const policyAiUsageResponseSchema=z.strictObject({month:z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),totalCostMinor:z.number().int().nonnegative(),items:z.array(policyAiUsageItemSchema).max(MAX_POLICY_AI_USAGE_ITEMS)})
export const policyAiCaseParamsSchema=z.strictObject({caseId:caseIdSchema})
export const policyAiRunParamsSchema=z.strictObject({caseId:caseIdSchema,runId:idSchema})
export const policyAiCandidateParamsSchema=z.strictObject({caseId:caseIdSchema,runId:idSchema,candidateId:policyAiCandidateIdSchema})
export const policyAiListQuerySchema=z.strictObject({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)})
export const policyAiUsageQuerySchema=z.strictObject({month:z.string().regex(/^\d{4}-\d{2}$/).optional()})
export type PolicyAiProviderOutput=z.infer<typeof policyAiProviderOutputSchema>
export type PolicyAiRun=z.infer<typeof policyAiRunSchema>
export type PolicyAiCandidate=z.infer<typeof policyAiCandidateSchema>
export type PolicyAiCandidateReview=z.infer<typeof policyAiCandidateReviewSchema>
export type PolicyAiConflict=z.infer<typeof policyAiConflictSchema>
export type PolicyAiPromotionPreview=z.infer<typeof policyAiPromotionPreviewSchema>
export type PolicyAiPromotion=z.infer<typeof policyAiPromotionSchema>
export type PolicyAiRunResponse=z.infer<typeof policyAiRunResponseSchema>
export type PolicyAiCandidatesResponse=z.infer<typeof policyAiCandidatesResponseSchema>
export type PolicyAiCandidateReviewResponse=z.infer<typeof policyAiCandidateReviewResponseSchema>
export type PolicyAiPromotionPreviewResponse=z.infer<typeof policyAiPromotionPreviewResponseSchema>
export type PolicyAiPromotionResponse=z.infer<typeof policyAiPromotionResponseSchema>
export type PolicyAiUsageResponse=z.infer<typeof policyAiUsageResponseSchema>
