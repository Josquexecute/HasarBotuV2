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

/** Yüklenen veri, hangi istek anahtarına ait olduğuyla birlikte taşınır. */
interface CaseDocumentsLoadState {
  readonly key: string
  readonly data: CaseDocumentWorkspaceRecord | null
  readonly status: CaseDocumentsStatus
}

export function useCaseDocuments(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: CaseDocumentsDataPort,
): UseCaseDocumentsResult {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpDocumentWorkspaceAdapter(), [suppliedPort])
  const [requestVersion, setRequestVersion] = useState(0)
  const retry = useCallback(() => setRequestVersion((value) => value + 1), [])
  const active = source === 'api' && enabled
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Başka bir case'in verisi hiçbir frame'de görünmez ve
  // anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${caseId}#${requestVersion}`
  const [loaded, setLoaded] = useState<CaseDocumentsLoadState>(() => ({ key: requestKey, data: null, status: 'loading' }))
  const current: CaseDocumentsLoadState = loaded.key === requestKey
    ? loaded
    : { key: requestKey, data: null, status: 'loading' }

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.getCaseDocumentWorkspace(caseId)
      .then((workspace) => {
        if (cancelled) return
        setLoaded({
          key: requestKey,
          data: workspace,
          status: workspace.requirements.length === 0 && workspace.documents.length === 0 && workspace.photos.length === 0 ? 'empty' : 'ok',
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const nextStatus = error instanceof HttpDocumentWorkspaceError ? error.kind : 'unavailable'
        setLoaded({ key: requestKey, data: null, status: nextStatus })
        if (nextStatus === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  if (!active) return { data: null, status: 'idle', retry }
  return { data: current.data, status: current.status, retry }
}
