import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { getConfiguredDataSource, type CasePageQuery, type CasePageResult, type CasesDataPort, type DataSourceKind } from './ports'
import { createHttpCasesAdapter, HttpCasesError } from './httpAdapter'

export type CasePageStatus = 'ok' | 'loading' | 'unauthorized' | 'unavailable'

export interface UseCasePageResult {
  readonly page: CasePageResult | null
  readonly source: DataSourceKind
  readonly status: CasePageStatus
  reload(): void
}

/**
 * Sunucu tarafı sayfalanmış dosya listesi (Paket 53).
 *
 * Yalnız aktif sayfa okunur; istemci bütün listeyi çekmez. API hatasında eski
 * sayfa veya mock kayıt gösterilmez: sonuç `null` olur ve durum hatayı yansıtır.
 * Mock modda bu hook API çağırmaz.
 */
export function useCasePage(query: CasePageQuery, port?: CasesDataPort): UseCasePageResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [page, setPage] = useState<CasePageResult | null>(null)
  const [status, setStatus] = useState<CasePageStatus>(source === 'api' ? 'loading' : 'ok')
  const [reloadToken, setReloadToken] = useState(0)
  // Sorgu nesnesi her render'da yeniden kurulduğu için efekt kararlı bir
  // anahtara bağlanır: yalnız sorgu gerçekten değişince yeniden okunur.
  const queryKey = useMemo(() => JSON.stringify(query), [query])

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    setStatus('loading')
    const adapter = port ?? createHttpCasesAdapter()
    adapter.listCasePage(JSON.parse(queryKey) as CasePageQuery)
      .then((result) => {
        if (cancelled) return
        setPage(result)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Hata halinde eski sayfa korunmaz; bayat veri gösterilmez.
        setPage(null)
        const rawKind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        setStatus(rawKind === 'not_found' ? 'unavailable' : rawKind)
        if (rawKind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [port, queryKey, reloadToken, reportUnauthorized, source])

  return { page, source, status, reload }
}
