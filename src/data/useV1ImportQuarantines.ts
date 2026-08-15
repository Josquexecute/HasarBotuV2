import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  V1ImportQuarantineError,
  createHttpV1ImportQuarantineAdapter,
  type V1ImportQuarantineDataPort,
  type V1ImportQuarantinePage,
} from './v1ImportQuarantinePort'

export type V1ImportQuarantineLoadStatus = 'idle' | 'loading' | 'ok' | 'unauthorized' | 'forbidden' | 'unavailable'

export function useV1ImportQuarantines(port?: V1ImportQuarantineDataPort): {
  readonly page: V1ImportQuarantinePage | null
  readonly status: V1ImportQuarantineLoadStatus
  reload(): void
} {
  const adapter = useMemo(() => port ?? createHttpV1ImportQuarantineAdapter(), [port])
  const [page, setPage] = useState<V1ImportQuarantinePage | null>(null)
  const [status, setStatus] = useState<V1ImportQuarantineLoadStatus>('loading')
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    void adapter.list({ page: 1, pageSize: 100, status: 'unresolved' }).then((result) => {
      if (cancelled) return
      setPage(result)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setPage(null)
      setStatus(error instanceof V1ImportQuarantineError ? error.kind : 'unavailable')
    })
    return () => { cancelled = true }
  }, [adapter, revision])

  return { page, status, reload }
}
