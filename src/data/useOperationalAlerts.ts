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
export function useOperationalAlerts(
  port?: OperationalAlertDataPort,
  caseIds?: readonly string[],
): UseOperationalAlertsResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [alerts, setAlerts] = useState<OperationalAlertsRecord | null>(null)
  const [status, setStatus] = useState<OperationalAlertLoadStatus>(source === 'api' ? 'loading' : 'ok')
  const [reloadToken, setReloadToken] = useState(0)
  // Dizi kimliği her render'da değiştiği için efekt kararlı bir anahtara bağlanır:
  // yalnız görünür satır kümesi gerçekten değiştiğinde yeniden yüklenir.
  const caseIdKey = caseIds === undefined ? null : caseIds.join(',')

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    // Filtre istenmiş ama görünür satır yoksa çağrı yapılmaz.
    if (caseIdKey === '') {
      setAlerts(null)
      setStatus('ok')
      return
    }
    let cancelled = false
    setStatus('loading')
    const adapter = port ?? createHttpOperationalAlertAdapter()
    adapter.list(caseIdKey === null ? undefined : caseIdKey.split(','))
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
  }, [caseIdKey, port, reloadToken, reportUnauthorized, source])

  return { alerts, source, status, reload }
}
