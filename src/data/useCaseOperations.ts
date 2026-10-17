import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { NOTE_SAVED_EVENT } from '../app/activeCase'
import { useUserDirectoryRefresh } from '../app/userDirectory'
import {
  CaseOperationsError,
  createHttpCaseOperationsAdapter,
  type CaseOperationsPort,
  type CaseOperationsRecord,
} from './caseOperationsPort'
import type { DataSourceKind } from './ports'

export type CaseOperationsLoadStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'

/** Yüklenen veri, hangi istek anahtarına ait olduğuyla birlikte taşınır. */
interface CaseOperationsLoadState {
  readonly key: string
  readonly data: CaseOperationsRecord | null
  readonly status: CaseOperationsLoadStatus
}

export function useCaseOperations(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: CaseOperationsPort,
): {
  readonly data: CaseOperationsRecord | null
  readonly status: CaseOperationsLoadStatus
  readonly port: CaseOperationsPort
  reload(): void
} {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpCaseOperationsAdapter(), [suppliedPort])
  const [token, setToken] = useState(0)
  const reload = useCallback(() => setToken((value) => value + 1), [])
  const active = source === 'api' && enabled
  useUserDirectoryRefresh(reload, active)
  useEffect(() => {
    if (!active) return
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ caseId: string }>).detail?.caseId === caseId) reload()
    }
    window.addEventListener(NOTE_SAVED_EVENT, refresh)
    // Another authenticated assistant window can write while this view is hidden.
    window.addEventListener('focus', reload)
    return () => { window.removeEventListener(NOTE_SAVED_EVENT, refresh); window.removeEventListener('focus', reload) }
  }, [active, caseId, reload])
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${caseId}#${token}`
  const [loaded, setLoaded] = useState<CaseOperationsLoadState>(() => ({ key: requestKey, data: null, status: 'loading' }))
  const current: CaseOperationsLoadState = loaded.key === requestKey
    ? loaded
    : { key: requestKey, data: null, status: 'loading' }

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.load(caseId).then((result) => {
      if (cancelled) return
      setLoaded({ key: requestKey, data: result, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const next = error instanceof CaseOperationsError ? error.kind : 'unavailable'
      setLoaded({ key: requestKey, data: null, status: next === 'validation' || next === 'conflict' ? 'unavailable' : next })
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  if (!active) return { data: null, status: 'idle', port, reload }
  return { data: current.data, status: current.status, port, reload }
}
