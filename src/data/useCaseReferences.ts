import { useCallback, useEffect, useMemo, useState } from 'react'
import { createHttpReferenceDataAdapter, ReferenceDataError } from './referenceHttpAdapter'
import type { CaseReferenceDataPort, CaseReferenceWorkspace, ServiceReferenceQuery } from './ports'

export type CaseReferencesStatus = 'loading' | 'ok' | 'unauthorized' | 'unavailable'

export function useCaseReferences(port?: CaseReferenceDataPort, query: ServiceReferenceQuery = {}): {
  readonly references: CaseReferenceWorkspace | null
  readonly status: CaseReferencesStatus
  reload(): void
} {
  const adapter = useMemo(() => port ?? createHttpReferenceDataAdapter(), [port])
  const [references, setReferences] = useState<CaseReferenceWorkspace | null>(null)
  const [status, setStatus] = useState<CaseReferencesStatus>('loading')
  const [token, setToken] = useState(0)
  const insurerId = query.insurerId
  const evaluationDate = query.evaluationDate
  const dateSource = query.dateSource ?? 'loss_date'
  const operation = query.operation ?? 'closure_documents'
  const reload = useCallback(() => { setStatus('loading'); setToken((value) => value + 1) }, [])

  useEffect(() => {
    let cancelled = false
    adapter.getCaseReferences({
      ...(insurerId === undefined ? {} : { insurerId }),
      ...(evaluationDate === undefined ? {} : { evaluationDate }),
      dateSource,
      operation,
    }).then((result) => {
      if (cancelled) return
      setReferences(result)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setReferences(null)
      setStatus(error instanceof ReferenceDataError ? error.kind : 'unavailable')
    })
    return () => { cancelled = true }
  }, [adapter, token, insurerId, evaluationDate, dateSource, operation])

  return { references, status, reload }
}
