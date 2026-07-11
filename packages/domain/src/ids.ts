import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export type CaseId = Brand<string, 'CaseId'>
export type UserId = Brand<string, 'UserId'>
export type RoleId = Brand<string, 'RoleId'>
export type ServiceId = Brand<string, 'ServiceId'>
export type InsurerId = Brand<string, 'InsurerId'>
export type DocumentId = Brand<string, 'DocumentId'>
export type PhotoId = Brand<string, 'PhotoId'>
export type NoteId = Brand<string, 'NoteId'>
export type TaskId = Brand<string, 'TaskId'>
export type AuditEventId = Brand<string, 'AuditEventId'>
export type LegislationSourceId = Brand<string, 'LegislationSourceId'>
export type FeeRecordId = Brand<string, 'FeeRecordId'>

function parseId<Name extends string>(value: unknown, field: string): ParseResult<Brand<string, Name>> {
  if (typeof value !== 'string') return parseFailure('invalid_type', field)

  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', field)

  return parseSuccess(brandValue<string, Name>(normalized))
}

export const parseCaseId = (value: unknown): ParseResult<CaseId> => parseId<'CaseId'>(value, 'caseId')
export const parseUserId = (value: unknown): ParseResult<UserId> => parseId<'UserId'>(value, 'userId')
export const parseRoleId = (value: unknown): ParseResult<RoleId> => parseId<'RoleId'>(value, 'roleId')
export const parseServiceId = (value: unknown): ParseResult<ServiceId> => parseId<'ServiceId'>(value, 'serviceId')
export const parseInsurerId = (value: unknown): ParseResult<InsurerId> => parseId<'InsurerId'>(value, 'insurerId')
export const parseDocumentId = (value: unknown): ParseResult<DocumentId> => parseId<'DocumentId'>(value, 'documentId')
export const parsePhotoId = (value: unknown): ParseResult<PhotoId> => parseId<'PhotoId'>(value, 'photoId')
export const parseNoteId = (value: unknown): ParseResult<NoteId> => parseId<'NoteId'>(value, 'noteId')
export const parseTaskId = (value: unknown): ParseResult<TaskId> => parseId<'TaskId'>(value, 'taskId')
export const parseAuditEventId = (value: unknown): ParseResult<AuditEventId> => parseId<'AuditEventId'>(value, 'auditEventId')
export const parseLegislationSourceId = (value: unknown): ParseResult<LegislationSourceId> =>
  parseId<'LegislationSourceId'>(value, 'legislationSourceId')
export const parseFeeRecordId = (value: unknown): ParseResult<FeeRecordId> =>
  parseId<'FeeRecordId'>(value, 'feeRecordId')
