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

/** Yüklenen veri, hangi istek anahtarına ait olduğuyla birlikte taşınır. */
interface CaseLoadState {
  readonly key: string
  readonly item: CaseRecord | null
  readonly status: CaseDataStatus
}

export function useCase(caseId: string, suppliedPort?: CasesDataPort): UseCaseResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const port = useMemo(() => suppliedPort ?? createHttpCasesAdapter(), [suppliedPort])
  const mockItem = source === 'mock'
    ? mockCases.find((candidate) => candidate.caseId === caseId) ?? null
    : null
  const [requestVersion, setRequestVersion] = useState(0)
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Böylece yeni anahtar için eski veri hiçbir frame'de
  // görünmez ve geç dönen bir yanıt anahtarı tutmadığı için yok sayılır.
  const requestKey = `${caseId}#${requestVersion}`
  const [loaded, setLoaded] = useState<CaseLoadState>(() => ({ key: requestKey, item: null, status: 'loading' }))
  const active: CaseLoadState = loaded.key === requestKey
    ? loaded
    : { key: requestKey, item: null, status: 'loading' }

  const reload = useCallback(() => {
    if (source !== 'api') return
    setRequestVersion((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return undefined
    let cancelled = false
    port.getCase(caseId)
      .then((nextItem) => {
        if (cancelled) return
        setLoaded({ key: requestKey, item: nextItem, status: 'ok' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const kind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        setLoaded({ key: requestKey, item: null, status: kind })
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [caseId, port, reportUnauthorized, requestKey, source])

  if (source === 'mock') {
    return { item: mockItem, source, status: mockItem === null ? 'not_found' : 'ok', reload }
  }
  return { item: active.item, source, status: active.status, reload }
}
