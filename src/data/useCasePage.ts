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
  const [reloadToken, setReloadToken] = useState(0)
  // Sorgu nesnesi her render'da yeniden kurulduğu için efekt kararlı bir
  // anahtara bağlanır: yalnız sorgu gerçekten değişince yeniden okunur.
  const queryKey = useMemo(() => JSON.stringify(query), [query])
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Önceki sorgunun sayfası hiçbir frame'de görünmez ve
  // anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${queryKey}#${reloadToken}`
  const [loaded, setLoaded] = useState<{ key: string; page: CasePageResult | null; status: CasePageStatus }>(
    () => ({ key: requestKey, page: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, page: null, status: 'loading' as const }

  const reload = useCallback(() => {
    if (source !== 'api') return
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return undefined
    let cancelled = false
    const adapter = port ?? createHttpCasesAdapter()
    adapter.listCasePage(JSON.parse(queryKey) as CasePageQuery)
      .then((result) => {
        if (cancelled) return
        setLoaded({ key: requestKey, page: result, status: 'ok' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Hata halinde eski sayfa korunmaz; bayat veri gösterilmez.
        const rawKind = error instanceof HttpCasesError ? error.kind : 'unavailable'
        setLoaded({ key: requestKey, page: null, status: rawKind === 'not_found' ? 'unavailable' : rawKind })
        if (rawKind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [port, queryKey, reportUnauthorized, requestKey, source])

  if (source !== 'api') return { page: null, source, status: 'ok', reload }
  return { page: current.page, source, status: current.status, reload }
}
