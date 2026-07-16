import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  createHttpEmailDraftAdapter,
  EmailDraftError,
  type EmailDraftDataPort,
  type EmailDraftWorkspaceRecord,
} from './emailDraftPort'
import type { DataSourceKind } from './ports'

export type EmailDraftLoadStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'

export function useEmailDrafts(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: EmailDraftDataPort,
): {
  readonly data: EmailDraftWorkspaceRecord | null
  readonly status: EmailDraftLoadStatus
  readonly port: EmailDraftDataPort
  reload(): void
} {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpEmailDraftAdapter(), [suppliedPort])
  const [data, setData] = useState<EmailDraftWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<EmailDraftLoadStatus>('idle')
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
      const next = error instanceof EmailDraftError ? error.kind : 'unavailable'
      setStatus(next === 'validation' || next === 'conflict' ? 'unavailable' : next)
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, source, token])

  return { data, status, port, reload }
}
