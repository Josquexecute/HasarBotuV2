import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import type { CaseRecord } from '../types/case'
import { createHttpCasesAdapter, HttpCasesError } from './httpAdapter'
import { getConfiguredDataSource, type CasesDataPort, type DataSourceKind } from './ports'

export type ClosedCasesDataStatus = 'idle' | 'loading' | 'ok' | 'unauthorized' | 'unavailable'

export interface UseClosedCasesResult {
  readonly cases: readonly CaseRecord[]
  readonly source: DataSourceKind
  readonly status: ClosedCasesDataStatus
  reload(): void
}

export function useClosedCases(suppliedPort?: CasesDataPort): UseClosedCasesResult {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpCasesAdapter(), [suppliedPort])
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [cases, setCases] = useState<readonly CaseRecord[]>([])
  const [status, setStatus] = useState<ClosedCasesDataStatus>(source === 'api' ? 'loading' : 'idle')
  const [requestVersion, setRequestVersion] = useState(0)

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setRequestVersion((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    port.listCases('closed')
      .then((items) => {
        if (cancelled) return
        setCases(items)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCases([])
        const rawKind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        const kind = rawKind === 'unauthorized' ? 'unauthorized' : 'unavailable'
        setStatus(kind)
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [port, reportUnauthorized, requestVersion, source])

  return { cases, source, status, reload }
}
