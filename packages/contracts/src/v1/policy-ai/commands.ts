import {z} from 'zod'
import {POLICY_AI_MAX_BUNDLE_ITEMS,POLICY_AI_PROVIDER_IDS} from '@hasarbotu/domain'
import {entityVersionSchema,idSchema} from '../../common/primitives.js'
import {sha256HexSchema} from '../documents/dto.js'

export const policyAiPdfSourceSelectionSchema=z.strictObject({sourceType:z.literal('pdf_text'),extractionId:idSchema,segmentId:idSchema})
export const policyAiOcrSourceSelectionSchema=z.strictObject({sourceType:z.literal('ocr'),ocrRunId:idSchema,elementId:idSchema})
export const policyAiSourceSelectionSchema=z.discriminatedUnion('sourceType',[policyAiPdfSourceSelectionSchema,policyAiOcrSourceSelectionSchema])
export const policyAiPlanRequestSchema=z.strictObject({providerId:z.enum(POLICY_AI_PROVIDER_IDS),sources:z.array(policyAiSourceSelectionSchema).min(1).max(POLICY_AI_MAX_BUNDLE_ITEMS),allowHistorical:z.boolean().default(false)}).superRefine((value,context)=>{const keys=value.sources.map(source=>source.sourceType==='pdf_text'?`pdf:${source.extractionId}:${source.segmentId}`:`ocr:${source.ocrRunId}:${source.elementId}`);if(new Set(keys).size!==keys.length)context.addIssue({code:'custom',path:['sources'],message:'duplicate_source'})}).meta({'x-hasarbotu-runtime-validation':'unique-source-selection'})
export const policyAiStartRequestSchema=z.strictObject({expectedVersion:entityVersionSchema,expectedSourceBundleHash:sha256HexSchema})
export const policyAiCancelRequestSchema=z.strictObject({expectedVersion:entityVersionSchema})
export type PolicyAiPlanRequest=z.infer<typeof policyAiPlanRequestSchema>
export type PolicyAiStartRequest=z.infer<typeof policyAiStartRequestSchema>
export type PolicyAiCancelRequest=z.infer<typeof policyAiCancelRequestSchema>
