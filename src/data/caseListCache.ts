import { createContext } from 'react'
import type { CaseRecord, CaseType, SortKey } from '../types/case'
import type { CasePageResult, CasesDataPort } from './ports'

export interface CaseListView {
  readonly queryParam: string
  readonly query: string
  readonly typeFilter: 'Tümü' | CaseType
  readonly stageFilter: string
  readonly statusFilter: string
  readonly assigneeFilter: string
  readonly serviceFilter: string
  readonly sortKey: SortKey
  readonly direction: 'asc' | 'desc'
  readonly filtersOpen: boolean
  readonly detailOpen: boolean
  readonly selectedId: CaseRecord['caseId']
  readonly scrollTop: number
  readonly scrollLeft: number
}

export interface CaseListCache {
  readonly scope: string
  readonly port: CasesDataPort | undefined
  view?: CaseListView
  queryKey?: string
  pages?: readonly CasePageResult[]
}

export function createCaseListCache() {
  let snapshot: CaseListCache | null = null
  return {
    read: () => snapshot,
    write: (value: CaseListCache) => { snapshot = value },
    saveScroll: (scope: string, scrollTop: number, scrollLeft: number) => {
      if (snapshot?.scope === scope && snapshot.view) snapshot = { ...snapshot, view: { ...snapshot.view, scrollTop, scrollLeft } }
    },
  }
}

// Owned by the authenticated shell; case data never enters browser storage or another session.
export const CaseListCacheContext = createContext<ReturnType<typeof createCaseListCache> | null>(null)
