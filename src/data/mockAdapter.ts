import { mockCases } from '../mocks/cases'
import type { CasesDataPort } from './ports'

/** Varsayilan veri kaynagi: kabul edilmis UI baseline'inin mock verisi. */
export function createMockCasesAdapter(): CasesDataPort {
  return {
    listCases: (status = 'open') => Promise.resolve(status === 'open' ? mockCases : []),
    getCase: (caseId) => {
      const item = mockCases.find((candidate) => candidate.caseId === caseId)
      return item === undefined
        ? Promise.reject(new Error('mock case not found'))
        : Promise.resolve(item)
    },
  }
}
