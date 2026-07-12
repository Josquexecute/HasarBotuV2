export { DATA_SOURCE_STORAGE_KEY, getConfiguredDataSource, type CasesDataPort, type DataSourceKind } from './ports'
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
