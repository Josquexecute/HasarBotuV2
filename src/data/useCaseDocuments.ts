import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpDocumentWorkspaceAdapter, HttpDocumentWorkspaceError } from './documentHttpAdapter'
import type { CaseDocumentsDataPort, CaseDocumentWorkspaceRecord, DataSourceKind } from './ports'

export type CaseDocumentsStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'unauthorized' | 'not_found' | 'unavailable'

export interface UseCaseDocumentsResult {
  readonly data: CaseDocumentWorkspaceRecord | null
  readonly status: CaseDocumentsStatus
  retry(): void
}

export function useCaseDocuments(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: CaseDocumentsDataPort,
): UseCaseDocumentsResult {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpDocumentWorkspaceAdapter(), [suppliedPort])
  const [data, setData] = useState<CaseDocumentWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<CaseDocumentsStatus>('idle')
  const [requestVersion, setRequestVersion] = useState(0)
  const retry = useCallback(() => setRequestVersion((value) => value + 1), [])

  useEffect(() => {
    if (source !== 'api' || !enabled) {
      setData(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setData(null)
    setStatus('loading')
    port.getCaseDocumentWorkspace(caseId)
      .then((workspace) => {
        if (cancelled) return
        setData(workspace)
        setStatus(workspace.requirements.length === 0 && workspace.documents.length === 0 && workspace.photos.length === 0 ? 'empty' : 'ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setData(null)
        const nextStatus = error instanceof HttpDocumentWorkspaceError ? error.kind : 'unavailable'
        setStatus(nextStatus)
        if (nextStatus === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [caseId, enabled, port, reportUnauthorized, requestVersion, source])

  return { data, status, retry }
}
