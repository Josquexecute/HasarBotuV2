import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  ReportsFeesError,
  createHttpReportsFeesAdapter,
  type CaseClosureFeeWorkspaceRecord,
  type CaseSummaryReportRecord,
  type ClosureFeeListItemRecord,
  type ReportsFeesDataPort,
  type ReportsFeesErrorKind,
  type TrafficValueLossClosureListItemRecord,
} from './reportsFeesPort'

export type ReportsFeesLoadStatus = 'idle' | 'loading' | 'ok' | ReportsFeesErrorKind

function usePort(supplied?: ReportsFeesDataPort) {
  return useMemo(() => supplied ?? createHttpReportsFeesAdapter(), [supplied])
}

export function useCaseFee(
  caseId: string,
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [workspace, setWorkspace] = useState<CaseClosureFeeWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('idle')
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) {
      setWorkspace(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    port.getCaseFee(caseId).then((value) => {
      if (cancelled) return
      setWorkspace(value)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, revision])

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await action()
      reload()
      return true
    } catch (error) {
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
      return false
    } finally {
      setSaving(false)
    }
  }, [reload, reportUnauthorized])

  return { workspace, status, saving, reload, port, run }
}

export function useCaseSummaryReport(
  input: { period: string; responsibleUserId?: string; serviceId?: string },
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [report, setReport] = useState<CaseSummaryReportRecord | null>(null)
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('idle')
  const [revision, setRevision] = useState(0)
  const { period, responsibleUserId, serviceId } = input
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) {
      setReport(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    port.getCaseSummaryReport({
      period,
      ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
      ...(serviceId !== undefined ? { serviceId } : {}),
    }).then((value) => {
      if (cancelled) return
      setReport(value)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setReport(null)
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [enabled, period, port, reportUnauthorized, responsibleUserId, revision, serviceId])

  return { report, status, reload }
}

export function useClosureFeeList(
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [items, setItems] = useState<readonly ClosureFeeListItemRecord[]>([])
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('idle')

  useEffect(() => {
    if (!enabled) {
      setItems([])
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    port.listFees().then((value) => {
      if (cancelled) return
      setItems(value)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setItems([])
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [enabled, port, reportUnauthorized])

  return { items, status }
}

export function useValueLossClosureList(
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [items, setItems] = useState<readonly TrafficValueLossClosureListItemRecord[]>([])
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('idle')

  useEffect(() => {
    if (!enabled) {
      setItems([])
      setStatus('idle')
      return
    }
    if (port.listValueLossClosures === undefined) {
      setItems([])
      setStatus('unavailable')
      return
    }
    let cancelled = false
    setStatus('loading')
    port.listValueLossClosures().then((value) => {
      if (cancelled) return
      setItems(value)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setItems([])
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [enabled, port, reportUnauthorized])

  return { items, status }
}
