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
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Başka case'in kapanma ücreti hiçbir frame'de görünmez.
  const requestKey = `${caseId}#${revision}`
  const [loaded, setLoaded] = useState<{ key: string; workspace: CaseClosureFeeWorkspaceRecord | null; status: ReportsFeesLoadStatus }>(
    () => ({ key: requestKey, workspace: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, workspace: null, status: 'loading' as const }

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    port.getCaseFee(caseId).then((value) => {
      if (cancelled) return
      setLoaded({ key: requestKey, workspace: value, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setLoaded((prev) => prev.key === requestKey ? { ...prev, status: kind } : { key: requestKey, workspace: null, status: kind })
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, requestKey])

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await action()
      reload()
      return true
    } catch (error) {
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setLoaded((prev) => prev.key === requestKey ? { ...prev, status: kind } : prev)
      if (kind === 'unauthorized') reportUnauthorized()
      return false
    } finally {
      setSaving(false)
    }
  }, [reload, reportUnauthorized, requestKey])

  if (!enabled) return { workspace: null, status: 'idle' as ReportsFeesLoadStatus, saving, reload, port, run }
  return { workspace: current.workspace, status: current.status, saving, reload, port, run }
}

export function useCaseSummaryReport(
  input: { period: string; responsibleUserId?: string; serviceId?: string },
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [revision, setRevision] = useState(0)
  const { period, responsibleUserId, serviceId } = input
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  // Yükleme durumu efektte senkron sıfırlanmaz; sorgu veya sürüm değişince
  // RENDER sırasında türetilir. Önceki dönemin özeti hiçbir frame'de görünmez.
  const requestKey = `${period}|${responsibleUserId ?? ''}|${serviceId ?? ''}#${revision}`
  const [loaded, setLoaded] = useState<{ key: string; report: CaseSummaryReportRecord | null; status: ReportsFeesLoadStatus }>(
    () => ({ key: requestKey, report: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, report: null, status: 'loading' as const }

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    port.getCaseSummaryReport({
      period,
      ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
      ...(serviceId !== undefined ? { serviceId } : {}),
    }).then((value) => {
      if (cancelled) return
      setLoaded({ key: requestKey, report: value, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof ReportsFeesError ? error.kind : 'unavailable'
      setLoaded({ key: requestKey, report: null, status: kind })
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [enabled, period, port, reportUnauthorized, requestKey, responsibleUserId, serviceId])

  if (!enabled) return { report: null, status: 'idle' as ReportsFeesLoadStatus, reload }
  return { report: current.report, status: current.status, reload }
}

export function useClosureFeeList(
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  // Bu hook'un değişen bir istek anahtarı yoktur; yalnız `enabled` kapısı vardır.
  // Devre dışı sonuç efektte yazılmaz, RENDER sırasında türetilir. Başlangıç
  // durumu 'loading'dir; böylece ilk okuma öncesinde 'idle' görünmez.
  const [items, setItems] = useState<readonly ClosureFeeListItemRecord[]>([])
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('loading')

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
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

  if (!enabled) return { items: [] as readonly ClosureFeeListItemRecord[], status: 'idle' as ReportsFeesLoadStatus }
  return { items, status }
}

export function useValueLossClosureList(
  enabled: boolean,
  suppliedPort?: ReportsFeesDataPort,
) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  // Değişen istek anahtarı yoktur; `enabled` ve port yeteneği kapı görevi görür.
  // Her iki kapı da efektte yazılmaz, RENDER sırasında türetilir; port değer
  // kaybı kapanışlarını desteklemiyorsa fail-closed `unavailable` döner.
  const supported = port.listValueLossClosures !== undefined
  const [items, setItems] = useState<readonly TrafficValueLossClosureListItemRecord[]>([])
  const [status, setStatus] = useState<ReportsFeesLoadStatus>('loading')

  useEffect(() => {
    const list = port.listValueLossClosures
    if (!enabled || list === undefined) return undefined
    let cancelled = false
    list().then((value) => {
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

  const empty = [] as readonly TrafficValueLossClosureListItemRecord[]
  if (!enabled) return { items: empty, status: 'idle' as ReportsFeesLoadStatus }
  if (!supported) return { items: empty, status: 'unavailable' as ReportsFeesLoadStatus }
  return { items, status }
}
