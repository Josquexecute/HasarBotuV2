import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { getConfiguredDataSource, type DataSourceKind } from './ports'
import {
  buildMockDashboard,
  createHttpDashboardAdapter,
  DashboardError,
  type DashboardSnapshotRecord,
} from './dashboardPort'

export type DashboardLoadStatus = 'ok' | 'loading' | 'unauthorized' | 'unavailable'

export interface UseDashboardResult {
  readonly dashboard: DashboardSnapshotRecord | null
  readonly source: DataSourceKind
  readonly status: DashboardLoadStatus
  reload(): void
}

export function useDashboard(): UseDashboardResult {
  const { reportUnauthorized } = useSession()
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [dashboard, setDashboard] = useState<DashboardSnapshotRecord | null>(
    source === 'mock' ? buildMockDashboard() : null,
  )
  const [status, setStatus] = useState<DashboardLoadStatus>(source === 'mock' ? 'ok' : 'loading')
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => {
    if (source !== 'api') return
    setStatus('loading')
    setReloadToken((value) => value + 1)
  }, [source])

  useEffect(() => {
    if (source !== 'api') return
    let cancelled = false
    createHttpDashboardAdapter().loadDashboard()
      .then((result) => {
        if (cancelled) return
        setDashboard(result)
        setStatus('ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDashboard(null)
        const kind = error instanceof DashboardError ? error.kind : 'unavailable'
        setStatus(kind)
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken, reportUnauthorized, source])

  return { dashboard, source, status, reload }
}
