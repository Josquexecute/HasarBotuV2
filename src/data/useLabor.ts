import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  createHttpLaborAdapter,
  LaborError,
  type LaborDataPort,
  type LaborSheetWorkspaceRecord,
} from './laborPort'
import type { DataSourceKind } from './ports'

export type LaborLoadStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'

export function useLabor(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: LaborDataPort,
): {
  readonly data: LaborSheetWorkspaceRecord | null
  readonly status: LaborLoadStatus
  readonly port: LaborDataPort
  reload(): void
} {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpLaborAdapter(), [suppliedPort])
  const [token, setToken] = useState(0)
  const reload = useCallback(() => setToken((value) => value + 1), [])
  const active = source === 'api' && enabled
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${caseId}#${token}`
  const [loaded, setLoaded] = useState<{ key: string; data: LaborSheetWorkspaceRecord | null; status: LaborLoadStatus }>(
    () => ({ key: requestKey, data: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, data: null, status: 'loading' as const }

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.load(caseId).then((result) => {
      if (cancelled) return
      setLoaded({ key: requestKey, data: result, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const next = error instanceof LaborError ? error.kind : 'unavailable'
      setLoaded({ key: requestKey, data: null, status: next === 'validation' || next === 'conflict' ? 'unavailable' : next })
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  if (!active) return { data: null, status: 'idle', port, reload }
  return { data: current.data, status: current.status, port, reload }
}
