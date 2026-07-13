import { useEffect, useState } from 'react'
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
}

/**
 * Dosya listesi veri kancasi (DataPort tuketimi, HB-2026-014).
 *
 * - mock: yalniz ACIKCA secilen development/demo veri kaynagidir (varsayilan);
 *   ilk render kabul edilmis baseline ile esdegerdir.
 * - api: gercek durumu oldugu gibi yansitir — 401 `unauthorized`, ag/5xx
 *   `unavailable`, gercek bos liste `ok`+bos. Sahte veri gercek API hatasini
 *   HICBIR ZAMAN maskelemez; mock'a sessiz dusus yoktur.
 */
export function useCases(): UseCasesResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [cases, setCases] = useState<readonly CaseRecord[]>(source === 'mock' ? mockCases : [])
  const [status, setStatus] = useState<CasesDataStatus>(source === 'mock' ? 'ok' : 'loading')

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
        const kind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        setStatus(kind)
        // Oturum sona erdiyse global "tekrar giris" akisini tetikle (Paket 10).
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [source, reportUnauthorized])

  return { cases, source, status }
}
