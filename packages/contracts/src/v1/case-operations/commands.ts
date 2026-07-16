import { z } from 'zod'
import {
  CASE_NOTE_TYPES,
  CASE_TASK_PRIORITIES,
} from '@hasarbotu/domain'
import {
  entityVersionSchema,
  localDateSchema,
  userIdSchema,
} from '../../common/primitives.js'

const normalizedText = (maximum: number) => z.string().trim().min(1).max(maximum)

export const caseNoteCreateRequestSchema = z.strictObject({
  noteType: z.enum(CASE_NOTE_TYPES),
  subject: normalizedText(160).nullable().default(null),
  body: normalizedText(5_000),
})

export const caseTaskCreateRequestSchema = z.strictObject({
  title: normalizedText(300),
  priority: z.enum(CASE_TASK_PRIORITIES).default('normal'),
  assignedUserId: userIdSchema.nullable().default(null),
  dueDate: localDateSchema,
})

export const caseTaskCompleteRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  resultNote: normalizedText(1_000),
})

export const caseTaskCancelRequestSchema = z.strictObject({
  expectedVersion: entityVersionSchema,
  reason: normalizedText(1_000),
})

export type CaseNoteCreateRequest = z.infer<typeof caseNoteCreateRequestSchema>
export type CaseTaskCreateRequest = z.infer<typeof caseTaskCreateRequestSchema>
export type CaseTaskCompleteRequest = z.infer<typeof caseTaskCompleteRequestSchema>
export type CaseTaskCancelRequest = z.infer<typeof caseTaskCancelRequestSchema>
