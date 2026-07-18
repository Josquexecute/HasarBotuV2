import { mockCases } from '../mocks/cases'
import type { CasesDataPort } from './ports'

/** Varsayilan veri kaynagi: kabul edilmis UI baseline'inin mock verisi. */
export function createMockCasesAdapter(): CasesDataPort {
  return {
    listCases: (status = 'open') => Promise.resolve(status === 'open' ? mockCases : []),
    // Prototip sayfalaması mock ekranın kendi davranışıdır; bu adaptör yalnız
    // port sözleşmesini karşılar ve sunucu sayfalamasını taklit etmez.
    listCasePage: (query) => {
      const start = (query.page - 1) * query.pageSize
      return Promise.resolve({
        items: mockCases.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        totalCount: mockCases.length,
        totalPages: Math.max(1, Math.ceil(mockCases.length / query.pageSize)),
      })
    },
    getCase: (caseId) => {
      const item = mockCases.find((candidate) => candidate.caseId === caseId)
      return item === undefined
        ? Promise.reject(new Error('mock case not found'))
        : Promise.resolve(item)
    },
  }
}
