import { z } from 'zod'
import {
  MAX_PERT_AMOUNT_MINOR,
  MAX_PERT_NOTE_LENGTH,
  MAX_PERT_REVISION_REASON_LENGTH,
  PERT_CENTER_DECISIONS,
  PERT_EXPERT_OPINIONS,
  PERT_WORKFLOW_STATUSES,
} from '@hasarbotu/domain'
import { entityVersionSchema } from '../../common/primitives.js'

const amountMinorSchema = z.number().int().min(0).max(MAX_PERT_AMOUNT_MINOR)
const noteSchema = z.string().trim().min(1).max(MAX_PERT_NOTE_LENGTH)

export const pertAssessmentPayloadSchema = z.strictObject({
  workflowStatus: z.enum(PERT_WORKFLOW_STATUSES),
  estimatedDamageMinor: amountMinorSchema.nullable().default(null),
  marketValueMinor: amountMinorSchema.nullable().default(null),
  structuralNote: noteSchema.nullable().default(null),
  expertOpinion: z.enum(PERT_EXPERT_OPINIONS).nullable().default(null),
  expertRationale: noteSchema.nullable().default(null),
  centerDecision: z.enum(PERT_CENTER_DECISIONS).nullable().default(null),
  centerNote: noteSchema.nullable().default(null),
})

export const pertAssessmentCreateRequestSchema = pertAssessmentPayloadSchema.extend({
  expectedCaseVersion: entityVersionSchema,
  confirmed: z.literal(true),
})

export const pertAssessmentReviseRequestSchema = pertAssessmentPayloadSchema.extend({
  expectedVersion: entityVersionSchema,
  reason: z.string().trim().min(1).max(MAX_PERT_REVISION_REASON_LENGTH),
  confirmed: z.literal(true),
})

export type PertAssessmentPayload = z.infer<typeof pertAssessmentPayloadSchema>
export type PertAssessmentCreateRequest = z.infer<typeof pertAssessmentCreateRequestSchema>
export type PertAssessmentReviseRequest = z.infer<typeof pertAssessmentReviseRequestSchema>
