import { z } from 'zod'
import { MAX_CLOSURE_FEE_MINOR } from '@hasarbotu/domain'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'

export const closureFeeAmountMinorSchema = z.number().int().min(1).max(MAX_CLOSURE_FEE_MINOR)
export const closureFeeSourcePageSchema = z.number().int().min(1).max(10_000)

function hasUnsafePathOrControlCharacter(value: string): boolean {
  if (/(^|[^A-Za-z])[A-Za-z]:[\\/]|\\\\/.test(value)) return true
  return [...value].some((character) => character.charCodeAt(0) < 32)
}

export const closureFeeCorrectionReasonSchema = z.string().min(3).max(500).regex(/\S/, {
  error: 'must_not_be_blank',
}).refine((value) => !hasUnsafePathOrControlCharacter(value), {
  error: 'unsafe_path_or_control_character',
})

export const closureFeeCandidateCreateRequestSchema = z.strictObject({
  expectedCaseVersion: entityVersionSchema,
  candidateAmountMinor: closureFeeAmountMinorSchema,
  sourceDocumentVersionId: idSchema,
  sourcePage: closureFeeSourcePageSchema,
})

export const closureFeeApproveRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  confirmed: z.literal(true),
})

export const closureFeeCorrectRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  approvedAmountMinor: closureFeeAmountMinorSchema,
  sourceDocumentVersionId: idSchema,
  sourcePage: closureFeeSourcePageSchema,
  reason: closureFeeCorrectionReasonSchema,
  confirmed: z.literal(true),
})

export type ClosureFeeCandidateCreateRequest = z.infer<typeof closureFeeCandidateCreateRequestSchema>
export type ClosureFeeApproveRequest = z.infer<typeof closureFeeApproveRequestSchema>
export type ClosureFeeCorrectRequest = z.infer<typeof closureFeeCorrectRequestSchema>
