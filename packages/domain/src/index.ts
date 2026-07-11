export type { Brand } from './brand.js'
export {
  DOMAIN_PARSE_ERROR_CODES,
  parseFailure,
  parseSuccess,
  type DomainParseError,
  type DomainParseErrorCode,
  type ParseResult,
} from './parse-result.js'
export {
  parseAuditEventId,
  parseCaseId,
  parseDocumentId,
  parseFeeRecordId,
  parseInsurerId,
  parseLegislationSourceId,
  parseNoteId,
  parsePhotoId,
  parseRoleId,
  parseServiceId,
  parseTaskId,
  parseUserId,
  type AuditEventId,
  type CaseId,
  type DocumentId,
  type FeeRecordId,
  type InsurerId,
  type LegislationSourceId,
  type NoteId,
  type PhotoId,
  type RoleId,
  type ServiceId,
  type TaskId,
  type UserId,
} from './ids.js'
export {
  CASE_TYPES,
  isCaseType,
  isValueLossRequired,
  parseCaseType,
  type CaseType,
} from './case-type.js'
export {
  CASE_STAGES,
  CASE_STATUSES,
  isCaseStage,
  isCaseStatus,
  parseCaseStage,
  parseCaseStatus,
  type CaseStage,
  type CaseStatus,
} from './case-status.js'
export {
  MAX_OFFICE_CASE_YEAR,
  MIN_OFFICE_CASE_YEAR,
  createOfficeCaseNumber,
  formatOfficeCaseNumber,
  parseInsurerClaimNumber,
  parseNotificationFormNumber,
  parseOfficeCaseNumber,
  type InsurerClaimNumber,
  type NotificationFormNumber,
  type OfficeCaseNumber,
} from './case-identifiers.js'
export {
  parsePlateNumber,
  plateSearchKey,
  type PlateNumber,
  type PlateSearchKey,
} from './plate-number.js'
export {
  isLocalDate,
  isUtcDateTime,
  parseLocalDate,
  parseUtcDateTime,
  type LocalDate,
  type UtcDateTime,
} from './temporal.js'
export {
  incrementEntityVersion,
  isEntityVersion,
  parseEntityVersion,
  type EntityVersion,
} from './entity-version.js'
export type { CaseCore } from './case-core.js'
