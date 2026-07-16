import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { mockCases } from '../mocks/cases'
import type { CaseRecord } from '../types/case'
import { createHttpCasesAdapter, HttpCasesError } from './httpAdapter'
import { getConfiguredDataSource, type CasesDataPort, type DataSourceKind } from './ports'

export type CaseDataStatus = 'loading' | 'ok' | 'not_found' | 'unauthorized' | 'unavailable'

export interface UseCaseResult {
  readonly item: CaseRecord | null
  readonly source: DataSourceKind
  readonly status: CaseDataStatus
  reload(): void
}

export function useCase(caseId: string, suppliedPort?: CasesDataPort): UseCaseResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const port = useMemo(() => suppliedPort ?? createHttpCasesAdapter(), [suppliedPort])
  const mockItem = source === 'mock'
    ? mockCases.find((candidate) => candidate.caseId === caseId) ?? null
    : null
  const [item, setItem] = useState<CaseRecord | null>(mockItem)
  const [status, setStatus] = useState<CaseDataStatus>(mockItem === null ? 'loading' : 'ok')
  const [requestVersion, setRequestVersion] = useState(0)

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setRequestVersion((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source === 'mock') {
      setItem(mockItem)
      setStatus(mockItem === null ? 'not_found' : 'ok')
      return
    }
    let cancelled = false
    setItem(null)
    setStatus('loading')
    port.getCase(caseId)
      .then((nextItem) => {
        if (cancelled) return
        setItem(nextItem)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setItem(null)
        const kind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        setStatus(kind)
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [caseId, mockItem, port, reportUnauthorized, requestVersion, source])

  return { item, source, status, reload }
}
