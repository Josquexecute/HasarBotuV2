export {
  DATA_SOURCE_STORAGE_KEY,
  getConfiguredDataSource,
  type AlternativeDocumentGroupRecord,
  type CaseDocumentsDataPort,
  type CaseDocumentWorkspaceRecord,
  type CasesDataPort,
  type DataSourceKind,
  type DocumentPhysicalStatus,
  type DocumentRequirementRecord,
  type DocumentRequirementStatus,
  type DocumentVersionMetadataRecord,
  type PhotoMetadataRecord,
} from './ports'
export { createMockCasesAdapter } from './mockAdapter'
export {
  createHttpCasesAdapter,
  deriveFollowUp,
  deriveStatus,
  HttpCasesError,
  mapCaseDtoToRecord,
  type HttpCasesErrorKind,
} from './httpAdapter'
export { useCases, type CasesDataStatus, type UseCasesResult } from './useCases'
export {
  createHttpDocumentWorkspaceAdapter,
  HttpDocumentWorkspaceError,
  isSafeMetadataRelativePath,
  type HttpDocumentWorkspaceAdapterOptions,
  type HttpDocumentWorkspaceErrorKind,
} from './documentHttpAdapter'
export { useCaseDocuments, type CaseDocumentsStatus, type UseCaseDocumentsResult } from './useCaseDocuments'
export {
  createHttpAuthAdapter,
  HttpAuthError,
  type AuthAdapterOptions,
  type AuthErrorKind,
  type AuthPort,
  type SessionUser,
} from './authPort'
export {
  CaseCommandError,
  createHttpCaseCommandAdapter,
  createMockCaseCommandAdapter,
  type CaseCommandAdapterOptions,
  type CaseCommandErrorKind,
  type CaseCommandFieldError,
  type CaseCommandPort,
  type CaseCreateInput,
  type CaseUpdateInput,
} from './commandPort'
