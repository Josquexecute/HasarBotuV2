import { z } from 'zod'
import {
  CASE_NOTE_TYPES,
  CASE_TASK_DUE_STATUSES,
  CASE_TASK_PRIORITIES,
  CASE_TASK_STATUSES,
} from '@hasarbotu/domain'
import {
  caseIdSchema,
  entityVersionSchema,
  idSchema,
  localDateSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'

const displayNameSchema = z.string().min(1).max(160)

export const caseOperationsParamsSchema = z.strictObject({
  caseId: caseIdSchema,
})

export const caseTaskParamsSchema = z.strictObject({
  caseId: caseIdSchema,
  taskId: idSchema,
})

export const caseNoteSchema = z.strictObject({
  id: idSchema,
  noteType: z.enum(CASE_NOTE_TYPES),
  subject: z.string().min(1).max(160).nullable(),
  body: z.string().min(1).max(5_000),
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
})

export const caseTaskSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(300),
  priority: z.enum(CASE_TASK_PRIORITIES),
  status: z.enum(CASE_TASK_STATUSES),
  assignedUserId: userIdSchema.nullable(),
  assignedUserDisplayName: displayNameSchema.nullable(),
  dueDate: localDateSchema,
  dueStatus: z.enum(CASE_TASK_DUE_STATUSES),
  resolutionNote: z.string().min(1).max(1_000).nullable(),
  resolvedByUserId: userIdSchema.nullable(),
  resolvedByDisplayName: displayNameSchema.nullable(),
  resolvedAt: utcDateTimeSchema.nullable(),
  version: entityVersionSchema,
  createdByUserId: userIdSchema,
  createdByDisplayName: displayNameSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
})

export const caseFollowUpHistoryItemSchema = z.strictObject({
  id: idSchema,
  previousFollowUpDate: localDateSchema.nullable(),
  newFollowUpDate: localDateSchema.nullable(),
  source: z.enum(['case_create', 'case_update']),
  caseVersion: entityVersionSchema,
  actorUserId: userIdSchema,
  actorDisplayName: displayNameSchema,
  changedAt: utcDateTimeSchema,
})

export const caseOperationsPermissionsSchema = z.strictObject({
  canWrite: z.boolean(),
  canCompleteTasks: z.boolean(),
})

export const caseOperationsResponseSchema = z.strictObject({
  caseId: caseIdSchema,
  asOfDate: localDateSchema,
  notes: z.array(caseNoteSchema).max(1_000),
  tasks: z.array(caseTaskSchema).max(1_000),
  followUpHistory: z.array(caseFollowUpHistoryItemSchema).max(1_000),
  permissions: caseOperationsPermissionsSchema,
})

export const caseNoteResponseSchema = z.strictObject({ note: caseNoteSchema })
export const caseTaskResponseSchema = z.strictObject({ task: caseTaskSchema })

export type CaseOperationsParams = z.infer<typeof caseOperationsParamsSchema>
export type CaseTaskParams = z.infer<typeof caseTaskParamsSchema>
export type CaseNoteDto = z.infer<typeof caseNoteSchema>
export type CaseTaskDto = z.infer<typeof caseTaskSchema>
export type CaseFollowUpHistoryItemDto = z.infer<typeof caseFollowUpHistoryItemSchema>
export type CaseOperationsResponse = z.infer<typeof caseOperationsResponseSchema>
export type CaseNoteResponse = z.infer<typeof caseNoteResponseSchema>
export type CaseTaskResponse = z.infer<typeof caseTaskResponseSchema>
