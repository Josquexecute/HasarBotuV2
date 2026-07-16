import { useCallback, useEffect, useState } from 'react'
import { mockCases } from '../mocks/cases'
import type { CaseRecord } from '../types/case'
import { useSession } from '../app/sessionContext'
import { getConfiguredDataSource, type DataSourceKind } from './ports'
import { createHttpCasesAdapter, HttpCasesError } from './httpAdapter'

export type CasesDataStatus = 'ok' | 'loading' | 'unauthorized' | 'unavailable'

export interface UseCasesResult {
  readonly cases: readonly CaseRecord[]
  readonly source: DataSourceKind
  readonly status: CasesDataStatus
  reload(): void
}

/**
 * Dosya listesi veri kancasi (DataPort tuketimi, HB-2026-014).
 *
 * - mock: yalniz ACIKCA secilen development/test/demo veri kaynagidir;
 *   ilk render kabul edilmis baseline ile esdegerdir.
 * - production: veri kaynagi zorunlu `api`dir.
 * - api: gercek durumu oldugu gibi yansitir — 401 `unauthorized`, ag/5xx
 *   `unavailable`, gercek bos liste `ok`+bos. Sahte veri gercek API hatasini
 *   HICBIR ZAMAN maskelemez; mock'a sessiz dusus yoktur.
 */
export function useCases(): UseCasesResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [cases, setCases] = useState<readonly CaseRecord[]>(source === 'mock' ? mockCases : [])
  const [status, setStatus] = useState<CasesDataStatus>(source === 'mock' ? 'ok' : 'loading')
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    createHttpCasesAdapter()
      .listCases()
      .then((items) => {
        if (cancelled) return
        setCases(items)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCases([])
        const rawKind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        const kind: CasesDataStatus = rawKind === 'not_found' ? 'unavailable' : rawKind
        setStatus(kind)
        // Oturum sona erdiyse global "tekrar giris" akisini tetikle (Paket 10).
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [source, reportUnauthorized, reloadToken])

  return { cases, source, status, reload }
}
