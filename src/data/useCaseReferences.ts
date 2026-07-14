import { useCallback, useEffect, useMemo, useState } from 'react'
import { createHttpReferenceDataAdapter, ReferenceDataError } from './referenceHttpAdapter'
import type { CaseReferenceDataPort, CaseReferenceWorkspace } from './ports'

export type CaseReferencesStatus = 'loading' | 'ok' | 'unauthorized' | 'unavailable'

export function useCaseReferences(port?: CaseReferenceDataPort): {
  readonly references: CaseReferenceWorkspace | null
  readonly status: CaseReferencesStatus
  reload(): void
} {
  const adapter = useMemo(() => port ?? createHttpReferenceDataAdapter(), [port])
  const [references, setReferences] = useState<CaseReferenceWorkspace | null>(null)
  const [status, setStatus] = useState<CaseReferencesStatus>('loading')
  const [token, setToken] = useState(0)
  const reload = useCallback(() => { setStatus('loading'); setToken((value) => value + 1) }, [])

  useEffect(() => {
    let cancelled = false
    adapter.getCaseReferences().then((result) => {
      if (cancelled) return
      setReferences(result)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setReferences(null)
      setStatus(error instanceof ReferenceDataError ? error.kind : 'unavailable')
    })
    return () => { cancelled = true }
  }, [adapter, token])

  return { references, status, reload }
}
