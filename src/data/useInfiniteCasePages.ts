import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpCasesAdapter, HttpCasesError } from './httpAdapter'
import { getConfiguredDataSource, type CasePageQuery, type CasePageResult, type CasesDataPort } from './ports'
import { useVisibleRefresh } from './useVisibleRefresh'

type CasePageStatus = 'ok' | 'loading' | 'unauthorized' | 'unavailable'

interface LoadedPages {
  readonly key: string
  readonly pages: readonly CasePageResult[]
  readonly status: CasePageStatus
  readonly moreStatus: 'ok' | 'loading' | 'unavailable'
}

export function useInfiniteCasePages(query: CasePageQuery, port?: CasesDataPort, initial?: {
  readonly queryKey?: string
  readonly pages?: readonly CasePageResult[]
}) {
  const { reportUnauthorized, user } = useSession()
  const [source] = useState(getConfiguredDataSource)
  const adapter = useMemo(() => port ?? createHttpCasesAdapter(), [port])
  const queryKey = JSON.stringify({ ...query, page: 1 })
  const scope = user ? `${user.organizationId}:${user.id}` : source
  const [revision, setRevision] = useState(0)
  const key = `${scope}:${queryKey}:${revision}`
  const [loaded, setLoaded] = useState<LoadedPages>(() => ({ key, pages: initial?.queryKey === queryKey ? initial.pages ?? [] : [], status: 'loading', moreStatus: 'ok' }))
  const current: LoadedPages = loaded.key === key ? loaded : { key, pages: loaded.key.startsWith(`${scope}:${queryKey}:`) ? loaded.pages : [], status: 'loading', moreStatus: 'ok' }
  const epoch = useRef(0)
  const inFlight = useRef(false)
  const retainedPages = useRef({ queryKey, scope, count: current.pages.length })

  const reload = useCallback(() => {
    retainedPages.current = { queryKey, scope, count: current.pages.length }
    setRevision(value => value + 1)
  }, [current.pages.length, queryKey, scope])
  const refreshVisible = useCallback(() => { if (!inFlight.current) reload() }, [reload])
  useVisibleRefresh(refreshVisible, source === 'api' && current.status === 'ok')

  useEffect(() => {
    if (source !== 'api') return
    const generation = ++epoch.current
    inFlight.current = true
    let cancelled = false
    const run = async () => {
      const requested = JSON.parse(queryKey) as CasePageQuery
      const pages = [await adapter.listCasePage(requested)]
      // On returning from a case, refresh the already loaded range without fetching the whole office.
      const retained = retainedPages.current
      const count = Math.min(retained.queryKey === queryKey && retained.scope === scope ? retained.count : 1, pages[0]!.totalPages)
      for (let page = 2; page <= count; page++) {
        if (cancelled) return
        pages.push(await adapter.listCasePage({ ...requested, page }))
      }
      if (!cancelled) setLoaded({ key, pages, status: 'ok', moreStatus: 'ok' })
    }
    void run().catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof HttpCasesError && error.kind === 'unauthorized' ? 'unauthorized' : 'unavailable'
      setLoaded({ key, pages: [], status: kind, moreStatus: 'ok' })
      if (kind === 'unauthorized') reportUnauthorized()
    }).finally(() => { if (epoch.current === generation) inFlight.current = false })
    return () => { cancelled = true; epoch.current = generation + 1 }
  }, [adapter, key, queryKey, reportUnauthorized, scope, source])

  const last = current.pages.at(-1)
  const hasMore = last !== undefined && last.page < last.totalPages
  const loadMore = useCallback(async () => {
    if (source !== 'api' || inFlight.current || current.status !== 'ok' || !last || last.page >= last.totalPages) return
    inFlight.current = true
    const generation = epoch.current
    setLoaded(value => ({ ...value, moreStatus: 'loading' }))
    try {
      const next = await adapter.listCasePage({ ...JSON.parse(queryKey) as CasePageQuery, page: last.page + 1 })
      if (epoch.current !== generation) return
      if (next.page <= last.page || next.totalPages < last.page + 1) {
        retainedPages.current = { queryKey, scope, count: Math.min(current.pages.length, next.totalPages) }
        setRevision(value => value + 1)
        return
      }
      setLoaded(value => ({ ...value, pages: [...value.pages, next], moreStatus: 'ok' }))
    } catch (error) {
      if (epoch.current !== generation) return
      if (error instanceof HttpCasesError && error.kind === 'unauthorized') {
        setLoaded({ key, pages: [], status: 'unauthorized', moreStatus: 'ok' })
        reportUnauthorized()
      } else setLoaded(value => ({ ...value, moreStatus: 'unavailable' }))
    } finally { if (epoch.current === generation) inFlight.current = false }
  }, [adapter, current.pages.length, current.status, key, last, queryKey, reportUnauthorized, scope, source])

  const items = useMemo(() => [...new Map(current.pages.flatMap(page => page.items).map(item => [item.caseId, item])).values()], [current.pages])
  return { items, pages: current.pages, queryKey, status: current.status, moreStatus: current.moreStatus, totalCount: last?.totalCount ?? 0, hasMore, loadMore, reload }
}
