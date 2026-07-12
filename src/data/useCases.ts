import { useEffect, useState } from 'react'
import { mockCases } from '../mocks/cases'
import type { CaseRecord } from '../types/case'
import { getConfiguredDataSource, type DataSourceKind } from './ports'
import { createMockCasesAdapter } from './mockAdapter'
import { createHttpCasesAdapter } from './httpAdapter'
import { createFallbackCasesAdapter } from './fallback'

export interface UseCasesResult {
  readonly cases: readonly CaseRecord[]
  readonly source: DataSourceKind
  readonly usedFallback: boolean
}

/**
 * Dosya listesi veri kancasi (DataPort tuketimi).
 *
 * Ilk render HER ZAMAN mock veriyle esdegerdir (kabul edilmis UI davranisi
 * korunur). Kaynak 'api' secilmisse veri arka planda gercek API'den yuklenir;
 * basarisizlikta mock guvenli fallback olarak kalir.
 */
export function useCases(): UseCasesResult {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [cases, setCases] = useState<readonly CaseRecord[]>(mockCases)
  const [usedFallback, setUsedFallback] = useState(false)

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    const port = createFallbackCasesAdapter(createHttpCasesAdapter(), createMockCasesAdapter())
    void port.listCases().then((result) => {
      if (cancelled) return
      setCases(result.cases)
      setUsedFallback(result.usedFallback)
    })
    return () => {
      cancelled = true
    }
  }, [source])

  return { cases, source, usedFallback }
}
