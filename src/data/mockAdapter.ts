import { mockCases } from '../mocks/cases'
import type { CasesDataPort } from './ports'

/** Varsayilan veri kaynagi: kabul edilmis UI baseline'inin mock verisi. */
export function createMockCasesAdapter(): CasesDataPort {
  return {
    listCases: () => Promise.resolve(mockCases),
  }
}
