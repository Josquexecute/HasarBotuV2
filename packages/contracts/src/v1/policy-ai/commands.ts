import {z} from 'zod'
import {POLICY_AI_MAX_BUNDLE_ITEMS,POLICY_AI_PROVIDER_IDS} from '@hasarbotu/domain'
import {entityVersionSchema,idSchema} from '../../common/primitives.js'
import {sha256HexSchema} from '../documents/dto.js'
import {policyAiNormalizedValueSchema} from './dto.js'

export const policyAiPdfSourceSelectionSchema=z.strictObject({sourceType:z.literal('pdf_text'),extractionId:idSchema,segmentId:idSchema})
export const policyAiOcrSourceSelectionSchema=z.strictObject({sourceType:z.literal('ocr'),ocrRunId:idSchema,elementId:idSchema})
export const policyAiSourceSelectionSchema=z.discriminatedUnion('sourceType',[policyAiPdfSourceSelectionSchema,policyAiOcrSourceSelectionSchema])
export const policyAiPlanRequestSchema=z.strictObject({providerId:z.enum(POLICY_AI_PROVIDER_IDS),sources:z.array(policyAiSourceSelectionSchema).min(1).max(POLICY_AI_MAX_BUNDLE_ITEMS),allowHistorical:z.boolean().default(false)}).superRefine((value,context)=>{const keys=value.sources.map(source=>source.sourceType==='pdf_text'?`pdf:${source.extractionId}:${source.segmentId}`:`ocr:${source.ocrRunId}:${source.elementId}`);if(new Set(keys).size!==keys.length)context.addIssue({code:'custom',path:['sources'],message:'duplicate_source'})}).meta({'x-hasarbotu-runtime-validation':'unique-source-selection'})
export const policyAiStartRequestSchema=z.strictObject({expectedVersion:entityVersionSchema,expectedSourceBundleHash:sha256HexSchema})
export const policyAiCancelRequestSchema=z.strictObject({expectedVersion:entityVersionSchema})
const reviewVersionSchema=z.number().int().min(0)
const reviewReasonSchema=z.string().trim().min(1).max(500)
const reviewTextSchema=z.string().trim().min(1).max(500)
const reviewValueFields={normalizedValue:policyAiNormalizedValueSchema,originalValue:z.string().trim().min(1).max(1_000),conditions:z.array(reviewTextSchema).max(20),exceptions:z.array(reviewTextSchema).max(20)} as const
export const policyAiCandidateReviewRequestSchema=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('accepted'),expectedReviewVersion:reviewVersionSchema,reason:reviewReasonSchema.nullable().default(null)}),
  z.strictObject({action:z.literal('edited'),expectedReviewVersion:reviewVersionSchema,reason:reviewReasonSchema,...reviewValueFields}),
  z.strictObject({action:z.literal('rejected'),expectedReviewVersion:reviewVersionSchema,reason:reviewReasonSchema}),
  z.strictObject({action:z.literal('control_required'),expectedReviewVersion:reviewVersionSchema,reason:reviewReasonSchema}),
])
export const policyAiPromotionRequestSchema=z.strictObject({confirmed:z.literal(true),expectedRunVersion:entityVersionSchema,expectedReviewSetHash:sha256HexSchema,expectedAnalysisId:idSchema.nullable().default(null),expectedAnalysisVersion:entityVersionSchema.nullable().default(null)}).superRefine((value,context)=>{if((value.expectedAnalysisId===null)!==(value.expectedAnalysisVersion===null))context.addIssue({code:'custom',path:['expectedAnalysisVersion'],message:'analysis_identity_must_be_complete'})})
export type PolicyAiPlanRequest=z.infer<typeof policyAiPlanRequestSchema>
export type PolicyAiStartRequest=z.infer<typeof policyAiStartRequestSchema>
export type PolicyAiCancelRequest=z.infer<typeof policyAiCancelRequestSchema>
export type PolicyAiCandidateReviewRequest=z.infer<typeof policyAiCandidateReviewRequestSchema>
export type PolicyAiPromotionRequest=z.infer<typeof policyAiPromotionRequestSchema>
