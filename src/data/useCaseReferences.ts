import { useCallback, useEffect, useMemo, useState } from 'react'
import { createHttpReferenceDataAdapter, ReferenceDataError } from './referenceHttpAdapter'
import type { CaseReferenceDataPort, CaseReferenceWorkspace, ServiceReferenceQuery } from './ports'
import { useUserDirectoryRefresh } from '../app/userDirectory'

export type CaseReferencesStatus = 'loading' | 'ok' | 'unauthorized' | 'unavailable'

export function useCaseReferences(port?: CaseReferenceDataPort, query: ServiceReferenceQuery = {}, enabled = true): {
  readonly references: CaseReferenceWorkspace | null
  readonly status: CaseReferencesStatus
  reload(): void
} {
  const adapter = useMemo(() => port ?? createHttpReferenceDataAdapter(), [port])
  const [token, setToken] = useState(0)
  const insurerId = query.insurerId
  const evaluationDate = query.evaluationDate
  const dateSource = query.dateSource ?? 'loss_date'
  const operation = query.operation ?? 'closure_documents'
  const requestKey = JSON.stringify([insurerId, evaluationDate, dateSource, operation, token])
  const [loaded, setLoaded] = useState<{ adapter: CaseReferenceDataPort; key: string; references: CaseReferenceWorkspace | null; status: CaseReferencesStatus }>(() => ({ adapter, key: requestKey, references: null, status: 'loading' }))
  const current = loaded.adapter === adapter && loaded.key === requestKey ? loaded : { references: null, status: 'loading' as const }
  const reload = useCallback(() => setToken((value) => value + 1), [])
  useUserDirectoryRefresh(reload, enabled)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    adapter.getCaseReferences({
      ...(insurerId === undefined ? {} : { insurerId }),
      ...(evaluationDate === undefined ? {} : { evaluationDate }),
      dateSource,
      operation,
    }).then((result) => {
      if (cancelled) return
      setLoaded({ adapter, key: requestKey, references: result, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      setLoaded({ adapter, key: requestKey, references: null, status: error instanceof ReferenceDataError ? error.kind : 'unavailable' })
    })
    return () => { cancelled = true }
  }, [adapter, requestKey, insurerId, evaluationDate, dateSource, operation, enabled])

  return { references: enabled ? current.references : null, status: enabled ? current.status : 'loading', reload }
}
