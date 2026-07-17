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
  const [data, setData] = useState<LaborSheetWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<LaborLoadStatus>('idle')
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
      const next = error instanceof LaborError ? error.kind : 'unavailable'
      setStatus(next === 'validation' || next === 'conflict' ? 'unavailable' : next)
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, source, token])

  return { data, status, port, reload }
}
