import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { getConfiguredDataSource, type DataSourceKind } from './ports'
import {
  createHttpOperationalAlertAdapter,
  OperationalAlertError,
  type OperationalAlertDataPort,
  type OperationalAlertsRecord,
} from './operationalAlertPort'

export type OperationalAlertLoadStatus = 'ok' | 'loading' | 'unauthorized' | 'forbidden' | 'unavailable'

export interface UseOperationalAlertsResult {
  readonly alerts: OperationalAlertsRecord | null
  readonly source: DataSourceKind
  readonly status: OperationalAlertLoadStatus
  reload(): void
}

/**
 * Uyarılar yalnız API modunda gerçek uçtan gelir. Mock modda bu hook veri
 * üretmez; mock içerik ayrı ve açıkça seçilmiş prototip bileşenindedir.
 * API hatasında mock'a düşülmez.
 */
export function useOperationalAlerts(port?: OperationalAlertDataPort): UseOperationalAlertsResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [alerts, setAlerts] = useState<OperationalAlertsRecord | null>(null)
  const [status, setStatus] = useState<OperationalAlertLoadStatus>(source === 'api' ? 'loading' : 'ok')
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    const adapter = port ?? createHttpOperationalAlertAdapter()
    adapter.list()
      .then((result) => {
        if (cancelled) return
        setAlerts(result)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setAlerts(null)
        const kind = error instanceof OperationalAlertError ? error.kind : 'unavailable'
        setStatus(kind)
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [port, reloadToken, reportUnauthorized, source])

  return { alerts, source, status, reload }
}
