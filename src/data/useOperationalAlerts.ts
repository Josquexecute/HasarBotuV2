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
  const [reloadToken, setReloadToken] = useState(0)
  // Dizi kimliği her render'da değiştiği için efekt kararlı bir anahtara bağlanır:
  // yalnız görünür satır kümesi gerçekten değiştiğinde yeniden yüklenir.
  const caseIdKey = caseIds === undefined ? null : caseIds.join(',')
  // Filtre istenmiş ama görünür satır yoksa çağrı yapılmaz.
  const active = source === 'api' && caseIdKey !== ''
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Önceki filtrenin uyarıları hiçbir frame'de görünmez ve
  // anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${caseIdKey ?? '*'}#${reloadToken}`
  const [loaded, setLoaded] = useState<{ key: string; alerts: OperationalAlertsRecord | null; status: OperationalAlertLoadStatus }>(
    () => ({ key: requestKey, alerts: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, alerts: null, status: 'loading' as const }

  const reload = useCallback(() => {
    if (source !== 'api') return
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const adapter = port ?? createHttpOperationalAlertAdapter()
    adapter.list(caseIdKey === null ? undefined : caseIdKey.split(','))
      .then((result) => {
        if (cancelled) return
        setLoaded({ key: requestKey, alerts: result, status: 'ok' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const kind = error instanceof OperationalAlertError ? error.kind : 'unavailable'
        setLoaded({ key: requestKey, alerts: null, status: kind })
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [active, caseIdKey, port, reportUnauthorized, requestKey])

  if (!active) return { alerts: null, source, status: 'ok', reload }
  return { alerts: current.alerts, source, status: current.status, reload }
}
