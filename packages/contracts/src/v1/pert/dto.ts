import { z } from 'zod'
import {
  MAX_PERT_AMOUNT_MINOR,
  MAX_PERT_NOTE_LENGTH,
  MAX_PERT_REVISION_REASON_LENGTH,
  PERT_ASSESSMENT_CURRENCY,
  PERT_ASSESSMENT_SCHEMA_VERSION,
  PERT_CENTER_DECISIONS,
  PERT_EXPERT_OPINIONS,
  PERT_SOURCE_TYPES,
  PERT_WORKFLOW_STATUSES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

const displayNameSchema = z.string().min(1).max(200)
const amountMinorSchema = z.number().int().min(0).max(MAX_PERT_AMOUNT_MINOR)
const noteSchema = z.string().min(1).max(MAX_PERT_NOTE_LENGTH)

export const pertAssessmentParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const pertAssessmentVersionSchema = z.strictObject({
  id: idSchema,
  assessmentVersion: entityVersionSchema,
  previousVersionId: idSchema.nullable(),
  workflowStatus: z.enum(PERT_WORKFLOW_STATUSES),
  estimatedDamageMinor: amountMinorSchema.nullable(),
  marketValueMinor: amountMinorSchema.nullable(),
  damageRatioPercent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  structuralNote: noteSchema.nullable(),
  expertOpinion: z.enum(PERT_EXPERT_OPINIONS).nullable(),
  expertRationale: noteSchema.nullable(),
  centerDecision: z.enum(PERT_CENTER_DECISIONS).nullable(),
  centerNote: noteSchema.nullable(),
  schemaVersion: z.literal(PERT_ASSESSMENT_SCHEMA_VERSION),
  currency: z.literal(PERT_ASSESSMENT_CURRENCY),
  sourceType: z.enum(PERT_SOURCE_TYPES),
  revisionReason: z.string().min(1).max(MAX_PERT_REVISION_REASON_LENGTH).nullable(),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
})

export const pertAssessmentSchema = z.strictObject({
  id: idSchema,
  caseId: caseIdSchema,
  version: entityVersionSchema,
  currentVersion: pertAssessmentVersionSchema,
  versions: z.array(pertAssessmentVersionSchema).min(1).max(1_000),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const pertAssessmentWorkspaceResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  caseVersion: entityVersionSchema,
  lifecycleStatus: z.enum(['open', 'closed']),
  assessment: pertAssessmentSchema.nullable(),
  permissions: z.strictObject({
    canWrite: z.boolean(),
  }),
})

export const pertAssessmentResponseSchema = z.strictObject({
  assessment: pertAssessmentSchema,
})

export type PertAssessmentParams = z.infer<typeof pertAssessmentParamsSchema>
export type PertAssessmentVersion = z.infer<typeof pertAssessmentVersionSchema>
export type PertAssessment = z.infer<typeof pertAssessmentSchema>
export type PertAssessmentWorkspaceResponse = z.infer<typeof pertAssessmentWorkspaceResponseSchema>
export type PertAssessmentResponse = z.infer<typeof pertAssessmentResponseSchema>
