import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
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
  const [data, setData] = useState<CaseOperationsRecord | null>(null)
  const [status, setStatus] = useState<CaseOperationsLoadStatus>('idle')
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
      const next = error instanceof CaseOperationsError ? error.kind : 'unavailable'
      setStatus(next === 'validation' || next === 'conflict' ? 'unavailable' : next)
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, source, token])

  return { data, status, port, reload }
}
