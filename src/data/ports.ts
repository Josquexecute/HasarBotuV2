import type { CaseRecord } from '../types/case'

/**
 * DataPort siniri (Paket 08): Feature UI yalniz bu arayuzu tuketir.
 * MockDataAdapter varsayilan ve guvenli fallback'tir; HttpApiAdapter
 * salt okunur Cases API'sine baglanir. UI davranisi degismez.
 */
export interface CasesDataPort {
  listCases(): Promise<readonly CaseRecord[]>
}

export type DataSourceKind = 'mock' | 'api'

/** localStorage anahtari; 'api' disindaki her deger mock demektir. */
export const DATA_SOURCE_STORAGE_KEY = 'hasarbotu-data-source'

export function getConfiguredDataSource(): DataSourceKind {
  try {
    return window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY) === 'api' ? 'api' : 'mock'
  } catch {
    return 'mock'
  }
}
