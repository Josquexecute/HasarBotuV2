import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  createHttpPertAdapter,
  PertError,
  type PertDataPort,
  type PertWorkspaceRecord,
} from './pertPort'
import type { DataSourceKind } from './ports'

export type PertLoadStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'

export function usePert(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: PertDataPort,
): {
  readonly data: PertWorkspaceRecord | null
  readonly status: PertLoadStatus
  readonly port: PertDataPort
  reload(): void
} {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpPertAdapter(), [suppliedPort])
  const [data, setData] = useState<PertWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<PertLoadStatus>('idle')
  const [token, setToken] = useState(0)
  const reload = useCallback(() => setToken((value) => value + 1), [])

  useEffect(() => {
    if (source !== 'api' || !enabled) {
      setData(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    port.load(caseId).then((result) => {
      if (cancelled) return
      setData(result)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setData(null)
      const next = error instanceof PertError ? error.kind : 'unavailable'
      setStatus(next === 'validation' || next === 'conflict' ? 'unavailable' : next)
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, source, token])

  return { data, status, port, reload }
}
